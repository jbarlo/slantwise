import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimitQueue } from './rateLimitQueue.js';

describe('RateLimitQueue (rolling window)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('respects request-per-minute limit', async () => {
    const processed: string[] = [];
    const q = new RateLimitQueue<string, string>(
      async (data) => {
        processed.push(data);
        return data;
      },
      { windowMs: 60_000, maxRequests: 2 }
    );

    const p1 = q.enqueue('1', '1');
    const p2 = q.enqueue('2', '2');
    const p3 = q.enqueue('3', '3');

    // Flush any microtasks; zero timers shouldn’t advance window
    await Promise.allSettled([p1, p2]);
    expect(processed).toEqual(['1', '2']);

    // Task 3 should still be pending until the window passes
    expect(processed).toHaveLength(2);

    // Advance time by one full window
    vi.advanceTimersByTime(60_000);
    await vi.runOnlyPendingTimersAsync();
    await p3;
    expect(processed).toEqual(['1', '2', '3']);
  });

  it('respects token budget as well as request budget', async () => {
    const processed: string[] = [];
    const q = new RateLimitQueue<string, string>(
      async (data) => {
        processed.push(data);
        return data;
      },
      { windowMs: 60_000, maxRequests: 10, maxTokens: 20 }
    );

    const p1 = q.enqueue('a', 'a', { tokens: 8 });
    const p2 = q.enqueue('b', 'b', { tokens: 8 });
    const p3 = q.enqueue('c', 'c', { tokens: 5 });

    await Promise.allSettled([p1, p2]);

    expect(processed).toEqual(['a', 'b']);

    vi.advanceTimersByTime(60_000);
    await vi.runOnlyPendingTimersAsync();
    await p3;

    expect(processed).toEqual(['a', 'b', 'c']);
  });

  it('adjusts token usage based on completion hook', async () => {
    // fake timers, actual ms value doesn't matter
    const fakeMsValue = 100;

    const processed: string[] = [];

    // Simulate a processor that takes 100ms (virtual) so we can inspect queue state
    const slowProcessor = async (data: string) => {
      processed.push(data);
      await new Promise((resolve) => setTimeout(resolve, fakeMsValue));
      return data;
    };

    const q = new RateLimitQueue<string, string>(slowProcessor, {
      windowMs: 60_000,
      maxRequests: 10,
      maxTokens: 15 // 10 + 10 would exceed this until p1 adjusts tokens → proves hook works
    });

    // p1 reserves 10 tokens but will adjust down to 2 on completion
    const p1 = q.enqueue('x', 'x', { tokens: 10, adjustTokens: () => 2 });
    // p2 would exceed the token budget until p1's adjustment happens
    const p2 = q.enqueue('y', 'y', { tokens: 10 });

    // Allow the queue to start processing (p1 should start, p2 must stay queued)
    await Promise.resolve(); // flush micro-tasks
    expect(processed).toEqual(['x']); // y hasn’t started yet because of token limit

    // Finish p1 (100ms) so adjustTokens executes and frees 8 tokens
    vi.advanceTimersByTime(fakeMsValue);
    await vi.runOnlyPendingTimersAsync();
    await p1;

    // p2 should now have started (its processor pushes immediately)
    expect(processed).toEqual(['x', 'y']);

    // Finish p2 as well
    vi.advanceTimersByTime(fakeMsValue);
    await vi.runOnlyPendingTimersAsync();
    await p2;

    expect(processed).toEqual(['x', 'y']);
  });
});
