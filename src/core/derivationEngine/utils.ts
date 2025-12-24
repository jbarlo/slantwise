import { flatMap } from 'lodash-es';
import { DependencyTree, ExecutionTree } from '../db/types';

export const getExecutionTreeStatistics = (
  executionTree: ExecutionTree
): {
  cachedSteps: number;
  totalSteps: number;
} => {
  const unwrapExecutionTree = (deps: DependencyTree): DependencyTree => {
    return flatMap(deps, (dep) => [
      dep,
      ...unwrapExecutionTree('dependencies' in dep ? dep.dependencies : [])
    ]);
  };

  const unwrappedSteps = unwrapExecutionTree(executionTree.dependencies);

  // treat elements with a cacheStatus property as cacheable (derivation/computed_step)
  const cacheableSteps = unwrappedSteps.filter((step) => 'cacheStatus' in step);

  return {
    cachedSteps:
      (executionTree.cacheStatus === 'cached' ? 1 : 0) +
      cacheableSteps.filter((step) => step.cacheStatus === 'cached').length,
    // +1 for the root step
    totalSteps: 1 + cacheableSteps.length
  };
};
