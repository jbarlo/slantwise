import { Command } from 'commander';
import inquirer from 'inquirer';
import { isEmpty, trim } from 'lodash-es';
import { getContext, isInteractive, GlobalOptions } from '../index.js';
import { parseDerivationExpression, formatParseError } from '@core/lang/index.js';
import { updateDerivation, getOrComputeDerivedContent } from '@core/derivationEngine/index.js';
import type { ExternalDerivationParams } from '@core/db/types.js';
import { getFormula, getExpression, executeIfRequested } from './utils.js';

export const updateCommand = new Command('update')
  .description('Update an existing formula')
  .argument('[identifier]', 'Formula ID or label')
  .option('--expression <dsl>', 'New DSL expression')
  .option('--label <label>', 'New label')
  .option('-e, --execute', 'Execute after update')
  .option('-y, --no-interactive', 'Disable interactive prompts')
  .action(
    async (
      identifierArg: string | undefined,
      opts: { expression?: string; label?: string; execute?: boolean }
    ) => {
      const ctx = await getContext();
      const globalOpts = updateCommand.optsWithGlobals<GlobalOptions>();
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
      const formulaId = formula.derivation_id;

      const expressionResult = await getExpression(interactive);
      if (!expressionResult.success) {
        console.error(expressionResult.error);
        process.exit(expressionResult.code);
      }
      const expression = expressionResult.expression;

      const parsed = parseDerivationExpression(expression);
      if (!parsed.success) {
        console.error('Parse error:');
        for (const err of parsed.errors) {
          console.error(formatParseError(err));
        }
        if (parsed.errors.some((e) => e.code === 'INVALID_MODEL')) {
          console.error('\nHint: Run "slantwise models" to see available models.');
        }
        if (parsed.errors.some((e) => e.code === 'UNKNOWN_OPERATION')) {
          console.error('\nHint: Run "slantwise operations" to see available operations.');
        }
        process.exit(2);
      }

      let label = opts.label;

      if (label === undefined && interactive) {
        const resp = await inquirer.prompt<{ label: string | undefined }>([
          {
            type: 'input',
            name: 'label',
            message: 'New label (optional):',
            default: formula.label ?? ''
          }
        ]);
        label = resp.label;
      }

      const derivationParams: ExternalDerivationParams = {
        recipeParams: parsed.params,
        label: isEmpty(trim(label)) ? null : label!
      };

      updateDerivation(ctx.appDal, formulaId, derivationParams, expression);

      console.log(formulaId);

      executeIfRequested(opts.execute, interactive, async () => {
        const result = await getOrComputeDerivedContent(
          ctx.appDal,
          formulaId,
          ctx.rateLimiter,
          ctx.config
        );
        if (!result.success) {
          return { success: false, code: 1, message: result.error.message };
        }

        return { success: true, output: result.output };
      });
    }
  );
