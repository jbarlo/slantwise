export const llmModels = [
  { alias: 'openai/gpt-5', name: 'GPT-5' },
  { alias: 'openai/gpt-o3', name: 'GPT-o3' },
  { alias: 'openrouter/anthropic/claude-opus-4.5', name: 'Claude Opus 4.5' },
  { alias: 'openrouter/anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { alias: 'openrouter/anthropic/claude-4.5-haiku-20251001', name: 'Claude Haiku 4.5' },
  { alias: 'openrouter/anthropic/claude-opus-4.1', name: 'Claude Opus 4.1' },
  { alias: 'openrouter/google/gemini-3-pro-preview', name: 'Gemini 3 Pro' },
  { alias: 'openrouter/google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { alias: 'openrouter/google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' }
] as const;
