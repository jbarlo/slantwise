import { RateLimitQueue, AsyncTaskProcessor, RollingWindowLimits } from './rateLimitQueue.js';

const DEFAULT_LIMITS: Required<RollingWindowLimits> = {
  windowMs: 60_000,
  maxRequests: 5_000,
  maxTokens: 30_000
};

interface ModelQueueConfig<Data, Result> {
  processor: AsyncTaskProcessor<Data, Result>;
  limits?: RollingWindowLimits;
}

type ModelVariables = Record<
  string,
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processorData: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processorResult: any;
  }
>;

type ModelData<C extends ModelVariables, M extends keyof C & string> = C[M]['processorData'];
type ModelResult<C extends ModelVariables, M extends keyof C & string> = C[M]['processorResult'];

type Configs<C extends ModelVariables> = {
  [K in keyof C]: ModelQueueConfig<ModelData<C, K & string>, ModelResult<C, K & string>>;
};

export class ModelRateLimitManager<C extends ModelVariables> {
  private readonly configs: Configs<C>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly queues = new Map<string, RateLimitQueue<any, any>>();

  constructor(configs: Configs<C>) {
    this.configs = configs;
  }

  /** Returns an existing queue for the model or creates it on first use */
  getQueue<M extends keyof Configs<C> & string>(modelId: M) {
    let queue = this.queues.get(modelId) as
      | RateLimitQueue<ModelData<C, M>, ModelResult<C, M>>
      | undefined;
    if (!queue) {
      const cfg = this.configs[modelId];
      if (!cfg) {
        throw new Error(`No processor configured for model '${modelId}'.`);
      }
      const limits: RollingWindowLimits = {
        windowMs: cfg.limits?.windowMs ?? DEFAULT_LIMITS.windowMs,
        maxRequests: cfg.limits?.maxRequests ?? DEFAULT_LIMITS.maxRequests,
        maxTokens: cfg.limits?.maxTokens ?? DEFAULT_LIMITS.maxTokens
      };
      queue = new RateLimitQueue(cfg.processor, limits);
      this.queues.set(modelId, queue);
    }
    return queue;
  }

  /** Delegates to the appropriate RateLimitQueue */
  enqueue<M extends keyof Configs<C> & string>(
    modelId: M,
    taskId: string,
    data: ModelData<C, M>,
    meta?: {
      tokens?: number;
      adjustTokens?: (result: ModelResult<C, M>) => number | undefined;
    }
  ) {
    const queue = this.getQueue(modelId);
    return queue.enqueue(taskId, data, meta);
  }
}

/**
 * Helper to automatically infer the generic types
 */
export const createRateLimitManager = <
  Cfg extends {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [K in keyof Cfg]: ModelQueueConfig<any, any>;
  }
>(
  configs: Cfg
) => {
  // Extract the processor data and result types from the configs explicitly
  // since the important types are part of function signatures (contravariant)
  type Inferred = {
    [K in keyof Cfg]: {
      processorData: Parameters<Cfg[K]['processor']>[0];
      processorResult: Awaited<ReturnType<Cfg[K]['processor']>>;
    };
  };

  return new ModelRateLimitManager<Inferred>(configs);
};

export const createMockRateLimitManager = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Q extends RateLimitQueue<any, any>,
  C extends ModelVariables
>(
  mockQueue: Q
): ModelRateLimitManager<C> => {
  return {
    getQueue: () => mockQueue,
    enqueue: mockQueue.enqueue
  } as unknown as ModelRateLimitManager<C>;
};
