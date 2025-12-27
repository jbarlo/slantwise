import { streamText } from 'ai';
import { LlmModel } from '../../db/types.js';
import { getModel } from './models.js';
import type { ConfigType } from '@config/types.js';

export const callLlm = async (
  opts: { model: LlmModel; systemPrompt: string; prompt: string },
  config: ConfigType,
  onTokenUpdate?: (estimatedTokens: number) => void,
  onEnd?: (tokensOutput: number) => void,
  onThinkingUpdate?: (elapsedMs: number) => void
) => {
  const result = await streamText({
    model: await getModel(opts.model, config),
    system: opts.systemPrompt,
    prompt: opts.prompt
  });

  let text = '';
  let allContent = ''; // includes reasoning + text for token estimation
  let thinkingInterval: ReturnType<typeof setInterval> | undefined;
  let thinkingStart: number | undefined;

  for await (const part of result.fullStream) {
    if (part.type === 'reasoning-start') {
      // Start emitting thinking updates every 500ms
      thinkingStart = Date.now();
      if (onThinkingUpdate) {
        onThinkingUpdate(0);
        thinkingInterval = setInterval(() => {
          onThinkingUpdate(Date.now() - thinkingStart!);
        }, 500);
      }
    } else if (part.type === 'reasoning-end') {
      // Stop thinking updates
      if (thinkingInterval) {
        clearInterval(thinkingInterval);
        thinkingInterval = undefined;
      }
    } else if (part.type === 'reasoning-delta') {
      allContent += part.text;
      const estimatedTokens = Math.ceil(allContent.length / 4);
      onTokenUpdate?.(estimatedTokens);
    } else if (part.type === 'text-delta') {
      text += part.text;
      allContent += part.text;
      const estimatedTokens = Math.ceil(allContent.length / 4);
      onTokenUpdate?.(estimatedTokens);
    }
  }

  // Cleanup interval if still running
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
  }

  // Get actual final token count from usage
  const usage = await result.usage;
  onEnd?.(usage.outputTokens ?? 0);
  return { text, usage };
};
