import { isNil } from 'lodash-es';
import {
  logQueueTaskAdded,
  logQueueDuplicateTask,
  logQueueEmpty,
  logQueueProcessingTask,
  logQueueTaskSuccess,
  logQueueTaskError,
  logQueueProcessorLoopError,
  logQueueInit
} from '../logger.js';

// Type for the function that processes a task item
export type AsyncTaskProcessor<TData, TResult> = (data: TData) => Promise<TResult>;

// Interface for a task within the queue
interface QueueTask<TData, TResult> {
  id: string; // Unique identifier for the task (e.g., content hash)
  tokens: number;
  adjustTokens?: (result: TResult) => number | undefined;
  data: TData; // Data needed by the processor function
  resolve: (result: TResult) => void;
  reject: (error: unknown) => void;
}

// Historical entry used to track rolling-window consumption
interface UsageEntry {
  at: number; // epoch ms
  reqWeight: number; // always 1 – request budget
  tokenWeight: number;
}

export interface RollingWindowLimits {
  /** Window size in milliseconds (default 60 000) */
  windowMs?: number;
  /** Max requests within the window (Infinity for none) */
  maxRequests: number;
  /** Max tokens within the window (Infinity for none) */
  maxTokens?: number;
}

export class RateLimitQueue<TData, TResult> {
  private queue: QueueTask<TData, TResult>[] = [];
  private pendingIds = new Set<string>();
  // History of tasks that started within the current window (sorted by time asc)
  private usageHistory: UsageEntry[] = [];
  private limits: Required<RollingWindowLimits>;
  private processor: AsyncTaskProcessor<TData, TResult>;
  private queueId: string;
  private processingTimer: NodeJS.Timeout | null = null;

  constructor(processor: AsyncTaskProcessor<TData, TResult>, cfg: RollingWindowLimits) {
    this.limits = {
      windowMs: cfg.windowMs ?? 60_000,
      maxRequests: cfg.maxRequests,
      maxTokens: cfg.maxTokens ?? Infinity
    };

    if (this.limits.maxRequests <= 0 || this.limits.windowMs <= 0) {
      throw new Error('Limits must be positive numbers.');
    }

    this.processor = processor;
    this.queueId = Math.random().toString(36).substring(2, 7);
    logQueueInit(this.queueId, this.limits.maxRequests, this.limits.windowMs);
  }

  /**
   * Enqueues a task. Optional `meta.tokens` allows the caller to specify the
   * expected token cost of the request; defaults to 0 for compatibility.
   */
  enqueue(
    id: string,
    data: TData,
    meta?: {
      tokens?: number;
      adjustTokens?: (result: TResult) => number | undefined;
    }
  ): Promise<TResult> {
    if (this.pendingIds.has(id)) {
      logQueueDuplicateTask(this.queueId, id);
      return Promise.reject(new Error(`Task with ID ${id} is already pending.`));
    }

    return new Promise((resolve, reject) => {
      this.pendingIds.add(id);
      const task: QueueTask<TData, TResult> = {
        id,
        data,
        tokens: meta?.tokens ?? 0,
        adjustTokens: meta?.adjustTokens,
        resolve,
        reject
      };
      this.queue.push(task);
      logQueueTaskAdded(this.queueId, id, false, this.queue.length);
      this._scheduleProcessing();
    });
  }

  // Schedules processing either immediately or after the necessary delay
  private _scheduleProcessing() {
    if (this.processingTimer) return; // already scheduled/processing
    this._processQueue();
  }

  private _cleanUpHistory(now: number) {
    const windowStart = now - this.limits.windowMs;
    while (this.usageHistory.length > 0) {
      const first = this.usageHistory[0]!; // non-null because length > 0
      if (first.at <= windowStart) {
        this.usageHistory.shift();
      } else {
        break;
      }
    }
  }

  /** Returns current usage within window */
  private _currentUsage(now: number) {
    this._cleanUpHistory(now);
    let reqs = 0;
    let toks = 0;
    for (const entry of this.usageHistory) {
      reqs += entry.reqWeight;
      toks += entry.tokenWeight;
    }
    return { reqs, toks };
  }

  private _canStartTask(task: QueueTask<TData, TResult>, now: number): boolean {
    const { reqs, toks } = this._currentUsage(now);
    const willReqs = reqs + 1;
    const willToks = toks + task.tokens;
    return willReqs <= this.limits.maxRequests && willToks <= this.limits.maxTokens;
  }

  private _nextAvailableDelay(now: number): number {
    if (this.usageHistory.length === 0) return 0;
    const oldest = this.usageHistory[0]!; // non-null, checked above
    const expiry = oldest.at + this.limits.windowMs;
    return Math.max(0, expiry - now);
  }

  private _processQueue() {
    // Launch as many tasks as budgets allow
    while (this.queue.length > 0 && this._canStartTask(this.queue[0]!, Date.now())) {
      const task = this.queue.shift()!;
      this._launchTask(task);
    }

    if (this.queue.length === 0) {
      logQueueEmpty(this.queueId);
      this.processingTimer = null;
      return;
    }

    // We still have tasks but budgets exceeded. Schedule wake-up at earliest expiry.
    const delay = this._nextAvailableDelay(Date.now());
    this.processingTimer = setTimeout(() => {
      this.processingTimer = null;
      this._processQueue();
    }, delay + 1); // +1ms to be safely after window
  }

  private _launchTask(task: QueueTask<TData, TResult>) {
    const now = Date.now();
    logQueueProcessingTask(this.queueId, task.id);

    // Register usage
    this.usageHistory.push({ at: now, reqWeight: 1, tokenWeight: task.tokens });

    // Fire & forget; completion doesn’t affect budget (already accounted)
    (async () => {
      try {
        const result = await this.processor(task.data);
        logQueueTaskSuccess(this.queueId, task.id);
        // If caller provided completion hook, adjust token budget
        if (task.adjustTokens) {
          try {
            const actualTokens = task.adjustTokens(result);
            if (!isNil(actualTokens) && actualTokens >= 0) {
              const delta = actualTokens - task.tokens;
              if (delta !== 0) {
                // Record adjustment (negative releases budget)
                this.usageHistory.push({
                  at: Date.now(),
                  reqWeight: 0,
                  tokenWeight: delta
                });
              }
            }
          } catch {
            // swallow errors from adjustTokens
          }
        }
        task.resolve(result);
      } catch (error) {
        logQueueTaskError(this.queueId, task.id, error);
        task.reject(error);
      } finally {
        this.pendingIds.delete(task.id);
        // Attempt to process more tasks now that one finished (latency optimisation)
        this._scheduleProcessing();
      }
    })().catch((err) => {
      logQueueProcessorLoopError(this.queueId, err);
    });
  }
}

export const createMockQueue = <TData, TResult>(
  processor?: AsyncTaskProcessor<TData, TResult>
): RateLimitQueue<TData, TResult> => {
  return {
    enqueue: async (_id: string, data: TData): Promise<TResult> => {
      if (processor) return processor(data);
      return {} as TResult;
    }
  } as unknown as RateLimitQueue<TData, TResult>;
};
