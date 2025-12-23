import { Command } from 'commander';
import { getContext, isInteractive, GlobalOptions } from '../index.js';
import { getOrComputeDerivedContent } from '@core/derivationEngine/index.js';
import { formatExecutionTrace } from '../formatters/trace.js';
import { getFormula } from './utils.js';

export const traceCommand = new Command('trace')
  .description('Show execution trace for a formula')
  .argument('[identifier]', 'Formula ID or label')
  .option('--full', 'Show full values without truncation')
  .option('-r, --reroll', 'Force recalculation and bypass cache')
  .option('-y, --no-interactive', 'Disable interactive prompts')
  .action(async (identifierArg: string | undefined) => {
    const ctx = await getContext();
    const globalOpts = traceCommand.optsWithGlobals<GlobalOptions>();
    const localOpts = traceCommand.opts<{ full?: boolean; reroll?: boolean }>();
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
      ctx.config,
      { skipCache: localOpts.reroll }
    );

    if (!result.success) {
      console.error(result.error.message);
      process.exit(1);
    }

    const trace = formatExecutionTrace(
      result.executionTree,
      (hash) => ctx.appDal.core.findContentByHash(hash),
      { full: localOpts.full }
    );

    const label = formula.label
      ? `${formula.label} (${formula.derivation_id})`
      : formula.derivation_id;
    console.log(label);
    console.log(trace);
  });
