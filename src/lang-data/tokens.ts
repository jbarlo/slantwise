export const derivationPrefix = '\\$';
export const derivationIdCharClass = '[a-zA-Z0-9_-]';
export const derivationIdPattern = `${derivationIdCharClass}+`;

export const removeDerivationPrefix = (id: string) => id.slice(1);

export const tokenPatterns = {
  whiteSpace: /[\s\t\n\r]+/,

  pipe: /\|>/,

  comma: /,/,

  lParen: /\(/,

  rParen: /\)/,

  equals: /=/,

  punctuation: /[(),=]/,

  /** String literals (double or single quoted with escape sequences) */
  stringLiteral: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,

  /** Hash literals for content hashes (8-64 hex characters) */
  hashLiteral: /#[0-9a-fA-F]{8,64}/,

  /** Path literals enclosed in backticks */
  pathLiteral: /`[^`]+`/,

  // Derivation reference (dollar-prefixed ID)
  derivationReferenceLiteral: new RegExp(`${derivationPrefix}${derivationIdPattern}`),

  /** Identifiers (function names, parameter names) */
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/
} as const;

export const formattingRules: [RegExp, string][] = [
  // Add space after commas (but not if already there)
  [/,(?!\s)/g, ', '],
  // Add spaces around pipe operator
  [/\s*\|>\s*/g, ' |> '],
  // Remove space before equals in keyword args
  [/\s+=/g, '='],
  // Remove space after equals in keyword args (keep it tight: prompt="value")
  [/=\s+/g, '='],
  // Remove multiple consecutive spaces
  [/ {2,}/g, ' ']
];
