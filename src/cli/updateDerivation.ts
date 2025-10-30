import inquirer from 'inquirer';
import { AppDal } from '../core/db/app_dal';
import { ExternalDerivationParams } from '../core/db/types';
import { parseDerivationExpression } from '../core/lang/index.js';
import {
  updateDerivation as updateDerivationEngine,
  getOrComputeDerivedContent
} from '../core/derivationEngine';
import { RateLimiter } from '../core/limiting';
import { ConfigType } from '../core/config';

export const updateDerivationCli = async (
  appDal: AppDal,
  limiter: RateLimiter,
  config: ConfigType,
  opts?: { label?: string; expression?: string }
) => {
  const allDerivations = appDal.derivations.getAllDerivations();

  if (allDerivations.length === 0) {
    console.error('No derivations available to update.');
    return;
  }

  let derivationToUpdate: (typeof allDerivations)[number] | undefined;
  if (opts?.label && opts.label.length > 0) {
    const firstMatch = allDerivations.find((d) => d.label === opts.label);
    if (!firstMatch) {
      console.error(`No derivation found with label: ${opts.label}`);
      return;
    }
    const hasDuplicate = allDerivations.some((d) => d !== firstMatch && d.label === opts.label);
    if (hasDuplicate) {
      console.error(
        `Multiple derivations share the label "${opts.label}". Please update interactively or choose a unique label.`
      );
      return;
    }
    derivationToUpdate = firstMatch;
  } else {
    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Select a cell to update:',
        choices: allDerivations.map((d) => ({
          name: `${d.label ?? 'Untitled Cell'} (${d.derivation_id})`,
          value: d
        })),
        pageSize: 20
      }
    ]);
    derivationToUpdate = selected;
  }

  if (!derivationToUpdate) {
    console.error('No derivation selected.');
    return;
  }

  let expression = opts?.expression;
  if (!expression) {
    const resp = await inquirer.prompt([
      {
        type: 'editor',
        name: 'expression',
        message:
          'Edit the derivation expression (DSL). Example: llm("text", prompt="Summarize", model="gpt-4o-mini")',
        default: derivationToUpdate.dsl_expression ?? ''
      }
    ]);
    expression = resp.expression;
  }

  if (!expression || typeof expression !== 'string') {
    console.error('You must enter a derivation expression.');
    return;
  }

  const parsed = parseDerivationExpression(expression);
  if (!parsed.success) {
    console.error(`Error parsing expression (${parsed.kind}):\n${parsed.errors.join('\n')}`);
    return;
  }

  const recipeParams = parsed.params;

  const { label } = await inquirer.prompt([
    {
      type: 'input',
      name: 'label',
      message: 'Enter a new label for this cell (leave blank to keep existing):',
      default: derivationToUpdate.label ?? ''
    }
  ]);

  console.log('\nUpdating derivation...');
  const derivationParams: ExternalDerivationParams = {
    recipeParams,
    label: (label ?? '').length > 0 ? label : derivationToUpdate.label
  };

  const updatedId = updateDerivationEngine(
    appDal,
    derivationToUpdate.derivation_id,
    derivationParams,
    expression
  );

  console.log(`\nDerivation updated: ${updatedId}${label ? ` (label: ${label})` : ''}`);

  const { doRead } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'doRead',
      message: 'Read this cell now?',
      default: true
    }
  ]);

  if (doRead) {
    const result = await getOrComputeDerivedContent(appDal, updatedId, limiter, config);
    if (!result.success) {
      console.error(result.error.message);
    } else {
      console.log('\nResult:\n');
      console.log(result.output);
    }
  }
};
