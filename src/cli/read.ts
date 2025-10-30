import inquirer from 'inquirer';
import { getOrComputeDerivedContent } from '../core/derivationEngine';
import { AppDal } from '../core/db/app_dal';
import { logger } from '../core/logger';
import { RateLimiter } from '../core/limiting';
import { ConfigType } from '../core/config';

export const read = async (
  appDal: AppDal,
  limiter: RateLimiter,
  config: ConfigType,
  opts?: { label?: string }
) => {
  const allDocumentPaths = appDal.core.getAllDocumentPaths();
  const allDerivations = appDal.derivations.getAllDerivations();

  if (opts?.label && opts.label.length > 0) {
    const firstMatch = allDerivations.find((d) => d.label === opts.label);

    if (!firstMatch) {
      logger('ERROR', `No derivation found with label: ${opts.label}`);
      return;
    }

    const hasDuplicate = allDerivations.some((d) => d !== firstMatch && d.label === opts.label);
    if (hasDuplicate) {
      logger(
        'ERROR',
        `Multiple derivations share the label "${opts.label}". Please disambiguate interactively or use a unique label.`
      );
      return;
    }

    logger('INFO', `Computing and displaying derivation labeled "${opts.label}"...`);
    const result = await getOrComputeDerivedContent(
      appDal,
      firstMatch.derivation_id,
      limiter,
      config
    );

    if (!result.success) {
      logger('ERROR', result.error.message);
    } else {
      logger('INFO', 'Result:', { force: true });
      logger('INFO', result.output, { force: true });
    }
    return;
  }

  const documentChoices = allDocumentPaths.map((path) => ({
    name: path, // Display the file path
    value: { type: 'document' as const, identifier: path }
  }));

  const derivationChoices = allDerivations.map((d) => ({
    name: `${d.label ?? 'Untitled Cell'} (${d.derivation_id})`,
    value: { type: 'derivation' as const, identifier: d.derivation_id }
  }));

  const allChoices = [...documentChoices, ...derivationChoices];

  if (allChoices.length === 0) {
    logger('ERROR', 'No documents or derivations available to read.');
    return;
  }

  const { selectedItem } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedItem',
      message: 'Select an item to read (type to filter):',
      choices: allChoices,
      pageSize: 20
    }
  ]);

  if (!selectedItem) {
    logger('ERROR', 'No item selected.');
    return;
  }

  if (selectedItem.type === 'document') {
    const filePath = selectedItem.identifier;
    logger('INFO', `Reading original document: ${filePath}`);
    const docId = appDal.core.findDocIdByPath(filePath);
    if (!docId) {
      logger('ERROR', `Document not found for path: ${filePath}`);
      return;
    }
    const contentHash = appDal.core.findHashByDocId(docId);
    if (!contentHash) {
      logger('ERROR', `Content hash not found for document: ${filePath}`);
      return;
    }
    const content = appDal.core.findContentByHash(contentHash);
    if (content === undefined) {
      logger('ERROR', `Content not found for document: ${filePath}`);
      return;
    }
    logger('INFO', 'Content:', { force: true });
    logger('INFO', content, { force: true });
  } else if (selectedItem.type === 'derivation') {
    const derivationId = selectedItem.identifier;
    logger('INFO', 'Computing and displaying derivation...');
    const result = await getOrComputeDerivedContent(appDal, derivationId, limiter, config);

    if (!result.success) {
      logger('ERROR', result.error.message);
    } else {
      logger('INFO', 'Result:', { force: true });
      logger('INFO', result.output, { force: true });
      // TODO flatten and display warnings
    }
  }
};
