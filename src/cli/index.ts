import { program } from 'commander';
import { createCliContext, CliContext } from './context.js';
import { listCommand } from './commands/list.js';
import { createCommand } from './commands/create.js';
import { readCommand } from './commands/read.js';
import { updateCommand } from './commands/update.js';
import { deleteCommand } from './commands/delete.js';
import { initCommand } from './commands/init.js';
import { modelsCommand } from './commands/models.js';

export type GlobalOptions = {
  interactive?: boolean;
};

let cachedContext: CliContext | null = null;

export async function getContext(): Promise<CliContext> {
  if (!cachedContext) {
    cachedContext = await createCliContext();
  }
  return cachedContext;
}

export function isInteractive(opts: GlobalOptions): boolean {
  return opts.interactive !== false && process.stdin.isTTY === true;
}

program
  .name('slantwise')
  .description('CLI for Slantwise')
  .option('-y, --no-interactive', 'Disable interactive prompts')
  .version(process.env.CLI_VERSION ?? '0.0.0', '-v, --version');

program.addCommand(initCommand);
program.addCommand(listCommand);
program.addCommand(createCommand);
program.addCommand(readCommand);
program.addCommand(updateCommand);
program.addCommand(deleteCommand);
program.addCommand(modelsCommand);

program.action(() => {
  program.help();
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
