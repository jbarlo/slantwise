import { Command } from 'commander';
import inquirer from 'inquirer';
import { getContext, isInteractive, GlobalOptions } from '../index.js';
import { deleteDerivation } from '@core/derivationEngine/index.js';
import { getFormula } from './utils.js';

export const deleteCommand = new Command('delete')
  .description('Delete a formula')
  .argument('[identifier]', 'Formula ID or label')
  .option('-f, --force', 'Skip confirmation')
  .option('-y, --no-interactive', 'Disable interactive prompts')
  .action(async (identifierArg: string | undefined, opts: { force?: boolean }) => {
    const ctx = await getContext();
    const globalOpts = deleteCommand.optsWithGlobals<GlobalOptions>();
    const shouldBeInteractive = isInteractive(globalOpts);

    const formulas = ctx.appDal.derivations.getAllDerivations();

    const result = await getFormula(
      identifierArg,
      shouldBeInteractive,
      formulas,
      'Select formula to delete:'
    );
    if (!result.success) {
      console.error(result.error);
      process.exit(result.code);
    }

    const currentFormula = result.formula;

    if (!opts.force && shouldBeInteractive) {
      console.log(`\nAbout to delete: ${currentFormula?.dsl_expression}`);
      const { confirm: confirmed } = await inquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Are you sure?',
          default: false
        }
      ]);

      if (!confirmed) {
        console.log('Cancelled.');
        process.exit(0);
      }
    }

    if (!currentFormula) {
      console.error('Error: no formula found to delete');
      process.exit(2);
    }

    deleteDerivation(ctx.appDal, currentFormula.derivation_id);
    console.log(`Deleted ${currentFormula.derivation_id}`);
  });
