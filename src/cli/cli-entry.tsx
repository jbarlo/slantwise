import inquirer from 'inquirer';
import { createAppDal } from '../core/db/app_dal.js';
import { getConfig } from '../core/config.js';
import { search } from './search.js';
import { calculateUsage } from './usage.js';
import { read } from './read.js';
import { createDerivation } from './createDerivation.js';
import { program } from 'commander';
import { logger } from '../core/logger.js';
import { createRateLimiter } from '../core/limiting';
import { updateDerivationCli } from './updateDerivation.js';
import { deleteDerivationCli } from './deleteDerivation.js';

const doRead = async (opts?: { label?: string }) => {
  const config = await getConfig();
  const appDal = await createAppDal(config.databasePath);

  const rateLimiter = await createRateLimiter(config);

  await read(appDal, rateLimiter, config, { label: opts?.label });
};

const doSearch = async () => {
  const config = await getConfig();

  if (config.skipEmbedding) {
    logger(
      'INFO',
      'skipEmbedding flag is enabled in configuration — semantic search is disabled.',
      { force: true }
    );
    return;
  }

  const { query } = await inquirer.prompt([
    {
      type: 'input',
      name: 'query',
      message: 'Enter your search query:'
    }
  ]);

  const appDal = await createAppDal(config.databasePath);

  await search(query, appDal, config);
};

const doUsage = async () => {
  const config = await getConfig();
  const appDal = await createAppDal(config.databasePath);

  await calculateUsage(appDal);
};

const doCreateDerivation = async (opts?: { label?: string; expression?: string }) => {
  const config = await getConfig();
  const appDal = await createAppDal(config.databasePath);

  const limiter = await createRateLimiter(config);

  await createDerivation(appDal, limiter, config, {
    label: opts?.label,
    expression: opts?.expression
  });
};

const doUpdateDerivation = async (opts?: { label?: string; expression?: string }) => {
  const config = await getConfig();
  const appDal = await createAppDal(config.databasePath);

  const limiter = await createRateLimiter(config);

  await updateDerivationCli(appDal, limiter, config, {
    label: opts?.label,
    expression: opts?.expression
  });
};

const doDeleteDerivation = async (opts?: { label?: string }) => {
  const config = await getConfig();
  const appDal = await createAppDal(config.databasePath);

  await deleteDerivationCli(appDal, { label: opts?.label });
};

const doDerivationGroupPrompt = async () => {
  const { subcommand } = await inquirer.prompt([
    {
      type: 'list',
      name: 'subcommand',
      message: 'Select cell action:',
      choices: [
        { name: 'Create', value: 'create' as const },
        { name: 'Update', value: 'update' as const },
        { name: 'Delete', value: 'delete' as const }
      ]
    }
  ]);

  if (subcommand === 'create') return doCreateDerivation();
  if (subcommand === 'update') return doUpdateDerivation();
  if (subcommand === 'delete') return doDeleteDerivation();
};

const choices = {
  read: {
    name: 'Read',
    description: 'Read a derivation or original document.',
    value: 'read' as const,
    action: doRead
  },
  search: {
    name: 'Search',
    description: 'Semantically search any computed derivations or original documents.',
    value: 'search' as const,
    action: doSearch
  },
  usage: {
    name: 'Usage',
    description: 'View usage statistics.',
    value: 'usage' as const,
    action: doUsage
  },
  derivation: {
    name: 'Derivation',
    description: 'Create, update, or delete derivations.',
    value: 'derivation' as const,
    action: doDerivationGroupPrompt
  }
};

async function main() {
  const { operation } = await inquirer.prompt([
    {
      type: 'list',
      name: 'operation',
      message: 'Select operation type:',
      choices: Object.values(choices)
    }
  ]);

  if (operation === 'read') {
    doRead();

    return;
  }

  if (operation === 'search') {
    doSearch();

    return;
  }

  if (operation === 'usage') {
    doUsage();

    return;
  }

  if (operation === 'derivation') {
    doDerivationGroupPrompt();

    return;
  }

  console.log('Invalid operation');
}

Object.values(choices).forEach((choice) => {
  if (choice.value !== 'derivation' && choice.value !== 'read') {
    program.command(choice.value).action(choice.action);
  }
});

program
  .command('read')
  .description(choices.read.description)
  .option('--label <label>', 'Read a derivation by label')
  .action((opts) => doRead({ label: opts?.label }));

// Derivation parent command and subcommands for direct CLI usage
const derivation = program.command('derivation').description('Manage derivations');

derivation
  .command('create')
  .description('Create a new derivation')
  .option('--label <label>', 'Select derivation to create by label')
  .option('--expression <dsl>', 'Provide the derivation expression (DSL)')
  .action((opts) => doCreateDerivation({ label: opts?.label, expression: opts?.expression }));

derivation
  .command('update')
  .description('Update an existing derivation')
  .option('--label <label>', 'Select derivation to update by label')
  .option('--expression <dsl>', 'Provide a new derivation expression (DSL)')
  .action((opts) => doUpdateDerivation({ label: opts?.label, expression: opts?.expression }));

derivation
  .command('delete')
  .description('Delete a derivation')
  .option('--label <label>', 'Select derivation to delete by label')
  .action((opts) => doDeleteDerivation({ label: opts?.label }));

derivation.action(doDerivationGroupPrompt);

program.action(main);

try {
  program.parse(process.argv);
} catch (error) {
  console.error(error);
}
