import { Command } from 'commander';
import { getContext, isInteractive, GlobalOptions } from '../index.js';
import { getOrComputeDerivedContent } from '@core/derivationEngine/index.js';
import { getFormula } from './utils.js';

export const readCommand = new Command('read')
  .description('Read/execute a formula and output its result')
  .argument('[identifier]', 'Formula ID or label')
  .option('-y, --no-interactive', 'Disable interactive prompts')
  .action(async (identifierArg: string | undefined) => {
    const ctx = await getContext();
    const globalOpts = readCommand.optsWithGlobals<GlobalOptions>();
    const interactive = isInteractive(globalOpts);

    const formulas = ctx.appDal.derivations.getAllDerivations();

    if (formulas.length === 0) {
      console.error('No formulas found.');
      process.exit(1);
    }

    const formulaResult = await getFormula(identifierArg, interactive, formulas);
    if (!formulaResult.success) {
      console.error(formulaResult.error);
      process.exit(formulaResult.code);
    }

    const formula = formulaResult.formula;

    const result = await getOrComputeDerivedContent(
      ctx.appDal,
      formula.derivation_id,
      ctx.rateLimiter,
      ctx.config
    );

    if (!result.success) {
      console.error(result.error.message);
      process.exit(1);
    }

    console.log(result.output);
  });
