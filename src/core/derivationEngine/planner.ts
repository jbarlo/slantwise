import { Prettify } from '../types.js';
import { AppDal } from '../db/app_dal.js';
import { StepParams, InputDescriptorItem } from '../db/types.js';
import { logger } from '../logger.js';

/**
 * Represents a node in the dependency graph
 */
export type PlanNode =
  | {
      isAcyclic: false; // true if not part of any SCC
      id: string; // derivation ID
      sccId: string; // set after SCC detection
      upstreamIds: Set<string>; // derivations this node depends on
      downstreamIds: Set<string>; // derivations that depend on this node
    }
  | {
      isAcyclic: true; // true if not part of any SCC
      id: string; // derivation ID
      upstreamIds: Set<string>; // derivations this node depends on
      downstreamIds: Set<string>; // derivations that depend on this node
    };

/**
 * Represents an execution unit - either a single acyclic node or an SCC bundle
 */
export type PlanUnit =
  | {
      type: 'scc';
      nodeIds: string[]; // single node for acyclic, multiple for SCC
      sccId: string;
    }
  | { type: 'acyclic'; nodeId: string };

/**
 * Complete execution plan with topologically ordered units
 */
export interface ExecutionPlan {
  planNodes: Map<string, PlanNode>; // derivationId -> PlanNode
  planUnits: PlanUnit[]; // topologically ordered execution units
  hasCycles: boolean;
}

/**
 * Result of planning pass that discovers dependencies without executing operations
 */
type PlanningError =
  | { kind: 'formula_not_found'; derivationId: string }
  | { kind: 'planning_internal_error'; message: string };

type PlanningResult =
  | {
      success: true;
      dependencies: string[]; // list of derivation IDs this node depends on
    }
  | { success: false; error: PlanningError };

/**
 * Discovers dependencies for a derivation by doing a planning pass
 * that resolves references but bypasses computation
 */
async function _discoverDependencies(
  appDal: AppDal,
  derivationId: string,
  visited: Set<string> = new Set()
): Promise<PlanningResult> {
  // Prevent infinite loops during discovery
  if (visited.has(derivationId)) {
    return { success: true, dependencies: [] };
  }
  visited.add(derivationId);

  try {
    // Get derivation definition
    const derivation = appDal.derivations.findDerivationById(derivationId);
    if (!derivation) {
      return {
        success: false,
        error: { kind: 'formula_not_found', derivationId }
      };
    }

    const { recipe_params: recipeParams } = derivation;
    const result = await _discoverDependenciesForInputs(appDal, recipeParams.inputs, visited);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, dependencies: result.dependencies };
  } catch (error) {
    return {
      success: false,
      error: {
        kind: 'planning_internal_error',
        message: `Error discovering dependencies for ${derivationId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
    };
  }
}

/**
 * Helper to discover dependencies from a list of input descriptors
 */
async function _discoverDependenciesForInputs(
  appDal: AppDal,
  inputs: InputDescriptorItem[],
  visited: Set<string>
): Promise<PlanningResult> {
  const dependencies: string[] = [];

  for (const input of inputs) {
    if (input.type === 'derivation') {
      dependencies.push(input.id);
    } else if (input.type === 'internal_step_link') {
      const stepId = input.targetStepId;
      let stepParams: StepParams | undefined;
      try {
        stepParams = appDal.derivations.getStepStoredParams(stepId);
      } catch {
        continue;
      }

      if (stepParams) {
        const stepResult = await _discoverDependenciesForInputs(appDal, stepParams.inputs, visited);
        if (stepResult.success) {
          dependencies.push(...stepResult.dependencies);
        }
      }
    }
  }

  return { success: true, dependencies };
}

/**
 * Builds the local dependency graph for a root derivation
 */
async function _buildDependencyGraph(
  appDal: AppDal,
  rootDerivationId: string
): Promise<
  { success: true; graph: Map<string, PlanNode> } | { success: false; error: PlanningError }
> {
  const graph = new Map<string, PlanNode>();
  const toProcess = [rootDerivationId];
  const processed = new Set<string>();

  while (toProcess.length > 0) {
    const currentId = toProcess.shift()!;

    if (processed.has(currentId)) continue;
    processed.add(currentId);

    // Discover dependencies for this node
    const result = await _discoverDependencies(appDal, currentId);
    if (!result.success) {
      logger(
        'ERROR',
        `Failed to discover dependencies for ${currentId}: ${JSON.stringify(result.error)}`
      );
      return { success: false, error: result.error };
    }

    // Create or update the plan node
    const node: PlanNode = graph.get(currentId) ?? {
      id: currentId,
      isAcyclic: true, // will be updated after SCC detection
      upstreamIds: new Set(),
      downstreamIds: new Set()
    };

    // Add dependencies
    for (const depId of result.dependencies) {
      node.upstreamIds.add(depId);

      // Create downstream relationship
      const depNode: PlanNode = graph.get(depId) ?? {
        id: depId,
        isAcyclic: true,
        upstreamIds: new Set(),
        downstreamIds: new Set()
      };
      depNode.downstreamIds.add(currentId);
      graph.set(depId, depNode);

      // Add to processing queue
      toProcess.push(depId);
    }

    graph.set(currentId, node);
  }

  logger('INFO', `Built dependency graph with ${graph.size} nodes`);
  return { success: true, graph };
}

/**
 * Tarjan's algorithm for detecting strongly connected components
 */
function _detectSCCs(graph: Map<string, PlanNode>): Map<string, string[]> {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs = new Map<string, string[]>(); // sccId -> nodeIds
  let indexCounter = 0;

  function strongConnect(nodeId: string): void {
    // Set the depth index for this node to the smallest unused index
    index.set(nodeId, indexCounter);
    lowlink.set(nodeId, indexCounter);
    indexCounter++;
    stack.push(nodeId);
    onStack.add(nodeId);

    // Consider successors of nodeId
    const node = graph.get(nodeId)!;
    for (const successorId of node.upstreamIds) {
      // upstreamIds are our dependencies
      if (!index.has(successorId)) {
        // Successor has not yet been visited; recurse on it
        strongConnect(successorId);
        lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, lowlink.get(successorId)!));
      } else if (onStack.has(successorId)) {
        // Successor is in stack and hence in the current SCC
        lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, index.get(successorId)!));
      }
    }

    // If nodeId is a root node, pop the stack and create an SCC
    if (lowlink.get(nodeId) === index.get(nodeId)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== nodeId);

      // Only create SCC entry if it has more than one node OR is a self-referencing node
      const isSelfReferencing = scc.length === 1 && graph.get(scc[0]!)!.upstreamIds.has(scc[0]!);
      if (scc.length > 1 || isSelfReferencing) {
        const sccId = `scc-${scc.sort().join('-')}`;
        sccs.set(sccId, scc);

        // Mark all nodes in this SCC
        for (const sccNodeId of scc) {
          const sccNode = graph.get(sccNodeId)!;
          const newSccNode: PlanNode = { ...sccNode, isAcyclic: false, sccId };
          graph.set(sccNodeId, newSccNode);
        }
      }
    }
  }

  // Run Tarjan's algorithm
  for (const nodeId of graph.keys()) {
    if (!index.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  return sccs;
}

/**
 * Creates topologically ordered execution units from the graph and SCCs
 */
function _createPlanUnits(graph: Map<string, PlanNode>, sccs: Map<string, string[]>): PlanUnit[] {
  const planUnits: PlanUnit[] = [];
  const processed = new Set<string>();

  // Create SCC units
  for (const [sccId, memberIds] of sccs) {
    planUnits.push({
      type: 'scc',
      nodeIds: memberIds,
      sccId
    });

    // Mark all SCC members as processed
    for (const memberId of memberIds) {
      processed.add(memberId);
    }
  }

  // Create acyclic units for remaining nodes
  for (const [nodeId, node] of graph) {
    if (!processed.has(nodeId) && node.isAcyclic) {
      planUnits.push({
        type: 'acyclic',
        nodeId
      });
    }
  }

  // Proper topological sort over condensation DAG (SCC super-nodes + acyclic nodes)
  // Build component mapping: componentId = sccId || nodeId
  const componentIds = new Set<string>();
  const nodeToComponent = new Map<string, string>();
  for (const [nodeId, node] of graph) {
    const compId = node.isAcyclic ? nodeId : node.sccId;
    nodeToComponent.set(nodeId, compId);
    componentIds.add(compId);
  }

  // Build edges between components
  const compGraph = new Map<string, Set<string>>(); // comp -> downstream comps
  const compInDegree = new Map<string, number>();
  for (const compId of componentIds) {
    compGraph.set(compId, new Set());
    compInDegree.set(compId, 0);
  }
  for (const [nodeId, node] of graph) {
    const fromComp = nodeToComponent.get(nodeId)!;
    for (const upstreamId of node.upstreamIds) {
      const toComp = nodeToComponent.get(upstreamId)!;
      if (fromComp !== toComp) {
        // Edge from upstream component to this component
        // (upstreamId -> nodeId), so toComp -> fromComp
        if (!compGraph.get(toComp)!.has(fromComp)) {
          compGraph.get(toComp)!.add(fromComp);
          compInDegree.set(fromComp, (compInDegree.get(fromComp) ?? 0) + 1);
        }
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [compId, indeg] of compInDegree) {
    if (indeg === 0) queue.push(compId);
  }

  const sortedComponents: string[] = [];
  while (queue.length) {
    const compId = queue.shift()!;
    sortedComponents.push(compId);
    for (const nbr of compGraph.get(compId)!) {
      compInDegree.set(nbr, compInDegree.get(nbr)! - 1);
      if (compInDegree.get(nbr) === 0) queue.push(nbr);
    }
  }

  // Map components to plan units in sorted order
  const compToUnit = new Map<string, PlanUnit>();
  for (const unit of planUnits) {
    const compId = unit.type === 'scc' ? unit.sccId : unit.nodeId;
    compToUnit.set(compId, unit);
  }

  const topoSortedUnits: PlanUnit[] = [];
  for (const compId of sortedComponents) {
    const unit = compToUnit.get(compId);
    if (unit) topoSortedUnits.push(unit);
  }

  return topoSortedUnits;
}

/**
 * Main entry point for creating an execution plan
 */
export const createExecutionPlan = async (
  appDal: AppDal,
  rootDerivationId: string
): Promise<{ success: true; plan: ExecutionPlan } | { success: false; error: PlanningError }> => {
  logger('INFO', `Creating execution plan for derivation ${rootDerivationId}`);

  // Build dependency graph
  const graphResult = await _buildDependencyGraph(appDal, rootDerivationId);
  if (!graphResult.success) {
    return { success: false, error: graphResult.error };
  }

  const graph = graphResult.graph;

  // Detect SCCs
  const sccs = _detectSCCs(graph);
  const hasCycles = sccs.size > 0;

  if (hasCycles) {
    logger('INFO', `Detected ${sccs.size} strongly connected components`);
    for (const [sccId, members] of sccs) {
      logger('INFO', `SCC ${sccId}: [${members.join(', ')}]`);
    }
  }

  // Create execution plan
  const planUnits = _createPlanUnits(graph, sccs);

  const plan: ExecutionPlan = {
    planNodes: graph,
    planUnits,
    hasCycles
  };

  logger('INFO', `Execution plan created with ${planUnits.length} units`);
  return { success: true, plan };
};

/**
 * Finds the SCC unit that contains the given node ID, if any
 */
export const getSccContaining = (
  plan: ExecutionPlan,
  nodeId: string
): Prettify<PlanUnit & { type: 'scc' }> | undefined => {
  return plan.planUnits.find(
    (unit): unit is PlanUnit & { type: 'scc' } =>
      unit.type === 'scc' && unit.nodeIds.includes(nodeId)
  );
};
