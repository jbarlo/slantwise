import { createRateLimitManager } from './modelRateLimitManager.js';
import { performEmbedding } from './embedding.js';
import type { ConfigType } from '@config/types.js';
import { EmbeddingInputData, Prettify } from '../types.js';

export const createRateLimiter = async (config: ConfigType) => {
  return createRateLimitManager({
    embedding: {
      processor: (data: EmbeddingInputData) => performEmbedding(data, config),
      limits: { maxRequests: config.embeddingRpmLimit }
    }
  });
};

export type RateLimiter = Prettify<Awaited<ReturnType<typeof createRateLimiter>>>;
