import { LanguageModel } from 'ai';
import { LlmModel } from '../../db/types.js';
import { getOpenAI, getOpenRouter } from '../../config.js';
import type { ConfigType } from '@config/types.js';

export const modelIdMapping: Record<
  LlmModel,
  | Parameters<Awaited<ReturnType<typeof getOpenAI>>>[0]
  | Parameters<Awaited<ReturnType<typeof getOpenRouter>>>[0]
> = {
  'openai/gpt-5': 'gpt-5',
  'openai/gpt-o3': 'gpt-o3',
  'openrouter/anthropic/claude-opus-4.5': 'anthropic/claude-opus-4.5',
  'openrouter/anthropic/claude-sonnet-4.5': 'anthropic/claude-sonnet-4.5',
  'openrouter/anthropic/claude-4.5-haiku-20251001': 'anthropic/claude-4.5-haiku-20251001',
  'openrouter/anthropic/claude-opus-4.1': 'anthropic/claude-opus-4.1',
  'openrouter/google/gemini-3-pro-preview': 'google/gemini-3-pro-preview',
  'openrouter/google/gemini-2.5-flash': 'google/gemini-2.5-flash',
  'openrouter/google/gemini-2.5-pro-preview': 'google/gemini-2.5-pro-preview'
};

export const getModel = async (model: LlmModel, config: ConfigType): Promise<LanguageModel> => {
  const modelId = modelIdMapping[model];

  if (model.startsWith('openai/')) {
    const openai = await getOpenAI(config);
    return openai(modelId);
  } else if (model.startsWith('openrouter/')) {
    const openrouter = await getOpenRouter(config);
    return openrouter(modelId);
  } else {
    throw new Error(`Unknown model provider for model: ${model}`);
  }
};
