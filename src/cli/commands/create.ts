import { Command } from 'commander';
import inquirer from 'inquirer';
import { isEmpty, isNil, trim } from 'lodash-es';
import { getContext, isInteractive, GlobalOptions } from '../index.js';
import { parseDerivationExpression, formatParseError } from '@core/lang/index.js';
import { createDerivation } from '@core/derivationEngine/index.js';
import { getOrComputeDerivedContent } from '@core/derivationEngine/index.js';
import type { ExternalDerivationParams } from '@core/db/types.js';
import { executeIfRequested, getExpression } from './utils.js';

export const createCommand = new Command('create')
  .description('Create a new formula')
  .argument('[expression]', 'DSL expression')
  .option('-l, --label <label>', 'Label for the formula')
  .option('-e, --execute', 'Execute immediately after creation')
  .option('-y, --no-interactive', 'Disable interactive prompts')
  .action(
    async (expressionArg: string | undefined, opts: { label?: string; execute?: boolean }) => {
      const ctx = await getContext();
      const globalOpts = createCommand.optsWithGlobals<GlobalOptions>();
      const interactive = isInteractive(globalOpts);

      const result: Awaited<ReturnType<typeof getExpression>> = expressionArg
        ? { success: true, expression: expressionArg }
        : await getExpression(interactive);

      if (!result.success) {
        console.error(result.error);
        process.exit(result.code);
      }

      const expression: string = result.expression;

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

      if (isNil(label) && interactive) {
        const resp = await inquirer.prompt<{ label: string | undefined }>([
          {
            type: 'input',
            name: 'label',
            message: 'Label (optional):'
          }
        ]);
        label = resp.label;
      }

      const formulaParams: ExternalDerivationParams = {
        recipeParams: parsed.params,
        label: isEmpty(trim(label)) ? null : label!
      };

      const formulaId = createDerivation(ctx.appDal, formulaParams, expression);

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
