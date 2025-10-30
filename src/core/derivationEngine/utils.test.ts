import { describe, expect, it } from 'vitest';
import { getExecutionTreeStatistics } from './utils';
import { ExecutionTree } from '../db/types';

describe('utils', () => {
  it('should accurately count the total number of steps', () => {
    const execTree: ExecutionTree = {
      contentHash: '123',
      wasCached: false,
      operation: 'llm',
      warnings: [],
      dependencies: [
        {
          type: 'derivation',
          operation: 'llm',
          wasCached: true,
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
          wasCached: true,
          dependencies: [
            {
              type: 'computed_step',
              operation: 'llm',
              wasCached: true,
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
      wasCached: true,
      operation: 'llm',
      warnings: [],
      dependencies: [
        {
          type: 'derivation',
          operation: 'llm',
          wasCached: true,
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
          wasCached: true,
          dependencies: [
            {
              type: 'computed_step',
              operation: 'llm',
              wasCached: false,
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
