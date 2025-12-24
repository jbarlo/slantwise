import { describe, it, beforeEach, expect, assert } from 'vitest';
import { AppDal, createMockAppDal } from '../db/app_dal.js';
import { createMockQueue } from '../limiting/rateLimitQueue.js';
import { EmbeddingInputData, EmbeddingOutput } from '../types.js';
import { getOrComputeDerivedContent as _getOrComputeDerivedContent } from './read.js';
import {
  createDerivation as _createDerivation,
  deleteDerivation,
  updateDerivation as _updateDerivation
} from './write.js';
import { hash, stableStringify } from '../utils.js';
import { range } from 'lodash-es';
import { getExecutionTreeStatistics } from './utils.js';
import { CONTEXT_WINDOW_LIMIT_CHARS } from './constants.js';
import { createMockRateLimitManager } from '../limiting/modelRateLimitManager.js';
import { RateLimiter } from '../limiting';
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

describe('Derivation Engine', () => {
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

  describe('Single-step identity derivation', () => {
    it('should read a single-step identity derivation of a content hash', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: expectedHash }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: hash(expectedResult)
        }
      });
    });

    it('should read a single-step identity derivation of a pinned file path', async () => {
      const absolutePath = '/test/path';
      const content = 'test content';
      const currentHash = hash(content);

      appDal.upsertDocumentAndPath(absolutePath, currentHash, content);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'pinned_path', path: absolutePath }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: content,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: currentHash
        }
      });
    });

    it('should read a single-step identity derivation of a constant value', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'constant', value: expectedResult }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: expectedHash
        }
      });
    });
  });

  describe('Multi-step derivation', () => {
    it('should read a multi-step derivation of a content hash input', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'computed_step',
              step: {
                operation: 'identity',
                inputs: [{ type: 'content', hash: expectedHash }]
              }
            }
          ]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          operation: 'identity',
          // an identity operation with the same input was cached when the inner
          // identity step ran
          cacheStatus: 'cached',
          contentHash: hash(expectedResult),
          dependencies: [
            {
              type: 'computed_step',
              operation: 'identity',
              cacheStatus: 'computed'
            }
          ]
        }
      });
    });

    it('should read a multi-step derivation of a pinned file path', async () => {
      const absolutePath = '/test/path';
      const content = 'test content';
      const currentHash = hash(content);

      appDal.upsertDocumentAndPath(absolutePath, currentHash, content);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'computed_step',
              step: {
                operation: 'identity',
                inputs: [{ type: 'pinned_path', path: absolutePath }]
              }
            }
          ]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: content,
        executionTree: {
          // an identity operation with the same input was cached when the inner
          // identity step ran
          cacheStatus: 'cached',
          contentHash: currentHash,
          dependencies: [
            {
              type: 'computed_step',
              operation: 'identity',
              cacheStatus: 'computed'
            }
          ]
        }
      });
    });

    it('should read a multi-step derivation of a constant value', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'computed_step',
              step: {
                operation: 'identity',
                inputs: [{ type: 'constant', value: expectedResult }]
              }
            }
          ]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          // an identity operation with the same input was cached when the inner
          // identity step ran
          cacheStatus: 'cached',
          contentHash: expectedHash,
          dependencies: [
            {
              type: 'computed_step',
              operation: 'identity',
              cacheStatus: 'computed',
              dependencies: [
                {
                  type: 'constant',
                  contentHash: expectedHash
                }
              ]
            }
          ]
        }
      });
    });
  });

  describe('Derivation referencing other derivations', () => {
    it('should read a derivation referencing a different derivation with a content hash', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'content',
              hash: expectedHash
            }
          ]
        }
      });

      const outerDerivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'derivation',
              id: derivationId
            }
          ]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, outerDerivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          // an identity operation with the same input was cached when the inner
          // identity step ran
          cacheStatus: 'cached',
          contentHash: hash(expectedResult),
          dependencies: [
            {
              type: 'derivation',
              operation: 'identity',
              cacheStatus: 'computed'
            }
          ]
        }
      });
    });

    it('should read a derivation referencing a different derivation with a pinned file path', async () => {
      const absolutePath = '/test/path';
      const content = 'test content';
      const currentHash = hash(content);

      appDal.upsertDocumentAndPath(absolutePath, currentHash, content);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'pinned_path',
              path: absolutePath
            }
          ]
        }
      });

      const outerDerivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'derivation',
              id: derivationId
            }
          ]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, outerDerivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: content,
        executionTree: {
          // an identity operation with the same input was cached when the inner
          // identity step ran
          cacheStatus: 'cached',
          contentHash: currentHash,
          dependencies: [
            {
              type: 'derivation',
              operation: 'identity',
              cacheStatus: 'computed'
            }
          ]
        }
      });
    });

    it('should read a derivation referencing a different derivation with a constant value', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'constant', value: expectedResult }]
        }
      });

      const outerDerivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'derivation',
              id: derivationId
            }
          ]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, outerDerivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'cached',
          contentHash: expectedHash,
          dependencies: [
            {
              type: 'derivation',
              operation: 'identity',
              cacheStatus: 'computed',
              dependencies: [
                {
                  type: 'constant',
                  contentHash: expectedHash
                }
              ]
            }
          ]
        }
      });
    });
  });

  describe('Derivation updates', () => {
    it('should produce the correct output when derivations are updated', async () => {
      const oldInput = 'test content';
      const oldHash = hash(oldInput);

      appDal.core.insertContentIfNew(oldHash, oldInput);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: oldHash }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: oldInput
      });

      const newContent = 'new content';
      const newHash = hash(newContent);
      appDal.core.insertContentIfNew(newHash, newContent);

      updateDerivation(appDal, derivationId, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: newHash }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: newContent
      });
    });

    it('should not recompute steps that are not affected by the update', async () => {
      const oldInput = 'test content';
      const oldHash = hash(oldInput);

      appDal.core.insertContentIfNew(oldHash, oldInput);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'computed_step',
              step: {
                operation: 'concat',
                inputs: [
                  { type: 'content', hash: oldHash },
                  {
                    type: 'computed_step',
                    step: {
                      operation: 'identity',
                      inputs: [{ type: 'content', hash: oldHash }]
                    }
                  }
                ]
              }
            }
          ]
        }
      });

      const expectedOutput = [oldInput, oldInput].join('\n');

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedOutput
      });

      const newInput = 'new content';
      const newHash = hash(newInput);
      appDal.core.insertContentIfNew(newHash, newInput);

      updateDerivation(appDal, derivationId, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'computed_step',
              step: {
                operation: 'concat',
                inputs: [
                  {
                    type: 'computed_step',
                    step: {
                      operation: 'identity',
                      inputs: [{ type: 'content', hash: newHash }]
                    }
                  },
                  {
                    type: 'computed_step',
                    step: {
                      operation: 'identity',
                      inputs: [{ type: 'content', hash: oldHash }]
                    }
                  }
                ]
              }
            }
          ]
        }
      });

      const newExpectedOutput = [newInput, oldInput].join('\n');

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: newExpectedOutput,
        executionTree: {
          operation: 'identity',
          cacheStatus: 'computed',
          contentHash: hash(newExpectedOutput),
          dependencies: [
            {
              type: 'computed_step',
              operation: 'concat',
              cacheStatus: 'computed',
              dependencies: [
                {
                  type: 'computed_step',
                  operation: 'identity',
                  cacheStatus: 'computed'
                },
                {
                  type: 'computed_step',
                  operation: 'identity',
                  cacheStatus: 'cached'
                }
              ]
            }
          ]
        }
      });
    });

    it('should not recompute steps that are downstream of changed steps if inputs are constant', async () => {
      const oldInput = 'test content';
      const oldHash = hash(oldInput);

      appDal.core.insertContentIfNew(oldHash, oldInput);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'computed_step',
              step: {
                operation: 'testConstant',
                inputs: [{ type: 'content', hash: oldHash }]
              }
            }
          ]
        }
      });

      const expectedOutput = 'Test Constant';

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedOutput
      });

      const newInput = 'new content';
      const newHash = hash(newInput);
      appDal.core.insertContentIfNew(newHash, newInput);

      updateDerivation(appDal, derivationId, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'computed_step',
              step: {
                operation: 'testConstant',
                inputs: [{ type: 'content', hash: newHash }]
              }
            }
          ]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedOutput,
        executionTree: {
          operation: 'identity',
          // the identity operation is cached because the input is constant
          cacheStatus: 'cached',
          contentHash: hash(expectedOutput),
          dependencies: [
            {
              type: 'computed_step',
              operation: 'testConstant',
              cacheStatus: 'computed'
            }
          ]
        }
      });
    });
  });

  describe('Derivation deletes', () => {
    it('should not be able to read a deleted derivation', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: expectedHash }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult
      });

      deleteDerivation(appDal, derivationId);

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: false,
        error: { kind: 'formula_not_found' }
      });
    });

    it('should not be able to update a deleted derivation', async () => {
      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: 'test' }]
        }
      });

      await expect(
        updateDerivation(appDal, derivationId, {
          label: 'test',
          recipeParams: {
            operation: 'identity',
            inputs: [{ type: 'content', hash: 'test' }]
          }
        })
      ).toEqual(derivationId);

      deleteDerivation(appDal, derivationId);

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: false,
        error: { kind: 'formula_not_found' }
      });
    });
  });

  describe('Cache behavior', () => {
    it("should return cached result when inputs haven't changed", async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: expectedHash }]
        }
      });

      // first call should not be cached
      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: hash(expectedResult),
          dependencies: [{ type: 'content' }]
        }
      });

      // second call should be cached
      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'cached',
          contentHash: hash(expectedResult),
          dependencies: [{ type: 'content' }]
        }
      });
    });

    it('should recompute when skipCache is true even if cached', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: expectedHash }]
        }
      });

      // not cached
      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        executionTree: { cacheStatus: 'computed' }
      });

      // cached
      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        executionTree: { cacheStatus: 'cached' }
      });

      // reroll
      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter, { skipCache: true })
      ).resolves.toMatchObject({
        success: true,
        executionTree: { cacheStatus: 'computed' }
      });
    });

    it('should recompute when pinned path content changes', async () => {
      const absolutePath = '/test/path';
      const content = 'test content';
      const currentHash = hash(content);

      appDal.upsertDocumentAndPath(absolutePath, currentHash, content);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'pinned_path', path: absolutePath }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: content,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: currentHash
        }
      });

      // pinned path content update
      const newContent = 'new content';
      const newHash = hash(newContent);
      appDal.upsertDocumentAndPath(absolutePath, newHash, newContent);

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: newContent,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: newHash
        }
      });
    });

    it('should recompute when referenced derivation changes', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: expectedHash }]
        }
      });

      const outerDerivationId = await createDerivation(appDal, {
        label: 'test2',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'derivation', id: derivationId }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, outerDerivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'cached',
          contentHash: expectedHash,
          dependencies: [
            {
              type: 'derivation',
              operation: 'identity',
              cacheStatus: 'computed'
            }
          ]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, outerDerivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'cached',
          contentHash: expectedHash,
          dependencies: [
            {
              type: 'derivation',
              operation: 'identity',
              cacheStatus: 'cached'
            }
          ]
        }
      });

      // change the content
      const newContent = 'new content';
      const newHash = hash(newContent);
      appDal.core.insertContentIfNew(newHash, newContent);

      updateDerivation(appDal, derivationId, {
        label: 'test2',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: newHash }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, outerDerivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: newContent,
        executionTree: {
          cacheStatus: 'cached',
          contentHash: newHash,
          dependencies: [
            {
              type: 'derivation',
              operation: 'identity',
              cacheStatus: 'computed'
            }
          ]
        }
      });
    });

    it('should recompute when the input content hash changes', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: expectedHash }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: expectedHash
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'cached',
          contentHash: expectedHash
        }
      });

      const newContent = 'new content';
      const newHash = hash(newContent);
      appDal.core.insertContentIfNew(newHash, newContent);

      updateDerivation(appDal, derivationId, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: newHash }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: newContent,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: newHash
        }
      });
    });

    it('should not recompute when an update does not change the content', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: expectedHash }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: expectedHash
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'cached',
          contentHash: expectedHash
        }
      });

      updateDerivation(appDal, derivationId, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: expectedHash }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedResult,
        executionTree: {
          cacheStatus: 'cached',
          contentHash: expectedHash
        }
      });
    });

    it('should not recompute steps where the inputs are the same as the cached result, even if the derivation recomputed', async () => {
      const absolutePath = '/test/path';
      const content = 'test content';
      const currentHash = hash(content);

      const expectedOutput = 'Test Constant';
      const expectedHash = hash(expectedOutput);

      appDal.upsertDocumentAndPath(absolutePath, currentHash, content);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [
            {
              type: 'computed_step',
              step: {
                // always return the same constant, therefore the step should
                // always return a cached result
                operation: 'testConstant',
                inputs: [{ type: 'pinned_path', path: absolutePath }]
              }
            }
          ]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedOutput,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: expectedHash
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedOutput,
        executionTree: {
          cacheStatus: 'cached',
          contentHash: expectedHash
        }
      });

      // change the pinned path content
      const newContent = 'new content';
      const newHash = hash(newContent);
      appDal.upsertDocumentAndPath(absolutePath, newHash, newContent);

      const result = await getOrComputeDerivedContent(appDal, derivationId, limiter);
      expect(result).toMatchObject({
        success: true,
        output: expectedOutput,
        executionTree: { cacheStatus: 'cached', contentHash: expectedHash }
      });

      assert(result.success === true);
      expect(getExecutionTreeStatistics(result.executionTree)).toMatchObject({
        cachedSteps: 1,
        totalSteps: 2
      });
    });
  });

  describe('Error handling', () => {
    it('should handle missing pinned file paths', async () => {
      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'pinned_path', path: 'not the path' }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: false,
        error: { kind: 'pinned_path_not_found' }
      });
    });

    it('should handle missing content hashes', async () => {
      const expectedResult = 'test content';
      const expectedHash = hash(expectedResult);

      appDal.core.insertContentIfNew(expectedHash, expectedResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'content', hash: 'not the hash' }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: false,
        error: { kind: 'input_content_hash_not_found' }
      });
    });

    it('should handle missing derivation references', async () => {
      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'identity',
          inputs: [{ type: 'derivation', id: 'not the id' }]
        }
      });

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: false,
        error: {
          kind: 'formula_not_found'
        }
      });
    });
  });

  describe('Input size limits', () => {
    it('should return a warning when inputs exceed context window limit', async () => {
      const inputResult = range(1, CONTEXT_WINDOW_LIMIT_CHARS + 2)
        .map((i) => String.fromCharCode(i))
        .join('');
      const inputHash = hash(inputResult);

      appDal.core.insertContentIfNew(inputHash, inputResult);

      const derivationId = await createDerivation(appDal, {
        label: 'test',
        recipeParams: {
          operation: 'llm',
          model: 'openai/gpt-5',
          prompt: 'test',
          inputs: [{ type: 'content', hash: inputHash }]
        }
      });

      const expectedOutput = inputResult.slice(-CONTEXT_WINDOW_LIMIT_CHARS);
      const expectedHash = hash(expectedOutput);

      await expect(
        getOrComputeDerivedContent(appDal, derivationId, limiter)
      ).resolves.toMatchObject({
        success: true,
        output: expectedOutput,
        executionTree: {
          cacheStatus: 'computed',
          contentHash: expectedHash,
          warnings: [{ type: 'inputTooLarge' }]
        }
      });
    });
  });
});
