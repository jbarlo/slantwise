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

  // treat elements with a wasCached property as not cacheable (content input)
  const cacheableSteps = unwrappedSteps.filter((step) => 'wasCached' in step);

  return {
    cachedSteps:
      (executionTree.wasCached ? 1 : 0) + cacheableSteps.filter((step) => step.wasCached).length,
    // +1 for the root step
    totalSteps: 1 + cacheableSteps.length
  };
};
