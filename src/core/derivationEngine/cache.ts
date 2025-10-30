import { AppDal } from '../db/app_dal.js';
import { StepParams, DependencyTree, ExecutionTree, OperationWarning } from '../db/types.js';
import { isNil } from 'lodash-es';

export const findEquivalentResult = async (
  appDal: AppDal,
  cacheKey: string
): Promise<
  { cache: 'hit'; outputHash: string; warnings: OperationWarning[] } | { cache: 'miss' }
> => {
  // Global step check using cache_key (operationSlice + input hashes). This
  // includes duplicate steps
  const resultContext = appDal.derivations.findCacheRowByKey(cacheKey);
  if (!isNil(resultContext)) {
    return {
      cache: 'hit',
      outputHash: resultContext.output_content_hash,
      warnings: resultContext.warnings
    };
  }

  return { cache: 'miss' };
};

export const applyCacheHit = (
  appDal: AppDal,
  recipeParams: StepParams,
  stepId: string,
  cacheKey: string,
  cachedOutput: string | undefined,
  equivalenceResult: { outputHash: string; warnings: OperationWarning[] },
  cachedDependencyTree: DependencyTree
): { success: true; output: string; executionTree: ExecutionTree } | undefined => {
  try {
    appDal.derivations.linkStepToCache(stepId, cacheKey, cachedDependencyTree);
  } catch {
    // ignore link errors, best-effort only
  }

  if (!isNil(cachedOutput)) {
    return {
      success: true,
      output: cachedOutput,
      executionTree: {
        operation: recipeParams.operation,
        wasCached: true,
        // make sure to use the resolved dependency tree, not the cached one
        // (or risk returning a cached dependency tree for an unrelated
        // step)
        dependencies: cachedDependencyTree,
        contentHash: equivalenceResult.outputHash,
        warnings: equivalenceResult.warnings
      }
    };
  }
};
