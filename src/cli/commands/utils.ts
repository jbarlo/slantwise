import inquirer from 'inquirer';
import { isEmpty, isNil, isString, trim } from 'lodash-es';
import { UserDerivation } from '@core/db/derivationsService.js';

export const getFormula = async (
  identifierArg: string | undefined,
  shouldBeInteractive: boolean,
  formulas: UserDerivation[],
  prompt: string
): Promise<
  { success: true; formula: UserDerivation } | { success: false; code: 1 | 2; error: string }
> => {
  if (formulas.length === 0) {
    return { success: false, code: 1, error: 'No formulas found.' };
  }

  // if identifier provided, do search for matches
  if (identifierArg) {
    // try by ID first
    const byId = formulas.find((d) => d.derivation_id === identifierArg);
    if (byId) {
      return { success: true, formula: byId };
    }

    // try by label
    const byLabel = formulas.filter((d) => d.label === identifierArg);
    if (byLabel.length <= 0) {
      return {
        success: false,
        code: 2,
        error: `Error: no formula found with ID or label "${identifierArg}"`
      };
    }

    if (byLabel.length === 1) {
      const formula = byLabel[0]!;
      return { success: true, formula };
    }

    if (!shouldBeInteractive) {
      return {
        success: false,
        code: 2,
        error: `Error: multiple formulas with label "${identifierArg}". Specify by ID.`
      };
    }

    const resp = await inquirer.prompt<{ formulaId: string }>([
      {
        type: 'list',
        name: 'formulaId',
        message: `Multiple formulas with label "${identifierArg}":`,
        choices: byLabel.map((d) => ({
          name: `${d.derivation_id} - ${d.dsl_expression}`,
          value: d.derivation_id
        }))
      }
    ]);
    const formula = byLabel.find((d) => d.derivation_id === resp.formulaId);
    if (!formula) {
      return {
        success: false,
        code: 2,
        error: `Error: no formula found with ID "${resp.formulaId}"`
      };
    }
    return { success: true, formula };
  }

  if (!shouldBeInteractive) {
    return {
      success: false,
      code: 2,
      error: 'Error: identifier argument required in non-interactive mode'
    };
  }

  // if interactive, prompt user to select a formula
  const resp = await inquirer.prompt<{ formulaId: string }>([
    {
      type: 'list',
      name: 'formulaId',
      message: prompt,
      choices: formulas.map((d) => ({
        name: d.label
          ? `${d.label} (${d.derivation_id}) - ${d.dsl_expression}`
          : `${d.derivation_id} - ${d.dsl_expression}`,
        value: d.derivation_id
      }))
    }
  ]);
  const formula = formulas.find((d) => d.derivation_id === resp.formulaId);
  if (!formula) {
    return {
      success: false,
      code: 2,
      error: `Error: no formula found with ID "${resp.formulaId}"`
    };
  }
  return { success: true, formula };
};

export const getExpression = async (
  shouldBeInteractive: boolean
): Promise<
  { success: true; expression: string } | { success: false; code: 1 | 2; error: string }
> => {
  if (!shouldBeInteractive) {
    return {
      success: false,
      code: 2,
      error: 'Error: expression argument required in non-interactive mode'
    };
  }

  const resp = await inquirer.prompt<{ expression: unknown }>([
    {
      type: 'input',
      name: 'expression',
      message: 'DSL expression:'
    }
  ]);

  if (!isString(resp.expression)) {
    return { success: false, code: 2, error: 'Error: expression must be a string' };
  }

  if (isEmpty(trim(resp.expression))) {
    return { success: false, code: 2, error: 'Error: expression is required' };
  }

  return { success: true, expression: resp.expression };
};

export const executeIfRequested = async (
  shouldExecute: boolean | undefined,
  shouldBeInteractive: boolean,
  doExecution: () => Promise<
    { success: true; output: string | null } | { success: false; code: 1 | 2; message: string }
  >
): Promise<void> => {
  if (shouldExecute === undefined && shouldBeInteractive) {
    const resp = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'execute',
        message: 'Execute now?',
        default: true
      }
    ]);
    shouldExecute = resp.execute;
  }

  if (shouldExecute ?? false) {
    const result = await doExecution();

    if (!result.success) {
      console.error(result.message);
      process.exit(1);
    }

    if (!isNil(result.output)) {
      console.log('\n' + result.output);
    }
  }
};
