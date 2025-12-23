import { linter, Diagnostic } from '@codemirror/lint';
import { Text } from '@codemirror/state';
import { parseDerivationExpression, type ParseError } from '../../../../../core/lang/index.js';
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
 * Converts a ParseError to a CodeMirror Diagnostic
 */
function convertErrorToDiagnostic(error: ParseError, doc: Text): Diagnostic {
  let from = 0;
  let to = doc.length;

  if (error.position) {
    if (error.position.line !== undefined && error.position.column !== undefined) {
      // Clamp line to valid range (doc.lines is the total line count)
      const line = Math.max(1, Math.min(error.position.line, doc.lines));
      const lineInfo = doc.line(line);
      // Clamp column to line length
      const column = Math.max(1, Math.min(error.position.column, lineInfo.length + 1));
      from = lineInfo.from + column - 1;
      to = Math.min(from + 1, doc.length);
    } else if (error.position.offset !== undefined) {
      from = Math.min(error.position.offset, doc.length);
      to = Math.min(from + 1, doc.length);
    }
  }

  return { from, to, severity: 'error', message: error.message };
}
