import { generateText as _generateText } from 'ai';
import { LlmModel } from '../../db/types.js';
import { getModel } from './models.js';
import type { ConfigType } from '@config/types.js';

export const callLlm = async (
  opts: { model: LlmModel; systemPrompt: string; prompt: string },
  config: ConfigType
) => {
  const response = await _generateText({
    model: await getModel(opts.model, config),
    system: opts.systemPrompt,
    prompt: opts.prompt
  });
  return response;
};
