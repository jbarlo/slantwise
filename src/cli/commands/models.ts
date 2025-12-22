import { Command } from 'commander';
import { getContext } from '../index.js';
import { llmModels, getAlias } from '@lang-data/models.js';
import { hasApiKey } from '@core/config.js';

export const modelsCommand = new Command('models')
  .description('List available models and API key status')
  .action(async () => {
    const ctx = await getContext();
    const { config } = ctx;

    for (const model of llmModels) {
      const status = hasApiKey(model.provider, config) ? '✓ configured' : '✗ no key';
      console.log(`${getAlias(model)} (${model.name}) ${status}`);
    }
  });
