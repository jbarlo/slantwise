import { LanguageModel } from 'ai';
import { LlmModel } from '../../db/types.js';
import { getOpenAI, getOpenRouter } from '../../config.js';
import type { ConfigType } from '@config/types.js';
import { llmModels, getAlias } from '@lang-data/models.js';

export const getModel = async (model: LlmModel, config: ConfigType): Promise<LanguageModel> => {
  const modelDef = llmModels.find((m) => getAlias(m) === model);
  if (!modelDef) {
    throw new Error(`Unknown model: ${model}`);
  }

  if (modelDef.provider === 'openai') {
    const openai = await getOpenAI(config);
    return openai(modelDef.modelId);
  } else {
    const openrouter = await getOpenRouter(config);
    return openrouter(modelDef.modelId);
  }
};
