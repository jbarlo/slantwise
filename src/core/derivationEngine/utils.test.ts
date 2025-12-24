import { describe, expect, it } from 'vitest';
import { getExecutionTreeStatistics } from './utils';
import { ExecutionTree } from '../db/types';

describe('utils', () => {
  it('should accurately count the total number of steps', () => {
    const execTree: ExecutionTree = {
      contentHash: '123',
      cacheStatus: 'computed',
      operation: 'llm',
      warnings: [],
      dependencies: [
        {
          type: 'derivation',
          operation: 'llm',
          cacheStatus: 'cached',
          dependencies: [
            {
              type: 'content',
              contentHash: '123'
            },
            {
              type: 'pinned_path',
              contentHash: '123'
            }
          ],
          contentHash: '123',
          warnings: []
        },
        {
          type: 'computed_step',
          operation: 'llm',
          cacheStatus: 'cached',
          dependencies: [
            {
              type: 'computed_step',
              operation: 'llm',
              cacheStatus: 'cached',
              dependencies: [
                {
                  type: 'content',
                  contentHash: '123'
                }
              ],
              contentHash: '123',
              warnings: []
            }
          ],
          contentHash: '123',
          warnings: []
        }
      ]
    };
    const statistics = getExecutionTreeStatistics(execTree);
    expect(statistics).toMatchObject({ totalSteps: 4 });
  });

  it('should accurately count the cached number of steps', () => {
    const execTree: ExecutionTree = {
      contentHash: '123',
      cacheStatus: 'cached',
      operation: 'llm',
      warnings: [],
      dependencies: [
        {
          type: 'derivation',
          operation: 'llm',
          cacheStatus: 'cached',
          dependencies: [
            {
              type: 'content',
              contentHash: '123'
            },
            {
              type: 'pinned_path',
              contentHash: '123'
            }
          ],
          contentHash: '123',
          warnings: []
        },
        {
          type: 'computed_step',
          operation: 'llm',
          cacheStatus: 'cached',
          dependencies: [
            {
              type: 'computed_step',
              operation: 'llm',
              cacheStatus: 'computed',
              dependencies: [
                {
                  type: 'content',
                  contentHash: '123'
                }
              ],
              contentHash: '123',
              warnings: []
            }
          ],
          contentHash: '123',
          warnings: []
        }
      ]
    };
    const statistics = getExecutionTreeStatistics(execTree);
    expect(statistics).toMatchObject({ cachedSteps: 3 });
  });
});
