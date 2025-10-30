import { linter, Diagnostic } from '@codemirror/lint';
import { Text } from '@codemirror/state';
import { parseDerivationExpression } from '../../../../../core/lang/index.js';
import { tokenPatterns, removeDerivationPrefix } from '@lang-data/tokens.js';

type DerivationForLinting = {
  id: string;
};

/**
 * Creates a linter that validates derivation expressions using the Chevrotain parser
 * and checks that derivation references exist
 */
export function createDerivationLinter(derivations: DerivationForLinting[]) {
  const derivationIds = new Set(derivations.map((d) => d.id));

  return linter(
    (view): Diagnostic[] => {
      const doc = view.state.doc;
      const text = doc.toString();

      // Don't lint empty documents
      if (!text.trim()) {
        return [];
      }

      const diagnostics: Diagnostic[] = [];

      // Parse and check for syntax errors
      const result = parseDerivationExpression(text);

      if (!result.success) {
        for (const error of result.errors) {
          const diagnostic = convertErrorToDiagnostic(error, doc);
          diagnostics.push(diagnostic);
        }
      }

      // Check for invalid derivation references
      const refRegex = new RegExp(tokenPatterns.derivationReferenceLiteral.source, 'g');
      for (const match of Array.from(text.matchAll(refRegex))) {
        const refId = removeDerivationPrefix(match[0]);
        if (!derivationIds.has(refId)) {
          diagnostics.push({
            from: match.index,
            to: match.index + match[0].length,
            severity: 'warning',
            message: `Cell "${refId}" not found`
          });
        }
      }

      return diagnostics;
    },
    // debounce
    { delay: 300 }
  );
}

/**
 * Converts a parser error string to a CodeMirror Diagnostic
 */
function convertErrorToDiagnostic(error: string, doc: Text): Diagnostic {
  // Parse error message to extract position information
  // Format examples:
  // "Lex #1: unexpected character: ->! at line 1, column 5"
  // "Parse #1: Expecting token of type --> RParen <-- but found --> 'x' <-- at offset: 15"

  const lineColumnMatch = error.match(/line (\d+), column (\d+)/);
  const offsetMatch = error.match(/offset:?\s*(\d+)/);

  let from = 0;
  let to = doc.length;

  if (lineColumnMatch) {
    const line = parseInt(lineColumnMatch[1]!, 10);
    const column = parseInt(lineColumnMatch[2]!, 10);

    // Convert 1-based line/column to 0-based position
    const lineStart = doc.line(line).from;
    from = lineStart + column - 1;
    to = Math.min(from + 1, doc.length);
  } else if (offsetMatch) {
    const offset = parseInt(offsetMatch[1]!, 10);
    from = Math.min(offset, doc.length);
    to = Math.min(from + 1, doc.length);
  }

  // Extract the error message (remove position info for cleaner display)
  let message = error;
  message = message.replace(/at line \d+, column \d+/, '').trim();
  message = message.replace(/at offset:?\s*\d+/, '').trim();

  return { from, to, severity: 'error', message };
}
