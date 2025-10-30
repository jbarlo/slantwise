import { AppDal } from '../db/app_dal.js';
import { ExecutionTree, normalizeStepParamsForSort, StepParams } from '../db/types.js';
import { logger } from '../logger.js';
import { hash, stableStringify } from '../utils.js';
import { IterationValue, SccExecutionContext, SccOptions, SccResult } from './types.js';
import { isNil, map } from 'lodash-es';
import type { ExecutionPlan } from './planner.js';

/**
 * Seeds the iteration buffer with initial values
 */
async function _seedIterationBuffer(
  appDal: AppDal,
  memberIds: string[],
  options: SccOptions
): Promise<
  { success: true; buffer: Map<string, IterationValue> } | { success: false; error: string }
> {
  const buffer = new Map<string, IterationValue>();
  const { seedPolicy = 'empty' } = options;

  for (const derivationId of memberIds) {
    let seed: { content: string; hash: string } | null = null;
    let seedDependencies: ExecutionTree['dependencies'] = [];
    let seedWarnings: ExecutionTree['warnings'] = [];

    const derivation = appDal.derivations.findDerivationById(derivationId);
    // Seeds should accurately reflect the underlying operation; do not stub.
    if (isNil(derivation)) {
      return {
        success: false,
        error: `Derivation ${derivationId} not found while seeding SCC buffer`
      };
    }
    const operation = derivation.recipe_params.operation;

    if (seedPolicy === 'last-cache' && !isNil(derivation)) {
      // Try to get last cached result
      const resultContext = appDal.derivations.findStepResultContext(derivation.final_step_id);
      if (resultContext) {
        const cachedContent = appDal.core.findContentByHash(resultContext.output_content_hash);
        if (cachedContent) {
          seed = { content: cachedContent, hash: resultContext.output_content_hash };
          seedDependencies = resultContext.dependency_tree ?? [];
          seedWarnings = resultContext.warnings ?? [];
        }
      }
    }

    if (isNil(seed)) {
      seed = { content: '', hash: hash('') };
      appDal.core.insertContentIfNew(seed.hash, seed.content);
    }

    buffer.set(derivationId, {
      content: seed.content,
      executionTree: {
        operation,
        // seeds act as if cached
        wasCached: true,
        dependencies: seedDependencies,
        contentHash: seed.hash,
        warnings: seedWarnings
      }
    });

    logger('INFO', `Seeded ${derivationId} with content length ${seed.content.length}`);
  }

  return { success: true, buffer };
}

async function _resolveSccDerivationWithBudget(
  derivationId: string,
  sccContext: SccExecutionContext,
  resolve: SccDerivationResolver
): Promise<
  | { success: 'buffered'; content: string; executionTree: ExecutionTree }
  | { success: 'unrolled'; executionTree: ExecutionTree }
  | { success: false; error: string }
> {
  // Consume one budget unit for the node being computed in this pass
  const remaining = sccContext.remainingBudgetByNode.get(derivationId) ?? 0;
  if (remaining <= 0) {
    const value = sccContext.iterationBuffer.get(derivationId);
    if (isNil(value)) {
      return { success: false, error: `Buffer value not found for ${derivationId}` };
    }
    return { success: 'buffered', content: value.content, executionTree: value.executionTree };
  }

  const nextRemainingBudgetByNode = new Map(sccContext.remainingBudgetByNode);
  nextRemainingBudgetByNode.set(derivationId, remaining - 1);

  const context: SccExecutionContext = {
    ...sccContext,
    remainingBudgetByNode: nextRemainingBudgetByNode
  };

  const res = await resolve(derivationId, context);
  if (!res.success) {
    return { success: false, error: `Failed to compute ${derivationId}: ${res.error}` };
  }

  return { success: 'unrolled', executionTree: res.executionTree };
}

/**
 * Performs one Jacobi iteration pass over the SCC members using double buffering.
 */
async function _performJacobiPass(
  appDal: AppDal,
  memberIds: string[],
  sccContext: SccExecutionContext,
  resolve: SccDerivationResolver
): Promise<
  { success: true; nextBuffer: Map<string, IterationValue> } | { success: false; error: string }
> {
  const nextBuffer = new Map<string, IterationValue>();

  logger('INFO', `Starting Jacobi pass for SCC ${sccContext.sccId}`);

  for (const derivationId of memberIds) {
    try {
      const res = await _resolveSccDerivationWithBudget(derivationId, sccContext, resolve);
      if (!res.success) {
        return { success: false, error: res.error };
      }

      const content =
        res.success === 'buffered'
          ? res.content
          : (appDal.core.findContentByHash(res.executionTree.contentHash) ?? '');

      nextBuffer.set(derivationId, { content, executionTree: res.executionTree });
    } catch (error) {
      return { success: false, error: `Error computing ${derivationId}: ${error}` };
    }
  }

  logger('INFO', `Completed Jacobi pass for SCC ${sccContext.sccId}`);
  return { success: true, nextBuffer };
}

async function _tagResultsWithMetadata(
  memberIds: string[],
  resultBuffer: Map<string, IterationValue>,
  sccId: string,
  iterationSteps: number
): Promise<{
  results: Map<string, { content: string; contentHash: string; executionTree: ExecutionTree }>;
}> {
  const resultBufferEntries: [string, IterationValue][] = Array.from(resultBuffer.entries());

  const results = new Map<
    string,
    { content: string; contentHash: string; executionTree: ExecutionTree }
  >(
    map(resultBufferEntries, ([derivationId, value]) => {
      const executionTreeWithSccMetadata = {
        ...value.executionTree,
        sccMetadata: { sccId, iterationCount: iterationSteps, sccMembers: memberIds }
      };
      return [
        derivationId,
        {
          content: value.content,
          contentHash: value.executionTree.contentHash,
          executionTree: executionTreeWithSccMetadata
        }
      ];
    })
  );

  return { results };
}

// Normalize recipe params for sort key so derivation/step ids don't inject randomness
const normalizeForSort = (recipeParams: StepParams): StepParams =>
  normalizeStepParamsForSort(recipeParams);

/**
 * Main SCC evaluation function
 */
export async function evaluateScc(
  appDal: AppDal,
  memberIds: string[],
  options: SccOptions,
  plan: ExecutionPlan,
  resolve: SccDerivationResolver
): Promise<SccResult> {
  // Derive a stable, deterministic member ordering using precomputed keys
  const memberInfos = memberIds.map((id) => {
    const derivation = appDal.derivations.findDerivationById(id);
    const key = !isNil(derivation)
      ? hash(stableStringify(normalizeForSort(derivation.recipe_params)))
      : id;
    const createdAt = derivation?.created_at ?? '';
    return { id, key, createdAt };
  });
  memberInfos.sort((a, b) => {
    if (a.key !== b.key) return a.key.localeCompare(b.key);
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.id.localeCompare(b.id);
  });
  const sortedMemberIds = memberInfos.map((m) => m.id);
  const sccId = `scc-${sortedMemberIds.join('-')}`;
  const iterationSteps =
    isNil(options.coverAllNTimes) || options.coverAllNTimes < 1 ? 1 : options.coverAllNTimes;

  logger(
    'INFO',
    `Starting SCC evaluation for ${sccId} with ${sortedMemberIds.length} members, ${iterationSteps} iterations`
  );
  logger('INFO', `SCC members: [${sortedMemberIds.join(', ')}]`);

  try {
    const seedResult = await _seedIterationBuffer(appDal, sortedMemberIds, options);
    if (!seedResult.success) {
      return { success: false, sccId, error: seedResult.error };
    }
    const currentBuffer = seedResult.buffer;

    // recursive unrolling depth derived from iterationSteps
    const budget = new Map<string, number>(map(sortedMemberIds, (id) => [id, iterationSteps]));
    const sccContext: SccExecutionContext = {
      sccId,
      iterationBuffer: currentBuffer,
      remainingBudgetByNode: budget,
      plan
    };

    const passResult = await _performJacobiPass(appDal, sortedMemberIds, sccContext, resolve);

    if (!passResult.success) {
      return { success: false, sccId, error: passResult.error };
    }

    const taggedResults = await _tagResultsWithMetadata(
      sortedMemberIds,
      passResult.nextBuffer,
      sccId,
      iterationSteps
    );

    logger('INFO', `SCC evaluation completed for ${sccId} with ${iterationSteps} iterations`);

    return {
      success: true,
      memberResults: taggedResults.results,
      iterationCount: iterationSteps,
      sccId
    };
  } catch (error) {
    return {
      success: false,
      sccId,
      error: `Unexpected error during SCC evaluation: ${error}`
    };
  }
}

/**
 * Helper to check if a derivation is part of the current SCC being evaluated
 */
export function isInCurrentScc(derivationId: string, sccContext: SccExecutionContext): boolean {
  return !isNil(sccContext) && sccContext.iterationBuffer.has(derivationId);
}

/**
 * Resolve an intra-SCC derivation input according to SCC semantics (buffer vs recursive unroll).
 * Returns the execution tree to splice into the caller's dependency tree.
 */
export type SccDerivationResolver = (
  derivationId: string,
  sccContext: SccExecutionContext
) => Promise<{ success: true; executionTree: ExecutionTree } | { success: false; error: string }>;

export async function resolveIntraSccDerivationInput(
  derivationId: string,
  sccContext: SccExecutionContext,
  resolve: SccDerivationResolver
): Promise<{ success: true; executionTree: ExecutionTree } | { success: false; error: string }> {
  try {
    const res = await _resolveSccDerivationWithBudget(derivationId, sccContext, resolve);

    if (!res.success) return { success: false, error: `SCC buffer missing ${derivationId}` };
    return { success: true, executionTree: res.executionTree };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
