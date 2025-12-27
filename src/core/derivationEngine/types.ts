import { ExecutionTree } from '../db/types.js';
import type { ExecutionPlan } from './planner.js';

// Engine event types (discriminated union)
export type PlanReadyEvent = {
  type: 'PLAN_READY';
  plan: ExecutionPlan;
};

export type StepCompleteEvent = {
  type: 'STEP_COMPLETE';
  derivationId: string;
  execTree: ExecutionTree;
  tokensOutput?: number; // only present for LLM ops
};

export type EngineEvent = PlanReadyEvent | StepCompleteEvent;

export type OnEngineEvent = (event: EngineEvent) => void;

/**
 * SCC execution options
 */
export interface SccOptions {
  coverAllNTimes?: number; // default 1
  // FIXME is last-cache still necessary if step caching is universal?
  seedPolicy?: 'empty' | 'last-cache'; // default 'empty'
}

/**
 * Value stored in iteration buffer
 */
export interface IterationValue {
  content: string;
  executionTree: ExecutionTree;
}

/**
 * Result of SCC evaluation
 */
export type SccResult =
  | {
      success: true;
      memberResults: Map<
        string,
        {
          content: string;
          contentHash: string;
          executionTree: ExecutionTree;
        }
      >;
      iterationCount: number;
      sccId: string;
    }
  | {
      success: false;
      sccId: string;
      error: string;
    };

/**
 * Execution context for SCC evaluation
 */
export interface SccExecutionContext {
  sccId: string;
  iterationBuffer: Map<string, IterationValue>;
  // Per-node remaining compute budget during SCC recursive unrolling
  remainingBudgetByNode: Map<string, number>;
}

export interface OperationOptions {
  environment: 'production' | 'test';
}

// TODO move? rename?
export interface GetOrComputeDerivedContentByStepOpts {
  operationOptions?: Partial<OperationOptions>;
  // SCC execution context (internal use)
  sccContext?: SccExecutionContext;
  // Skip cache lookup and force re-evaluation
  skipCache?: boolean;
  // Event callback for progress updates
  onEvent?: OnEngineEvent;
  // Reuse existing plan from parent call (avoids redundant planning)
  plan?: ExecutionPlan;
}

// TODO move? rename?
// Options for the top-level getOrComputeDerivedContent function
export interface GetOrComputeDerivedContentOpts extends GetOrComputeDerivedContentByStepOpts {
  // SCC execution options (user-facing configuration)
  scc?: SccOptions;
}
