import { embed } from 'ai';
import { getEmbeddingModel } from '../config.js';
import { EmbeddingInputData, EmbeddingOutput } from '../types.js';
import {
  logEmbeddingProcessorStart,
  logEmbeddingProcessorSuccess,
  logEmbeddingProcessorError
} from '../logger.js';
import { stableStringify } from '../utils.js';
import type { ConfigType } from '@config/types.js';

export async function performEmbedding(
  data: EmbeddingInputData,
  config: ConfigType
): Promise<EmbeddingOutput> {
  const { contentHash, content } = data;
  const embeddingModel = await getEmbeddingModel(config);
  logEmbeddingProcessorStart(contentHash, content.length);
  const modelName = embeddingModel.modelId;
  try {
    const {
      embedding,
      usage: { tokens: promptTokens }
    } = await embed({
      model: embeddingModel,
      value: content
    });
    const embeddingJson = stableStringify(embedding);
    logEmbeddingProcessorSuccess(contentHash, embedding.length, promptTokens);
    return {
      embedding: embeddingJson,
      usage: { promptTokens },
      modelName: modelName
    };
  } catch (error) {
    logEmbeddingProcessorError(contentHash, error);
    throw error;
  }
}
