export const llmModels = [
  { provider: 'openai', modelId: 'gpt-5', name: 'GPT-5' },
  { provider: 'openai', modelId: 'gpt-o3', name: 'GPT-o3' },
  { provider: 'openrouter', modelId: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5' },
  { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { provider: 'openrouter', modelId: 'anthropic/claude-4.5-haiku-20251001', name: 'Claude Haiku 4.5' },
  { provider: 'openrouter', modelId: 'anthropic/claude-opus-4.1', name: 'Claude Opus 4.1' },
  { provider: 'openrouter', modelId: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro' },
  { provider: 'openrouter', modelId: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { provider: 'openrouter', modelId: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' }
] as const;

export type LlmModelDef = (typeof llmModels)[number];
export type ModelProvider = LlmModelDef['provider'];

type AliasOf<T> = T extends { provider: infer P extends string; modelId: infer M extends string }
  ? `${P}/${M}`
  : never;
export type LlmModelAlias = AliasOf<LlmModelDef>;

export const getAlias = <T extends LlmModelDef>(m: T): AliasOf<T> =>
  `${m.provider}/${m.modelId}` as AliasOf<T>;
