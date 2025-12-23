import { Command } from 'commander';
import { operations } from '@lang-data/operations.js';

export const operationsCommand = new Command('operations')
  .description('List available operations')
  .option('--verbose', 'Show full usage info')
  .action((opts) => {
    for (const op of operations) {
      if (opts.verbose) {
        console.log(`${op.name} - ${op.detail}`);
        console.log(`  ${op.info.replace(/\n/g, '\n  ')}\n`);
      } else {
        console.log(`${op.name.padEnd(15)} ${op.detail}`);
      }
    }
  });
