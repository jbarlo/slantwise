import { LanguageModelV1 } from 'ai';
import { LlmModel } from '../../db/types.js';
import { getOpenAI } from '../../config.js';
import type { ConfigType } from '@config/types.js';

export const modelIdMapping: Record<
  LlmModel,
  Parameters<Awaited<ReturnType<typeof getOpenAI>>>[0]
> = {
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'gpt-3.5-turbo': 'gpt-3.5-turbo'
};

export const getModel = async (model: LlmModel, config: ConfigType): Promise<LanguageModelV1> => {
  const openai = await getOpenAI(config);
  return openai(modelIdMapping[model]);
};
