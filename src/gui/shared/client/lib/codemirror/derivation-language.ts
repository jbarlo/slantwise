import { StreamLanguage } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tokenPatterns } from '@lang-data/tokens.js';

const derivationLanguage = StreamLanguage.define({
  name: 'slantwise',

  startState() {
    return { inString: false, stringDelim: null };
  },

  token(stream, state: { inString: boolean; stringDelim: string | null }) {
    // Handle whitespace
    if (stream.eatSpace()) {
      return null;
    }

    // Handle string literals
    if (state.inString) {
      while (!stream.eol()) {
        if (stream.next() === '\\') {
          stream.next(); // Skip escaped character
        } else if (stream.current().endsWith(state.stringDelim!)) {
          state.inString = false;
          state.stringDelim = null;
          return 'string';
        }
      }
      return 'string';
    }

    // Start of string literal (double or single quotes)
    if (stream.match(/^["']/)) {
      state.inString = true;
      state.stringDelim = stream.current();

      // Try to consume the rest of the string on the same line
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') {
          stream.next(); // Skip escaped character
        } else if (ch === state.stringDelim) {
          state.inString = false;
          state.stringDelim = null;
          break;
        }
      }
      return 'string';
    }

    if (stream.match(tokenPatterns.hashLiteral)) {
      return 'literal';
    }

    if (stream.match(tokenPatterns.pathLiteral)) {
      return 'literal';
    }

    if (stream.match(tokenPatterns.derivationReferenceLiteral)) {
      return 'atom';
    }

    // Pipe operator
    if (stream.match(tokenPatterns.pipe)) {
      return 'operator';
    }

    // Other operators and punctuation
    if (stream.match(tokenPatterns.punctuation)) {
      return 'punctuation';
    }

    // Identifiers (function names)
    if (stream.match(tokenPatterns.identifier)) {
      return 'variableName';
    }

    // If nothing matched, consume one character
    stream.next();
    return null;
  }
});

const derivationHighlightStyle = HighlightStyle.define([
  { tag: tags.string, color: '#22863a', fontStyle: 'italic' }, // Green for strings
  { tag: tags.literal, color: '#005cc5' }, // Blue for hash/path literals
  { tag: tags.atom, color: '#d97706' }, // Orange for cell references
  { tag: tags.operator, color: '#0891b2', fontWeight: 'bold' }, // Teal/cyan for pipe operator (suggests flow)
  { tag: tags.punctuation, color: '#6f42c1' }, // Purple for parens, commas, equals
  { tag: tags.variableName, color: '#6f42c1', fontWeight: '500' }, // Purple for identifiers/functions
  { tag: tags.invalid, color: '#cb2431', textDecoration: 'wavy underline' } // Red for errors
]);

export const derivationLanguageExtension = [
  derivationLanguage,
  syntaxHighlighting(derivationHighlightStyle)
];
