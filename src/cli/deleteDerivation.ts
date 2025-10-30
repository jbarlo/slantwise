import inquirer from 'inquirer';
import { AppDal } from '../core/db/app_dal';
import { deleteDerivation as deleteDerivationEngine } from '../core/derivationEngine';

export const deleteDerivationCli = async (appDal: AppDal, opts?: { label?: string }) => {
  const allDerivations = appDal.derivations.getAllDerivations();

  if (allDerivations.length === 0) {
    console.error('No derivations available to delete.');
    return;
  }

  let derivationToDelete: (typeof allDerivations)[number] | undefined;
  if (opts?.label && opts.label.length > 0) {
    const firstMatch = allDerivations.find((d) => d.label === opts.label);
    if (!firstMatch) {
      console.error(`No derivation found with label: ${opts.label}`);
      return;
    }
    const hasDuplicate = allDerivations.some((d) => d !== firstMatch && d.label === opts.label);
    if (hasDuplicate) {
      console.error(
        `Multiple derivations share the label "${opts.label}". Please delete interactively or choose a unique label.`
      );
      return;
    }
    derivationToDelete = firstMatch;
  } else {
    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Select a cell to delete:',
        choices: allDerivations.map((d) => ({
          name: `${d.label ?? 'Untitled Cell'} (${d.derivation_id})`,
          value: d
        })),
        pageSize: 20
      }
    ]);
    derivationToDelete = selected;
  }

  if (!derivationToDelete) {
    console.error('No derivation selected.');
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete cell ${
        derivationToDelete.label ?? 'Untitled Cell'
      } (${derivationToDelete.derivation_id})?\nExpression: ${derivationToDelete.dsl_expression ?? '<none>'}`,
      default: false
    }
  ]);

  if (!confirm) {
    console.error('Deletion cancelled.');
    return;
  }

  const deletedId = deleteDerivationEngine(appDal, derivationToDelete.derivation_id);
  console.log(`Derivation deleted: ${deletedId}`);
};
