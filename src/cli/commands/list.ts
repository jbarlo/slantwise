import { Command } from 'commander';
import { getContext } from '../index.js';

export const listCommand = new Command('list').description('List all formulas').action(async () => {
  const ctx = await getContext();
  const formulas = ctx.appDal.derivations.getAllDerivations();

  if (formulas.length === 0) {
    console.log('No formulas found.');
    return;
  }

  console.log(`Found ${formulas.length} formula(s):\n`);

  for (const f of formulas) {
    const label = f.label ? ` (${f.label})` : '';
    console.log(`  ${f.derivation_id}${label}`);
    console.log(`    ${f.dsl_expression}`);
    console.log();
  }
});
