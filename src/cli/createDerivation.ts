import {
  createDerivation as _createDerivation,
  getOrComputeDerivedContent
} from '../core/derivationEngine';

import inquirer from 'inquirer';
import { AppDal } from '../core/db/app_dal';
import { ExternalDerivationParams } from '../core/db/types';
import { parseDerivationExpression } from '../core/lang/index.js';
import { RateLimiter } from '../core/limiting';
import { isEmpty, trim } from 'lodash-es';
import { ConfigType } from '../core/config';

export const createDerivation = async (
  appDal: AppDal,
  limiter: RateLimiter,
  config: ConfigType,
  opts?: { label?: string; expression?: string }
) => {
  let expression = opts?.expression;

  if (!expression) {
    const resp = await inquirer.prompt([
      {
        type: 'input',
        name: 'expression',
        message:
          'Enter derivation expression (DSL). Example: llm("text", prompt="Summarize", model="gpt-4o-mini")'
      }
    ]);
    expression = resp.expression;
  }

  if (!expression || typeof expression !== 'string') {
    console.error('Error: You must enter a derivation expression.');
    return;
  }

  const parsed = parseDerivationExpression(expression);
  if (!parsed.success) {
    console.error(`Error parsing expression (${parsed.kind}):\n` + parsed.errors.join('\n'));
    return;
  }

  const recipeParams = parsed.params;

  let label = opts?.label;

  if (!label) {
    const resp = await inquirer.prompt([
      {
        type: 'input',
        name: 'label',
        message: 'Enter a label for this cell (optional):'
      }
    ]);
    label = resp.label as string;
  }

  console.log('\nDefining derivation...');
  const derivationParams: ExternalDerivationParams = {
    recipeParams,
    label: isEmpty(trim(label)) ? null : label
  };

  const derivationId = _createDerivation(appDal, derivationParams, expression);

  console.log(
    `\nDerivation defined as ${derivationId}${
      label ? ` (label: ${label})` : ''
    }. To read it, use the 'Read' command.`
  );

  const { doRead } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'doRead',
      message: 'Read this cell now?',
      default: true
    }
  ]);

  if (doRead) {
    const result = await getOrComputeDerivedContent(appDal, derivationId, limiter, config);
    if (!result.success) {
      console.error(result.error.message);
    } else {
      console.log('\nResult:\n');
      console.log(result.output);
    }
  }
};
