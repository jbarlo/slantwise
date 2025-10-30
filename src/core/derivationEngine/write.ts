import { map } from 'lodash-es';
import { AppDal } from '../db/app_dal';
import {
  ExternalDerivationParams,
  ExternalStepParams,
  InputDescriptorItem,
  StepParams
} from '../db/types';

/**
 * Creates a definition for a derivation.
 */
export function createDerivation(
  appDal: AppDal,
  derivationParams: ExternalDerivationParams,
  dslExpression: string
): string {
  // FIXME transaction-ify

  // The deepDefineStep function will recursively define all steps in the recipe
  // and return the step_id of the final (root) step in the user's recipe.
  const { currentStepId: finalStepId, flattenedStepParams } = _deepDefineStep(
    appDal,
    derivationParams.recipeParams
  );

  // Create the user-facing Derivation record, linking it to the final_step_id of the flattened recipe.
  // The original, unflattened recipe (derivationParams.recipeParams) is stored.
  const userDerivationId = appDal.derivations.createDerivation(
    flattenedStepParams,
    derivationParams.label,
    finalStepId,
    dslExpression
  );

  return userDerivationId;
}

export function updateDerivation(
  appDal: AppDal,
  derivationId: string,
  derivationParams: ExternalDerivationParams,
  dslExpression: string
): string {
  // FIXME transaction-ify

  // The deepDefineStep function will recursively define all steps in the recipe
  // and return the step_id of the final (root) step in the user's recipe.
  const { currentStepId: finalStepId, flattenedStepParams } = _deepDefineStep(
    appDal,
    derivationParams.recipeParams
  );

  // Create the user-facing Derivation record, linking it to the final_step_id of the flattened recipe.
  // The original, unflattened recipe (derivationParams.recipeParams) is stored.
  const userDerivationId = appDal.derivations.updateDerivation(
    derivationId,
    flattenedStepParams,
    derivationParams.label,
    finalStepId,
    dslExpression
  );

  return userDerivationId;
}

export function deleteDerivation(appDal: AppDal, derivationId: string): string {
  const deletedDerivationId = appDal.derivations.deleteDerivation(derivationId);

  return deletedDerivationId;
}

/**
 * Recursively traverses a StepParams node from a user's recipe,
 * defines each step in the database, and resolves `computed_step` inputs
 * into `derivation` inputs pointing to the Step ID of the defined nested step.
 *
 * @param appDal The application's data access layer.
 * @param currentStepParamsNode The current node in the recipe tree to process.
 * @returns The step_id of the defined step corresponding to currentStepParamsNode.
 */
function _deepDefineStep(
  appDal: AppDal,
  currentStepParamsNode: ExternalStepParams
): { currentStepId: string; flattenedStepParams: StepParams } {
  // Process inputs: recursively define nested steps and resolve them to step IDs
  const resolvedInputsForDB: InputDescriptorItem[] = map(
    currentStepParamsNode.inputs,
    (inputDescriptor) => {
      if (inputDescriptor.type === 'computed_step') {
        const { currentStepId: nestedStepId } = _deepDefineStep(appDal, inputDescriptor.step);
        return { type: 'internal_step_link', targetStepId: nestedStepId };
      }
      return inputDescriptor;
    }
  );

  const stepParamsForDB: StepParams = {
    ...currentStepParamsNode,
    inputs: resolvedInputsForDB
  };

  const currentStepId = appDal.derivations.defineStep(stepParamsForDB);
  return { currentStepId, flattenedStepParams: stepParamsForDB };
}
