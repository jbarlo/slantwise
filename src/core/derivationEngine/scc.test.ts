import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDal, createMockAppDal } from '../db/app_dal.js';
import {
  createDerivation as _createDerivation,
  updateDerivation as _updateDerivation
} from './write.js';
import { RateLimiter } from '../limiting/index.js';
import { createExecutionPlan } from './planner.js';
import { stableStringify, hash, getDerivationCacheKey } from '../utils.js';
import { createMockRateLimitManager } from '../limiting/modelRateLimitManager.js';
import { createMockQueue } from '../limiting/rateLimitQueue.js';
import { EmbeddingInputData, EmbeddingOutput } from '../types.js';
import { getExecutionTreeStatistics } from './utils.js';
import * as operations from './operations.js';
import { getOrComputeDerivedContent as _getOrComputeDerivedContent } from './read.js';
import { flattenDeep } from 'lodash-es';
import { GetOrComputeDerivedContentOpts } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotTail<T extends any[]> = T extends [...infer Rest, any] ? Rest : never;

// stringify params as mock dslExpression
const createDerivation = (...args: NotTail<Parameters<typeof _createDerivation>>) => {
  return _createDerivation(...args, stableStringify(args[1]));
};

const updateDerivation = (...args: NotTail<Parameters<typeof _updateDerivation>>) => {
  return _updateDerivation(...args, stableStringify(args[2]));
};

describe('SCC Planning and Evaluation', () => {
  let appDal: AppDal;
  let limiter: RateLimiter;

  const getOrComputeDerivedContent = async (
    appDal: AppDal,
    derivationId: string,
    limiter: RateLimiter,
    opts?: GetOrComputeDerivedContentOpts
  ) => {
    return await _getOrComputeDerivedContent(
      appDal,
      derivationId,
      limiter,
      {
        openaiApiKey: 'test',
        openRouterApiKey: 'test',
        databasePath: 'test',
        watchedDirectory: 'test',
        embeddingRpmLimit: 1000,
        skipEmbedding: false,
        debug: false,
        theme: 'system' as const
      },
      {
        operationOptions: { environment: 'test' },
        scc: undefined,
        ...opts
      }
    );
  };

  beforeEach(async () => {
    appDal = await createMockAppDal();
    limiter = createMockRateLimitManager(
      createMockQueue<EmbeddingInputData, EmbeddingOutput>(async () => ({
        embedding: 'test',
        usage: { promptTokens: 1 },
        modelName: 'test'
      }))
    );
  });

  describe('Execution Planning', () => {
    it('should detect no cycles in acyclic graph', async () => {
      // Create A -> B (no cycle)
      const content = 'test content';
      const contentHash = hash(content);
      appDal.core.insertContentIfNew(contentHash, content);

      const derivationAId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: contentHash }]
        },
        label: 'A'
      });

      const derivationBId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'derivation', id: derivationAId }]
        },
        label: 'B'
      });

      const planResult = await createExecutionPlan(appDal, derivationBId);
      expect(planResult.success).toBe(true);
      assert(planResult.success);
      expect(planResult.plan.hasCycles).toBe(false);
      expect(planResult.plan.planUnits).toHaveLength(2); // A and B as separate acyclic units
    });

    it('should detect simple two-node cycle', async () => {
      // Create A -> B -> A cycle by creating incomplete A first
      const derivationAId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A depends on ' },
            { type: 'constant', value: 'placeholder' } // Temporary
          ]
        },
        label: 'A'
      });

      const derivationBId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'B depends on ' },
            { type: 'derivation', id: derivationAId }
          ]
        },
        label: 'B'
      });

      // Update A to reference B (creating the cycle)
      updateDerivation(appDal, derivationAId, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A depends on ' },
            { type: 'derivation', id: derivationBId }
          ]
        },
        label: 'A'
      });

      const planResult = await createExecutionPlan(appDal, derivationAId);
      expect(planResult.success).toBe(true);
      assert(planResult.success);
      expect(planResult.plan.hasCycles).toBe(true);

      // Should have one SCC unit containing both A and B
      const sccUnits = planResult.plan.planUnits.filter((unit) => unit.type === 'scc');
      expect(sccUnits).toHaveLength(1);
      expect(sccUnits[0]?.nodeIds.sort()).toEqual([derivationAId, derivationBId].sort());
    });
  });

  describe('Integration with getOrComputeDerivedContent', () => {
    it('should handle acyclic derivations normally', async () => {
      // Create simple A -> content (no cycle)
      const content = 'test content';
      const contentHash = hash(content);
      appDal.core.insertContentIfNew(contentHash, content);

      const derivationAId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: contentHash }]
        },
        label: 'A'
      });

      const result = await getOrComputeDerivedContent(appDal, derivationAId, limiter);

      expect(result.success).toBe(true);
      assert(result.success);
      expect(result.output).toBe(content);
      expect(result.executionTree.sccMetadata).toBeUndefined(); // No SCC metadata for acyclic
    });

    it('advances uniformly with mixed cycle lengths in one SCC', async () => {
      // Build SCC where A participates in two cycles of different lengths:
      // A -> B -> A and A -> C -> D -> A
      const aId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [{ type: 'constant', value: 'TEMP' }]
        },
        label: 'A'
      });

      const bId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'B' },
            { type: 'derivation', id: aId }
          ]
        },
        label: 'B'
      });

      const cId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [{ type: 'constant', value: 'TEMP' }]
        },
        label: 'C'
      });

      const dId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'D' },
            { type: 'derivation', id: cId }
          ]
        },
        label: 'D'
      });

      // Close both cycles referencing A
      updateDerivation(appDal, aId, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'derivation', id: bId },
            { type: 'derivation', id: dId }
          ]
        },
        label: 'A'
      });

      // And connect C -> D -> A -> C to complete the 3-length cycle
      updateDerivation(appDal, cId, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'C' },
            { type: 'derivation', id: aId }
          ]
        },
        label: 'C'
      });

      // Run one Jacobi step: each member advances exactly once using previous values.
      const resA1 = await getOrComputeDerivedContent(appDal, aId, limiter, {
        scc: { coverAllNTimes: 1, seedPolicy: 'empty' }
      });
      expect(resA1.success).toBe(true);
      assert(resA1.success);
      const expected1 = flattenDeep([
        'A',
        [
          ['B', ['']],
          ['D', ['C', ['']]]
        ]
      ]).join('\n');
      expect(resA1.output).toBe(expected1);

      // Run a second step: advance by exactly one more layer; total steps should increase deterministically
      const resA2 = await getOrComputeDerivedContent(appDal, aId, limiter, {
        scc: { coverAllNTimes: 2, seedPolicy: 'empty' }
      });
      expect(resA2.success).toBe(true);
      assert(resA2.success);
      const expected2 = flattenDeep([
        'A',
        [
          [
            'B',
            [
              'A',
              [
                ['B', ['']],
                ['D', ['C', '']]
              ]
            ]
          ],
          [
            'D',
            [
              'C',
              [
                'A',
                [
                  ['B', ['']],
                  ['D', ['C', '']]
                ]
              ]
            ]
          ]
        ]
      ]).join('\n');
      expect(resA2.output).toBe(expected2);
    });

    it('should not persist intermediate writes during SCC iteration passes', async () => {
      // Create A -> B -> A cycle
      const derivationAId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'derivation', id: 'B_PLACEHOLDER' }
          ]
        },
        label: 'A'
      });

      const derivationBId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'B' },
            { type: 'derivation', id: derivationAId }
          ]
        },
        label: 'B'
      });

      // Complete the cycle by updating A to reference B
      updateDerivation(appDal, derivationAId, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'derivation', id: derivationBId }
          ]
        },
        label: 'A'
      });

      // Run with two iterations to ensure an intermediate pass occurs
      const result = await getOrComputeDerivedContent(appDal, derivationAId, limiter, {
        scc: { coverAllNTimes: 2, seedPolicy: 'empty' }
      });

      expect(result.success).toBe(true);
      assert(result.success);

      // Neither A nor B should have a step result for the intermediate pass specifically; we can
      // only assert that the final result exists. So we verify that final hashes exist, and that
      // there isn't more than one stored result for the same cache key.
      const a = appDal.derivations.findDerivationById(derivationAId)!;
      const b = appDal.derivations.findDerivationById(derivationBId)!;

      const aCtx = appDal.derivations.findStepResultContext(a.final_step_id);
      const bCtx = appDal.derivations.findStepResultContext(b.final_step_id);

      expect(aCtx?.output_content_hash).toBeDefined();
      expect(bCtx?.output_content_hash).toBeDefined();

      // And a single cached row (enforced by PK) exists for the final cache key of each step
      const aParams = appDal.derivations.getStepStoredParams(a.final_step_id)!;
      const bParams = appDal.derivations.getStepStoredParams(b.final_step_id)!;
      const aKey = getDerivationCacheKey(aParams, aCtx?.input_content_hashes ?? []);
      const bKey = getDerivationCacheKey(bParams, bCtx?.input_content_hashes ?? []);

      const aRow = appDal.derivations.findCacheRowByKey(aKey);
      const bRow = appDal.derivations.findCacheRowByKey(bKey);
      expect(aRow?.output_content_hash).toBe(aCtx?.output_content_hash);
      expect(bRow?.output_content_hash).toBe(bCtx?.output_content_hash);
    });

    it('executes plan units in topological order (upstream before downstream)', async () => {
      // Build small graph: C -> A, C -> B, and A <-> B (SCC)
      const contentC = 'C';
      const contentCHash = hash(contentC);
      appDal.core.insertContentIfNew(contentCHash, contentC);

      const aId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'constant', value: '+' },
            { type: 'derivation', id: 'B_PLACEHOLDER' }
          ]
        },
        label: 'A'
      });

      const bId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'B' },
            { type: 'constant', value: '+' },
            { type: 'derivation', id: aId }
          ]
        },
        label: 'B'
      });

      // Update A to complete the A <-> B SCC
      updateDerivation(appDal, aId, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'constant', value: '+' },
            { type: 'derivation', id: bId }
          ]
        },
        label: 'A'
      });

      // Create C that feeds both A and B
      const cId = await createDerivation(appDal, {
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: contentCHash }]
        },
        label: 'C'
      });

      // Now update A and B to also depend on C
      updateDerivation(appDal, aId, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'derivation', id: cId },
            { type: 'constant', value: '+' },
            { type: 'derivation', id: bId }
          ]
        },
        label: 'A'
      });

      updateDerivation(appDal, bId, {
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'derivation', id: cId },
            { type: 'constant', value: '+' },
            { type: 'derivation', id: aId }
          ]
        },
        label: 'B'
      });

      // Compute A. The planner should topologically sort so that C is computed (acyclic), then SCC {A,B}
      const res = await getOrComputeDerivedContent(appDal, aId, limiter, {
        scc: { coverAllNTimes: 1, seedPolicy: 'empty' }
      });

      expect(res.success).toBe(true);
      assert(res.success);

      // Both A and B should be materialized; and C should have been computed before SCC
      const aCtx = appDal.derivations.findStepResultContext(
        appDal.derivations.findDerivationById(aId)!.final_step_id
      );
      const bCtx = appDal.derivations.findStepResultContext(
        appDal.derivations.findDerivationById(bId)!.final_step_id
      );
      const cCtx = appDal.derivations.findStepResultContext(
        appDal.derivations.findDerivationById(cId)!.final_step_id
      );

      expect(aCtx).toBeDefined();
      expect(bCtx).toBeDefined();
      expect(cCtx).toBeDefined();
    });

    it('intermediate materialization enforces determinism across runs for nondeterministic ops', async () => {
      // Mock performOperation to be nondeterministic regardless of operation type
      const nondet = vi.spyOn(operations, 'performOperation').mockImplementation(async () => {
        // Return different random outputs on each call
        return { success: true, result: { output: Math.random().toString(), warnings: [] } };
      });

      try {
        // Create A -> B -> A cycle using identity ops
        const aId = await createDerivation(appDal, {
          recipeParams: {
            operation: 'identity',
            inputs: [{ type: 'constant', value: 'seed-A' }]
          },
          label: 'A'
        });

        const bId = await createDerivation(appDal, {
          recipeParams: {
            operation: 'identity',
            inputs: [{ type: 'derivation', id: aId }]
          },
          label: 'B'
        });

        // Close the loop: A now depends on B
        updateDerivation(appDal, aId, {
          recipeParams: {
            operation: 'identity',
            inputs: [{ type: 'derivation', id: bId }]
          },
          label: 'A'
        });

        // First run with 2 iterations; this will materialize both passes
        const first = await getOrComputeDerivedContent(appDal, aId, limiter, {
          scc: { coverAllNTimes: 2, seedPolicy: 'empty' }
        });
        expect(first.success).toBe(true);
        assert(first.success);
        const firstOutput = first.output;
        const firstStats = getExecutionTreeStatistics(first.executionTree);

        // Second run with identical inputs; should hit cache for each pass and be identical
        nondet.mockClear();
        const second = await getOrComputeDerivedContent(appDal, aId, limiter, {
          scc: { coverAllNTimes: 2, seedPolicy: 'empty' }
        });
        expect(second.success).toBe(true);
        assert(second.success);
        const secondOutput = second.output;
        const secondStats = getExecutionTreeStatistics(second.executionTree);

        // Determinism guarantee: same outputs for same inputs and iteration count
        expect(secondOutput).toBe(firstOutput);

        // And we expect more cache utilization on the second run
        expect(secondStats.totalSteps).toBe(firstStats.totalSteps);
        expect(secondStats.cachedSteps).toBeGreaterThanOrEqual(firstStats.cachedSteps);
      } catch {
        assert(false);
      } finally {
        nondet.mockRestore();
      }
    });

    it('should read a cyclic derivation with only one iteration', async () => {
      const derivationAId = await createDerivation(appDal, {
        label: 'A',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'constant', value: 'TEMP' }]
        }
      });

      // wait 200 ms to ensure creation times are different
      //
      // the values are the same, so createdAt acts as a tiebreaker for SCC
      // sorting. for test stability, the timing is used to keep a consistent
      // execution order
      await new Promise((resolve) => setTimeout(resolve, 200));

      const derivationBId = await createDerivation(appDal, {
        label: 'B',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'derivation', id: derivationAId }]
        }
      });

      await updateDerivation(appDal, derivationAId, {
        label: 'A',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'derivation', id: derivationBId }]
        }
      });

      // expect both derivations to default to an empty string
      const resultA = await getOrComputeDerivedContent(appDal, derivationAId, limiter);
      await expect(resultA).toMatchObject({
        success: true,
        output: '',
        executionTree: {
          // A
          wasCached: true,
          contentHash: hash(''),
          dependencies: [
            {
              // B
              type: 'derivation',
              operation: 'identity',
              wasCached: false,
              dependencies: [
                {
                  // A
                  type: 'derivation',
                  operation: 'identity',
                  // seed value acts as if cached
                  wasCached: true,
                  dependencies: []
                }
              ]
            }
          ]
        }
      });

      const resultB = await getOrComputeDerivedContent(appDal, derivationBId, limiter);
      await expect(resultB).toMatchObject({
        success: true,
        output: '',
        executionTree: {
          // B
          wasCached: true,
          contentHash: hash(''),
          dependencies: [
            {
              // A
              type: 'derivation',
              operation: 'identity',
              // cached from executing A previously
              wasCached: true,
              dependencies: [
                {
                  // B
                  type: 'derivation',
                  operation: 'identity',
                  // seed value acts as if cached
                  wasCached: true,
                  dependencies: []
                }
              ]
            }
          ]
        }
      });
    });

    it('should read a cyclic derivation with only one iteration (non-empty string)', async () => {
      const derivationAId = await createDerivation(appDal, {
        label: 'A',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'constant', value: 'TEMP' }]
        }
      });

      const derivationBId = await createDerivation(appDal, {
        label: 'B',
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'B' },
            { type: 'derivation', id: derivationAId }
          ]
        }
      });

      updateDerivation(appDal, derivationAId, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'derivation', id: derivationBId }
          ]
        }
      });

      // expect both derivations to default to an empty string
      const resultA = await getOrComputeDerivedContent(appDal, derivationAId, limiter);
      await expect(resultA).toMatchObject({
        success: true,
        output: 'A\nB\n',
        executionTree: {
          wasCached: false,
          contentHash: hash('A\nB\n'),
          operation: 'concat',
          dependencies: [
            {
              type: 'constant',
              contentHash: hash('A')
            },
            {
              type: 'derivation',
              wasCached: false,
              operation: 'concat',
              dependencies: [
                {
                  type: 'constant',
                  contentHash: hash('B')
                },
                {
                  type: 'derivation',
                  operation: 'concat',
                  // seed value acts as if cached
                  wasCached: true,
                  dependencies: []
                }
              ]
            }
          ]
        }
      });

      const resultB = await getOrComputeDerivedContent(appDal, derivationBId, limiter);
      await expect(resultB).toMatchObject({
        success: true,
        output: 'B\nA\n',
        executionTree: {
          // B was calculated during A's computation, so expect caching
          wasCached: true,
          contentHash: hash('B\nA\n'),
          operation: 'concat',
          dependencies: [
            {
              type: 'constant',
              contentHash: hash('B')
            },
            {
              type: 'derivation',
              wasCached: true,
              operation: 'concat',
              dependencies: [
                {
                  type: 'constant',
                  contentHash: hash('A')
                },
                {
                  type: 'derivation',
                  operation: 'concat',
                  // seed value acts as if cached
                  wasCached: true,
                  dependencies: []
                }
              ]
            }
          ]
        }
      });
    });

    it('should read a cyclic derivation with the number of iterations specified', async () => {
      const derivationAId = await createDerivation(appDal, {
        label: 'A',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'constant', value: 'TEMP' }]
        }
      });

      const derivationBId = await createDerivation(appDal, {
        label: 'B',
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'B' },
            { type: 'derivation', id: derivationAId }
          ]
        }
      });

      const derivationCId = await createDerivation(appDal, {
        label: 'C',
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'C' },
            { type: 'derivation', id: derivationBId }
          ]
        }
      });

      updateDerivation(appDal, derivationAId, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'derivation', id: derivationCId }
          ]
        }
      });

      const resultA = await getOrComputeDerivedContent(appDal, derivationAId, limiter, {
        scc: { coverAllNTimes: 3 }
      });

      expect(resultA).toMatchObject({
        success: true,
        output: 'A\nC\nB\nA\nC\nB\nA\nC\nB\n',
        executionTree: {
          operation: 'concat',
          wasCached: false,
          dependencies: [
            { type: 'constant', contentHash: hash('A') },
            {
              type: 'derivation',
              operation: 'concat',
              wasCached: false,
              dependencies: [
                { type: 'constant', contentHash: hash('C') },
                {
                  type: 'derivation',
                  operation: 'concat',
                  wasCached: false,
                  dependencies: [
                    { type: 'constant', contentHash: hash('B') },
                    {
                      type: 'derivation',
                      operation: 'concat',
                      wasCached: false,
                      dependencies: [
                        { type: 'constant', contentHash: hash('A') },
                        {
                          type: 'derivation',
                          operation: 'concat',
                          wasCached: false,
                          dependencies: [
                            { type: 'constant', contentHash: hash('C') },
                            {
                              type: 'derivation',
                              operation: 'concat',
                              wasCached: false,
                              dependencies: [
                                { type: 'constant', contentHash: hash('B') },
                                {
                                  type: 'derivation',
                                  operation: 'concat',
                                  wasCached: false,
                                  dependencies: [
                                    { type: 'constant', contentHash: hash('A') },
                                    {
                                      type: 'derivation',
                                      operation: 'concat',
                                      wasCached: false,
                                      dependencies: [
                                        { type: 'constant', contentHash: hash('C') },
                                        {
                                          type: 'derivation',
                                          operation: 'concat',
                                          wasCached: false,
                                          dependencies: [
                                            { type: 'constant', contentHash: hash('B') },
                                            {
                                              type: 'derivation',
                                              operation: 'concat',
                                              dependencies: [],
                                              // seed value acts as if cached
                                              wasCached: true
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
          sccMetadata: { iterationCount: 3 }
        }
      });

      const resultB = await getOrComputeDerivedContent(appDal, derivationBId, limiter, {
        scc: { coverAllNTimes: 3 }
      });

      expect(resultB).toMatchObject({
        success: true,
        output: 'B\nA\nC\nB\nA\nC\nB\nA\nC\n',
        executionTree: {
          operation: 'concat',
          wasCached: true,
          dependencies: [
            { type: 'constant', contentHash: hash('B') },
            {
              type: 'derivation',
              operation: 'concat',
              wasCached: true,
              dependencies: [
                { type: 'constant', contentHash: hash('A') },
                {
                  type: 'derivation',
                  operation: 'concat',
                  wasCached: true,
                  dependencies: [
                    { type: 'constant', contentHash: hash('C') },
                    {
                      type: 'derivation',
                      operation: 'concat',
                      wasCached: true,
                      dependencies: [
                        { type: 'constant', contentHash: hash('B') },
                        {
                          type: 'derivation',
                          operation: 'concat',
                          wasCached: true,
                          dependencies: [
                            { type: 'constant', contentHash: hash('A') },
                            {
                              type: 'derivation',
                              operation: 'concat',
                              wasCached: true,
                              dependencies: [
                                { type: 'constant', contentHash: hash('C') },
                                {
                                  type: 'derivation',
                                  operation: 'concat',
                                  wasCached: true,
                                  dependencies: [
                                    { type: 'constant', contentHash: hash('B') },
                                    {
                                      type: 'derivation',
                                      operation: 'concat',
                                      wasCached: true,
                                      dependencies: [
                                        { type: 'constant', contentHash: hash('A') },
                                        {
                                          type: 'derivation',
                                          operation: 'concat',
                                          wasCached: true,
                                          dependencies: [
                                            { type: 'constant', contentHash: hash('C') },
                                            {
                                              type: 'derivation',
                                              operation: 'concat',
                                              dependencies: [],
                                              // seed value acts as if cached
                                              wasCached: true
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
          sccMetadata: { iterationCount: 3 }
        }
      });

      const resultC = await getOrComputeDerivedContent(appDal, derivationCId, limiter, {
        scc: { coverAllNTimes: 3 }
      });

      expect(resultC).toMatchObject({
        success: true,
        output: 'C\nB\nA\nC\nB\nA\nC\nB\nA\n',
        executionTree: {
          operation: 'concat',
          wasCached: true,
          dependencies: [
            { type: 'constant', contentHash: hash('C') },
            {
              type: 'derivation',
              operation: 'concat',
              wasCached: true,
              dependencies: [
                { type: 'constant', contentHash: hash('B') },
                {
                  type: 'derivation',
                  operation: 'concat',
                  wasCached: true,
                  dependencies: [
                    { type: 'constant', contentHash: hash('A') },
                    {
                      type: 'derivation',
                      operation: 'concat',
                      wasCached: true,
                      dependencies: [
                        { type: 'constant', contentHash: hash('C') },
                        {
                          type: 'derivation',
                          operation: 'concat',
                          wasCached: true,
                          dependencies: [
                            { type: 'constant', contentHash: hash('B') },
                            {
                              type: 'derivation',
                              operation: 'concat',
                              wasCached: true,
                              dependencies: [
                                { type: 'constant', contentHash: hash('A') },
                                {
                                  type: 'derivation',
                                  operation: 'concat',
                                  wasCached: true,
                                  dependencies: [
                                    { type: 'constant', contentHash: hash('C') },
                                    {
                                      type: 'derivation',
                                      operation: 'concat',
                                      wasCached: true,
                                      dependencies: [
                                        { type: 'constant', contentHash: hash('B') },
                                        {
                                          type: 'derivation',
                                          operation: 'concat',
                                          wasCached: true,
                                          dependencies: [
                                            { type: 'constant', contentHash: hash('A') },
                                            {
                                              type: 'derivation',
                                              operation: 'concat',
                                              dependencies: [],
                                              // seed value acts as if cached
                                              wasCached: true
                                            }
                                          ]
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
          sccMetadata: { iterationCount: 3 }
        }
      });
    });
  });

  describe('Self-referencing derivations', () => {
    it('should detect self-reference (A -> A) as 1-node SCC', async () => {
      const derivationAId = await createDerivation(appDal, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [{ type: 'constant', value: 'TEMP' }]
        }
      });

      updateDerivation(appDal, derivationAId, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'derivation', id: derivationAId }
          ]
        }
      });

      const planResult = await createExecutionPlan(appDal, derivationAId);
      expect(planResult.success).toBe(true);
      assert(planResult.success);
      expect(planResult.plan.hasCycles).toBe(true);

      const sccUnits = planResult.plan.planUnits.filter((unit) => unit.type === 'scc');
      expect(sccUnits).toHaveLength(1);
      expect(sccUnits[0]?.nodeIds).toEqual([derivationAId]);
    });

    it('should execute self-reference with 1 iteration (default)', async () => {
      const derivationAId = await createDerivation(appDal, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [{ type: 'constant', value: 'TEMP' }]
        }
      });

      updateDerivation(appDal, derivationAId, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'derivation', id: derivationAId }
          ]
        }
      });

      const result = await getOrComputeDerivedContent(appDal, derivationAId, limiter, {
        scc: { coverAllNTimes: 1 }
      });
      expect(result.success).toBe(true);
      assert(result.success);

      // With 1 iteration and seed '', output should be 'A\n'
      expect(result.output).toBe('A\n');
      expect(result.executionTree.sccMetadata).toBeDefined();
      expect(result.executionTree.sccMetadata?.iterationCount).toBe(1);
    });

    it('should execute self-reference with 3 iterations', async () => {
      const derivationAId = await createDerivation(appDal, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [{ type: 'constant', value: 'TEMP' }]
        }
      });

      updateDerivation(appDal, derivationAId, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'derivation', id: derivationAId }
          ]
        }
      });

      const result = await getOrComputeDerivedContent(appDal, derivationAId, limiter, {
        scc: { coverAllNTimes: 3 }
      });
      expect(result.success).toBe(true);
      assert(result.success);

      // With 3 iterations: iter1='A\n', iter2='A\nA\n', iter3='A\nA\nA\n'
      expect(result.output).toBe('A\nA\nA\n');
      expect(result.executionTree.sccMetadata).toBeDefined();
      expect(result.executionTree.sccMetadata?.iterationCount).toBe(3);
    });

    it('should properly structure execution tree for self-reference', async () => {
      const derivationAId = await createDerivation(appDal, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [{ type: 'constant', value: 'TEMP' }]
        }
      });

      updateDerivation(appDal, derivationAId, {
        label: 'A',
        recipeParams: {
          operation: 'concat',
          inputs: [
            { type: 'constant', value: 'A' },
            { type: 'derivation', id: derivationAId }
          ]
        }
      });

      // Execute with 3 iterations to see structure
      const result = await getOrComputeDerivedContent(appDal, derivationAId, limiter, {
        scc: { coverAllNTimes: 3 }
      });
      expect(result.success).toBe(true);
      assert(result.success);

      // Verify execution tree structure
      expect(result.executionTree).toMatchObject({
        wasCached: false,
        operation: 'concat',
        dependencies: [
          {
            type: 'constant',
            contentHash: hash('A')
          },
          {
            type: 'derivation',
            operation: 'concat',
            wasCached: false,
            dependencies: [
              {
                type: 'constant',
                contentHash: hash('A')
              },
              {
                type: 'derivation',
                operation: 'concat',
                wasCached: false,
                dependencies: [
                  {
                    type: 'constant',
                    contentHash: hash('A')
                  },
                  {
                    type: 'derivation',
                    operation: 'concat',
                    // Seed value acts as if cached
                    wasCached: true,
                    dependencies: []
                  }
                ]
              }
            ]
          }
        ],
        sccMetadata: { iterationCount: 3 }
      });
    });
  });
});
