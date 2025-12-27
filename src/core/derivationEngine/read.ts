import { AppDal } from '../db/app_dal.js';
import {
  logDerivationComputeStart,
  logDerivationInputReadError,
  logDerivationCacheStoreSuccess,
  logDerivationComputeUnexpectedError,
  logDerivationOperationError,
  logDerivationOperationSuccess,
  logEmbeddingRequestSkipped,
  logger
} from '../logger.js';
import { getDerivationCacheKey } from '../utils.js';
import { hash } from '../utils.js';
import { EmbeddingOutput, Prettify } from '../types.js';
import {
  StepParams,
  StepParamsSchema,
  InputDescriptorItem,
  DependencyTree,
  ExecutionTree,
  OperationWarning,
  assertNever
} from '../db/types.js';
import { isNil } from 'lodash-es';
import { ReadErrorInfo, getReadErrorInfo } from './errors.js';
import { performOperation } from './operations.js';
import type { ConfigType } from '@config/types.js';
import { RateLimiter } from '../limiting';
import {
  isInCurrentScc,
  evaluateScc,
  resolveIntraSccDerivationInput,
  SccDerivationResolver
} from './scc.js';
import { createExecutionPlan, ExecutionPlan, getSccContaining } from './planner.js';
import {
  GetOrComputeDerivedContentByStepOpts,
  GetOrComputeDerivedContentOpts,
  SccExecutionContext
} from './types.js';
import { findEquivalentResult, applyCacheHit } from './cache.js';

type StepResult =
  | {
      success: true;
      output: string;
      executionTree: ExecutionTree;
      tokensOutput?: number; // only present for LLM ops
    }
  | {
      success: false;
      error: ReadErrorInfo;
    };

/**
 * Resolves the inputs for a derivation.
 * - If the input is a pinned path, we need to resolve it to a content hash.
 * - If the input is a derivation, we need to resolve it to a content hash.
 * - If the input is content, we can use it directly.
 * - If the input is an internal step link, we need to resolve it to a content
 *   hash.
 * Derivations and steps are recursively resolved.
 */
const _computeDependencies = async (
  appDal: AppDal,
  inputDescriptors: InputDescriptorItem[],
  limiter: RateLimiter,
  config: ConfigType,
  opts: Partial<GetOrComputeDerivedContentByStepOpts>,
  logging: { derivationId: string }
): Promise<
  | {
      success: true;
      dependencyTree: DependencyTree;
      pinnedHashesMap: Record<string, { type: 'content'; hash: string }>;
    }
  | { success: false; error: ReadErrorInfo }
> => {
  const sccContext: SccExecutionContext | undefined = opts.sccContext;

  // FIXME: tracking via index seems error prone. if there's a missing
  // conditional below, the input step and content hash index will be
  // misaligned.
  const dependencyTree: DependencyTree = [];
  const pinnedHashesMap: Record<string, { type: 'content'; hash: string }> = {}; // To store all resolved pinned paths for this computation

  for (const currentInput of inputDescriptors) {
    if (currentInput.type === 'pinned_path') {
      const docId = appDal.core.findDocIdByPath(currentInput.path);
      if (isNil(docId)) {
        logDerivationInputReadError(
          currentInput.path,
          logging.derivationId,
          'Pinned path not found.'
        );
        return {
          success: false,
          error: getReadErrorInfo('pinnedPathNotFound', {
            pinnedPath: currentInput.path
          })
        };
      }
      const hash = appDal.core.findHashByDocId(docId);
      if (isNil(hash)) {
        logDerivationInputReadError(
          currentInput.path,
          logging.derivationId,
          `Content hash for docId ${docId} not found.`
        );
        return {
          success: false,
          error: getReadErrorInfo('pinnedContentHashNotFound', {
            pinnedPath: currentInput.path,
            docId
          })
        };
      }
      pinnedHashesMap[currentInput.path] = { type: 'content', hash };
      dependencyTree.push({ type: 'pinned_path', contentHash: hash });
    } else if (currentInput.type === 'content') {
      dependencyTree.push({ type: 'content', contentHash: currentInput.hash });
    } else if (currentInput.type === 'derivation') {
      let execTree: ExecutionTree;

      // Check if this derivation is part of current SCC - if so, handle recursively or use buffer
      if (!isNil(sccContext) && isInCurrentScc(currentInput.id, sccContext)) {
        const resolver: SccDerivationResolver = async (id, context) => {
          const res = await getOrComputeDerivedContent(appDal, id, limiter, config, {
            sccContext: context,
            scc: undefined,
            skipCache: opts.skipCache,
            onEvent: opts.onEvent,
            plan: opts.plan
          });
          if (!res.success) return { success: false, error: res.error.message };
          return { success: true, executionTree: res.executionTree };
        };
        const resolved = await resolveIntraSccDerivationInput(
          currentInput.id,
          sccContext,
          resolver
        );
        if (!resolved.success) {
          return {
            success: false,
            error: getReadErrorInfo('unexpectedDerivationComputationError', {
              error: resolved.error
            })
          };
        }
        execTree = resolved.executionTree;
      } else {
        // Normal external derivation resolution
        const derivationResult = await getOrComputeDerivedContent(
          appDal,
          currentInput.id,
          limiter,
          config,
          { sccContext, scc: undefined, skipCache: opts.skipCache, onEvent: opts.onEvent, plan: opts.plan }
        );

        if (!derivationResult.success) {
          return { success: false, error: derivationResult.error };
        }

        execTree = derivationResult.executionTree;
      }

      dependencyTree.push({
        type: 'derivation',
        cacheStatus: execTree.cacheStatus,
        dependencies: execTree.dependencies,
        contentHash: execTree.contentHash,
        operation: execTree.operation,
        warnings: execTree.warnings
      });
    } else if (currentInput.type === 'internal_step_link') {
      const stepId = currentInput.targetStepId;
      let stepParams: StepParams | undefined;
      try {
        stepParams = appDal.derivations.getStepStoredParams(stepId);
      } catch {
        // noop, be undefined
      }
      if (isNil(stepParams)) {
        logDerivationComputeUnexpectedError(logging.derivationId, `Step ${stepId} not found.`);
        return {
          success: false,
          error: getReadErrorInfo('stepNotFound', { stepId })
        };
      }
      const stepResult = await getOrComputeDerivedContentByStep(
        appDal,
        stepId,
        stepParams,
        limiter,
        config,
        logging,
        { ...opts, sccContext }
      );

      if (!stepResult.success) {
        return { success: false, error: stepResult.error };
      }

      const exec = stepResult.executionTree;
      dependencyTree.push({
        type: 'computed_step',
        cacheStatus: exec.cacheStatus,
        dependencies: exec.dependencies,
        contentHash: exec.contentHash,
        operation: exec.operation,
        warnings: exec.warnings
      });
    } else if (currentInput.type === 'constant') {
      const valueHash = hash(currentInput.value);
      appDal.core.insertContentIfNew(valueHash, currentInput.value);
      dependencyTree.push({ type: 'constant', contentHash: valueHash });
    } else {
      assertNever(currentInput);
    }
  }

  return { success: true, dependencyTree, pinnedHashesMap };
};

const _tryShortCircuit = async (
  appDal: AppDal,
  stepId: string,
  recipeParams: StepParams,
  limiter: RateLimiter,
  config: ConfigType,
  opts: Partial<GetOrComputeDerivedContentByStepOpts>,
  logging: { derivationId: string }
): Promise<
  | {
      shortCircuitAllowed: true;
      result: StepResult;
    }
  | {
      shortCircuitAllowed: false;
      inputContentHashes: string[];
      computedDependencies: Prettify<
        Awaited<ReturnType<typeof _computeDependencies>> & { success: true }
      >;
    }
> => {
  const inputDescriptors = recipeParams.inputs;

  // Always compute dependencies to ensure dependencyTree cacheStatus flags stay
  // current
  const computedDependencies = await _computeDependencies(
    appDal,
    inputDescriptors,
    limiter,
    config,
    { ...opts },
    logging
  );

  if (!computedDependencies.success) {
    return {
      shortCircuitAllowed: true,
      result: { success: false, error: computedDependencies.error }
    };
  }

  const { dependencyTree } = computedDependencies;
  const inputContentHashes = dependencyTree.map((input) => input.contentHash);
  const cacheKey = getDerivationCacheKey(recipeParams, inputContentHashes);

  // force recompute if skipCache is set
  if (opts.skipCache) {
    return { shortCircuitAllowed: false, inputContentHashes, computedDependencies };
  }

  // check if the step or an identical step is cached
  const stepCacheHit = await findEquivalentResult(appDal, cacheKey);

  if (stepCacheHit.cache === 'hit') {
    const cachedOutput = appDal.core.findContentByHash(stepCacheHit.outputHash);
    const result = applyCacheHit(
      appDal,
      recipeParams,
      stepId,
      cacheKey,
      cachedOutput,
      stepCacheHit,
      dependencyTree
    );
    if (result) return { shortCircuitAllowed: true, result: result };
  }

  return { shortCircuitAllowed: false, inputContentHashes, computedDependencies };
};

const _storeResult = async (
  appDal: AppDal,
  limiter: RateLimiter,
  outputContent: string,
  stepId: string,
  stepParams: StepParams,
  inputContentHashes: string[],
  pinnedHashesMap: Record<string, { type: 'content'; hash: string }>,
  dependencyTree: DependencyTree,
  warnings: OperationWarning[],
  config: ConfigType,
  logging: { derivationId: string }
): Promise<{ success: true; hash: string } | { success: false; error: ReadErrorInfo }> => {
  const derivationId = logging.derivationId;
  const newOutputContentHash = hash(outputContent);
  try {
    const skipEmbedding = config.skipEmbedding;
    let embeddingResult: EmbeddingOutput | undefined;
    if (!skipEmbedding && outputContent.length > 0) {
      // Queue embedding generation
      embeddingResult = await limiter.enqueue('embedding', newOutputContentHash, {
        contentHash: newOutputContentHash,
        content: outputContent
      });
    } else {
      logEmbeddingRequestSkipped(newOutputContentHash);
    }

    // Save the embedding
    appDal.executeTransaction(({ core, saveComputedDerivationInTransaction }) => {
      saveComputedDerivationInTransaction(
        stepId,
        stepParams,
        newOutputContentHash,
        outputContent,
        pinnedHashesMap,
        inputContentHashes,
        dependencyTree,
        warnings
      );

      if (embeddingResult) {
        core.insertUsageLog(
          newOutputContentHash,
          embeddingResult.modelName,
          embeddingResult.usage.promptTokens
        );
        core.upsertEmbedding(
          newOutputContentHash,
          embeddingResult.embedding,
          embeddingResult.modelName
        );
      }
    });

    // Log success AFTER transaction confirms save
    logDerivationCacheStoreSuccess(derivationId); // Removed output hash argument
  } catch (txnError: unknown) {
    // Error should have been logged within DAL/transaction
    logDerivationComputeUnexpectedError(
      derivationId,
      `Failed transaction storing result: ${(txnError as Error).message}`
    );
    return {
      success: false,
      error: getReadErrorInfo('derivationStoreFailure', {
        error: (txnError as Error).message
      })
    };
  }
  return { success: true, hash: newOutputContentHash };
};

export async function getOrComputeDerivedContentByStep(
  appDal: AppDal,
  stepId: string,
  recipeParams: StepParams,
  limiter: RateLimiter,
  config: ConfigType,
  logging: { derivationId: string },
  opts?: GetOrComputeDerivedContentByStepOpts
): Promise<StepResult> {
  // Validate recipe parameters (including input arity)
  const validation = StepParamsSchema.safeParse(recipeParams);
  if (!validation.success) {
    logDerivationComputeUnexpectedError(
      logging.derivationId,
      `Invalid step parameters: ${validation.error.message}`
    );
    return {
      success: false,
      error: getReadErrorInfo('invalidInputArity', {
        issues: JSON.stringify(validation.error.issues)
      })
    };
  }

  const shortCircuitResult = await _tryShortCircuit(
    appDal,
    stepId,
    recipeParams,
    limiter,
    config,
    opts ?? {},
    logging
  );
  if (shortCircuitResult.shortCircuitAllowed) {
    return shortCircuitResult.result;
  }

  const {
    inputContentHashes,
    computedDependencies: { dependencyTree, pinnedHashesMap }
  } = shortCircuitResult;

  const operationPerformed = await performOperation(
    appDal,
    inputContentHashes,
    recipeParams,
    config,
    logging,
    opts?.operationOptions
  );

  if (!operationPerformed.success) {
    return { success: false, error: operationPerformed.error };
  }

  const operationResult = operationPerformed.result;

  // Check operation result
  if (operationResult.error || isNil(operationResult.output)) {
    const errorMsg = operationResult.error ?? 'No output from operation';
    logDerivationOperationError(logging.derivationId, recipeParams.operation, errorMsg);
    return {
      success: false,
      error: !isNil(operationResult.error)
        ? getReadErrorInfo('operationResultError', {
            error: operationResult.error
          })
        : getReadErrorInfo('unspecifiedOperationFailure', {
            operation: recipeParams.operation
          })
    };
  }

  logDerivationOperationSuccess(
    logging.derivationId,
    recipeParams.operation,
    operationResult.output.length
  );
  const outputContent = operationResult.output;

  const resultStored = await _storeResult(
    appDal,
    limiter,
    outputContent,
    stepId,
    recipeParams,
    inputContentHashes,
    pinnedHashesMap,
    dependencyTree,
    operationResult.warnings,
    config,
    logging
  );
  if (!resultStored.success) {
    return { success: false, error: resultStored.error };
  }

  return {
    success: true,
    output: outputContent,
    executionTree: {
      operation: recipeParams.operation,
      cacheStatus: 'computed',
      dependencies: dependencyTree,
      contentHash: resultStored.hash,
      warnings: operationResult.warnings
    },
    tokensOutput: operationResult.tokensOutput
  };
}

/**
 * Computes or retrieves derived content based on a defined derivation ID.
 */
export async function getOrComputeDerivedContent(
  appDal: AppDal,
  derivationId: string,
  limiter: RateLimiter,
  config: ConfigType,
  opts?: GetOrComputeDerivedContentOpts
): Promise<
  | {
      success: true;
      output: string;
      executionTree: ExecutionTree;
    }
  | { success: false; error: ReadErrorInfo }
> {
  logDerivationComputeStart(derivationId);

  const onEvent = opts?.onEvent;

  try {
    // Get or create execution plan upfront
    let plan: ExecutionPlan;
    if (opts?.plan) {
      // Reuse plan from parent call (avoids redundant planning)
      plan = opts.plan;
    } else {
      const planResult = await createExecutionPlan(appDal, derivationId);
      if (!planResult.success) {
        logger('ERROR', `Failed to create execution plan: ${JSON.stringify(planResult.error)}`);
        if (planResult.error.kind === 'formula_not_found') {
          return {
            success: false,
            error: getReadErrorInfo('derivationNotFound', {
              derivationId: planResult.error.derivationId
            })
          };
        }
        return {
          success: false,
          error: getReadErrorInfo('unexpectedDerivationComputationError', {
            error:
              planResult.error.kind === 'planning_internal_error'
                ? planResult.error.message
                : 'Unknown planning error'
          })
        };
      }
      plan = planResult.plan;
      // Emit PLAN_READY only once when we create a new plan
      onEvent?.({ type: 'PLAN_READY', plan });
    }

    // If we're already in SCC iteration context, compute directly
    if (!isNil(opts?.sccContext)) {
      const derivation = appDal.derivations.findDerivationById(derivationId);
      if (isNil(derivation)) {
        logDerivationComputeUnexpectedError(derivationId, 'Derivation definition not found.');
        return {
          success: false,
          error: getReadErrorInfo('derivationNotFound', { derivationId })
        };
      }
      const { final_step_id: stepId, recipe_params: recipeParams } = derivation;
      const stepResult = await getOrComputeDerivedContentByStep(
        appDal,
        stepId,
        recipeParams,
        limiter,
        config,
        { derivationId },
        { ...opts, plan }
      );

      if (stepResult.success) {
        onEvent?.({
          type: 'STEP_COMPLETE',
          derivationId,
          execTree: stepResult.executionTree,
          tokensOutput: stepResult.tokensOutput
        });
      }

      return stepResult;
    }

    // Check if target derivation is part of an SCC
    const scc = getSccContaining(plan, derivationId);
    if (scc) {
      logger('INFO', `Derivation ${derivationId} is part of SCC ${scc.sccId}`);
      const resolver: SccDerivationResolver = async (id, context) => {
        const res = await getOrComputeDerivedContent(appDal, id, limiter, config, {
          sccContext: context,
          scc: undefined,
          skipCache: opts?.skipCache,
          onEvent,
          plan
        });
        if (!res.success) return { success: false, error: res.error.message };
        return { success: true, executionTree: res.executionTree };
      };
      const sccResult = await evaluateScc(appDal, scc.nodeIds, opts?.scc ?? {}, resolver);
      if (!sccResult.success) {
        return {
          success: false,
          error: getReadErrorInfo('unexpectedDerivationComputationError', {
            error: sccResult.error ?? 'SCC evaluation failed'
          })
        };
      }
      const member = sccResult.memberResults.get(derivationId);
      if (!member) {
        return {
          success: false,
          error: getReadErrorInfo('unexpectedDerivationComputationError', {
            error: `SCC evaluation succeeded but ${derivationId} not in results`
          })
        };
      }
      // Emit STEP_COMPLETE for SCC member
      onEvent?.({
        type: 'STEP_COMPLETE',
        derivationId,
        execTree: member.executionTree
        // tokensOutput not tracked for SCC yet
      });
      return {
        success: true,
        output: member.content,
        executionTree: member.executionTree
      };
    }

    // Normal acyclic computation
    const derivation = appDal.derivations.findDerivationById(derivationId);
    if (isNil(derivation)) {
      logDerivationComputeUnexpectedError(derivationId, 'Derivation definition not found.');
      return {
        success: false,
        error: getReadErrorInfo('derivationNotFound', { derivationId })
      };
    }
    const { final_step_id: stepId, recipe_params: recipeParams } = derivation;
    if (isNil(stepId) || isNil(recipeParams)) {
      return {
        success: false,
        error: getReadErrorInfo('unexpectedDerivationComputationError', {
          error: `Invalid derivation definition for ${derivationId}: missing final_step_id or recipe_params`
        })
      };
    }

    const stepResult = await getOrComputeDerivedContentByStep(
      appDal,
      stepId,
      recipeParams,
      limiter,
      config,
      { derivationId },
      { ...opts, plan }
    );

    if (stepResult.success) {
      onEvent?.({
        type: 'STEP_COMPLETE',
        derivationId,
        execTree: stepResult.executionTree,
        tokensOutput: stepResult.tokensOutput
      });
    }

    return stepResult;
  } catch (error: unknown) {
    logDerivationComputeUnexpectedError(derivationId, error);
    return {
      success: false,
      error: getReadErrorInfo('unexpectedDerivationComputationError', {
        error: error instanceof Error ? error.message : String(error)
      })
    };
  }
}
