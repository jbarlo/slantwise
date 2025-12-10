import { Command } from 'commander';
import { configFilePath, defaultDbPath } from '@core/config.js';
import { readFileSafe, writeConfigFileAtomic } from '@core/utils.js';
import { configSchema, getDefaultConfig } from '@config/types.js';
import { isEmpty } from 'lodash-es';

function printSetupInstructions() {
  console.log(`\nTo complete setup:`);
  console.log(`  1. Open ${configFilePath}`);
  console.log(`  2. Set "openaiApiKey" to your OpenAI API key`);
  console.log(`  3. Save the file\n`);
}

export const initCommand = new Command('init')
  .description('Initialize Slantwise configuration')
  .action(async () => {
    const fileResult = await readFileSafe(configFilePath);

    // doesn't exist
    if (!fileResult.success) {
      const defaultConfig = getDefaultConfig(defaultDbPath);
      await writeConfigFileAtomic(configFilePath, defaultConfig);
      console.log(`Created config file at ${configFilePath}`);
      printSetupInstructions();
      return;
    }

    // invalid config
    const parsed = configSchema.safeParse(JSON.parse(fileResult.file));
    if (!parsed.success) {
      console.error(`Config file exists but is invalid: ${parsed.error.message}`);
      process.exit(1);
    }

    // missing API key
    if (isEmpty(parsed.data.openaiApiKey.trim())) {
      console.log(`Config file exists at ${configFilePath}`);
      printSetupInstructions();
      return;
    }

    // ready
    console.log(`Slantwise is already ready to use!`);
    console.log(`Config file at ${configFilePath}`);
  });
