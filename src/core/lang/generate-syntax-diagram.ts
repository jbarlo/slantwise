import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { __getSerializedGrammar } from './index.js';
import { createSyntaxDiagramsCode, ISerializedGast } from 'chevrotain';
import { writeFileSync } from 'fs';

const run = async (filename: string) => {
  const grammar = __getSerializedGrammar() as ISerializedGast[];
  const html = createSyntaxDiagramsCode(grammar);

  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, html);
  console.log(`Syntax diagram written to ${filename}`);
};

const filename = process.argv[2];
if (!filename) {
  console.error('Filename is required');
  process.exit(1);
}
run(filename);
