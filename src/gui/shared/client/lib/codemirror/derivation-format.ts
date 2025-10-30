import { EditorView } from '@codemirror/view';
import { formattingRules } from '@lang-data/tokens';
import { forEach } from 'lodash-es';

/**
 * Formats a derivation expression
 * Adds consistent spacing around operators and after commas
 */
export function formatDerivationExpression(code: string): string {
  let formatted = code;

  forEach(formattingRules, ([regex, replaceVal]) => {
    formatted = formatted.replace(regex, replaceVal);
  });

  // Trim leading/trailing whitespace on each line
  formatted = formatted
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  // Remove trailing whitespace
  formatted = formatted.trim();

  return formatted;
}

/**
 * CodeMirror command to format the current document
 */
export function formatDocument(view: EditorView): boolean {
  const { state } = view;
  const code = state.doc.toString();
  const formatted = formatDerivationExpression(code);

  // Only apply changes if formatting actually changed something
  if (formatted !== code) {
    view.dispatch({
      changes: {
        from: 0,
        to: state.doc.length,
        insert: formatted
      }
    });
    return true;
  }

  return false;
}
