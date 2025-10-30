import { z } from 'zod';

export const themeSchema = z.enum(['light', 'dark', 'system']);

export type Theme = z.infer<typeof themeSchema>;

export const configSchema = z.object({
  openaiApiKey: z.string().default(''),
  databasePath: z.string().min(1, 'Database path cannot be empty.'),
  watchedDirectory: z.string().min(1, 'Watched directory path cannot be empty.'),
  embeddingRpmLimit: z.number().positive().int().default(80),
  skipEmbedding: z.boolean().default(true),
  debug: z.boolean().default(false),
  theme: themeSchema.default('system')
});

export type ConfigType = z.infer<typeof configSchema>;

export const getDefaultConfig = (defaultDbPath: string): ConfigType => ({
  openaiApiKey: '',
  databasePath: defaultDbPath,
  watchedDirectory: configSchema.shape.watchedDirectory.parse(undefined),
  embeddingRpmLimit: configSchema.shape.embeddingRpmLimit.parse(undefined),
  skipEmbedding: configSchema.shape.skipEmbedding.parse(undefined),
  debug: configSchema.shape.debug.parse(undefined),
  theme: configSchema.shape.theme.parse(undefined)
});
