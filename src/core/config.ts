import path from 'path';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import envPaths from 'env-paths';
import {
  logConfigLoadingAttempt,
  logConfigLoadSuccess,
  logConfigValidationError,
  logConfigNotFound,
  logConfigDefaultCreated,
  logConfigDefaultCreateError,
  logConfigReadError,
  logConfigSummary
} from './logger.js';
import { readFileSafe, writeConfigFileAtomic } from './utils.js';
import { isEmpty } from 'lodash-es';
import { configSchema, ConfigType, getDefaultConfig } from '@config/types.js';

const paths = envPaths('slantwise', { suffix: '' });
export const configFilePath = path.join(paths.config, 'config.json');
export const defaultDbPath = path.join(paths.config, 'files.db');

let loadedConfig: ConfigType | null = null;
let openai: ReturnType<typeof createOpenAI> | null = null;
let openrouter: ReturnType<typeof createOpenRouter> | null = null;
let embeddingModel: ReturnType<ReturnType<typeof createOpenAI>['embedding']> | null = null;
let embeddingRpmLimit: number;

async function loadOrCreateConfig(): Promise<ConfigType> {
  try {
    logConfigLoadingAttempt(configFilePath);
    const fileResult = await readFileSafe(configFilePath);

    if (!fileResult.success) {
      logConfigNotFound(configFilePath);
      const defaultConfigToWrite = getDefaultConfig(defaultDbPath);
      try {
        await writeConfigFileAtomic(configFilePath, defaultConfigToWrite);
        logConfigDefaultCreated(configFilePath);
      } catch (writeError) {
        logConfigDefaultCreateError(writeError);
      }
      return configSchema.parse(defaultConfigToWrite);
    }

    const fileContent = fileResult.file;

    const jsonData = JSON.parse(fileContent);
    const validationResult = configSchema.safeParse(jsonData);

    if (validationResult.success) {
      logConfigLoadSuccess();
      return validationResult.data;
    } else {
      logConfigValidationError(configFilePath, validationResult.error.errors);
      throw new Error(`Invalid config: ${validationResult.error.message}`);
    }
  } catch (error: unknown) {
    logConfigReadError(configFilePath, error);
    throw new Error(
      `Failed to load config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function getConfig(): Promise<ConfigType> {
  if (loadedConfig) {
    return loadedConfig;
  }

  loadedConfig = await loadOrCreateConfig();

  embeddingRpmLimit = loadedConfig.embeddingRpmLimit * 0.8;

  logConfigSummary(
    loadedConfig.databasePath,
    loadedConfig.watchedDirectory ?? '(not configured)',
    `Raw: ${loadedConfig.embeddingRpmLimit}, Applied (80%): ${embeddingRpmLimit.toFixed(0)}`
  );

  return loadedConfig;
}

export async function updateConfig(updates: Partial<ConfigType>): Promise<ConfigType> {
  const currentConfig = await getConfig();

  const updatedConfig = { ...currentConfig, ...updates };

  const validationResult = configSchema.safeParse(updatedConfig);

  if (!validationResult.success) {
    throw new Error(`Invalid config update: ${validationResult.error.message}`);
  }

  await writeConfigFileAtomic(configFilePath, validationResult.data);

  loadedConfig = validationResult.data;

  return loadedConfig;
}

export async function getOpenAI(config: ConfigType): Promise<ReturnType<typeof createOpenAI>> {
  if (!openai) {
    if (isEmpty(config.openaiApiKey.trim())) {
      throw new Error(
        'OpenAI API Key is not configured. Please set your API key in the application settings.'
      );
    }
    openai = createOpenAI({ apiKey: config.openaiApiKey });
  }
  return openai;
}

export async function getOpenRouter(
  config: ConfigType
): Promise<ReturnType<typeof createOpenRouter>> {
  if (!openrouter) {
    if (isEmpty(config.openRouterApiKey.trim())) {
      throw new Error(
        'OpenRouter API Key is not configured. Please set your API key in the application settings.'
      );
    }
    openrouter = createOpenRouter({ apiKey: config.openRouterApiKey });
  }
  return openrouter;
}

export async function getEmbeddingModel(
  config: ConfigType
): Promise<NonNullable<typeof embeddingModel>> {
  if (!embeddingModel) {
    const openAi = await getOpenAI(config);
    embeddingModel = openAi.embedding('text-embedding-3-small');
  }
  return embeddingModel;
}

// intentionally doesn't await config to keep the function synchronous
//
// if null, config is not loaded yet
export function isDebug(): boolean | null {
  if (loadedConfig === null) {
    return null;
  }
  return loadedConfig.debug;
}
