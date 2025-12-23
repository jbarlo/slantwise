import type { z } from 'zod/v4';

export type ParseErrorCode =
  | 'INVALID_MODEL'
  | 'UNKNOWN_OPERATION'
  | 'MISSING_PROMPT'
  | 'MISSING_MODEL'
  | 'INVALID_INPUT_COUNT'
  | 'SYNTAX_ERROR'
  | 'VALIDATION_ERROR';

export type ParseError = {
  code: ParseErrorCode;
  message: string;
  path?: (string | number)[];
  /** Original position info for syntax errors */
  position?: { line?: number; column?: number; offset?: number };
};

export function mapZodIssue(issue: z.core.$ZodIssue): ParseError {
  const pathEnd = issue.path.at(-1);
  const path = issue.path as (string | number)[];

  if (pathEnd === 'model') {
    return { code: 'INVALID_MODEL', message: issue.message, path };
  }
  if (pathEnd === 'operation') {
    return { code: 'UNKNOWN_OPERATION', message: issue.message, path };
  }
  if (pathEnd === 'prompt' && issue.code === 'invalid_type') {
    return { code: 'MISSING_PROMPT', message: issue.message, path };
  }
  if (pathEnd === 'inputs') {
    return { code: 'INVALID_INPUT_COUNT', message: issue.message, path };
  }

  return { code: 'VALIDATION_ERROR', message: issue.message, path };
}

export function formatParseError(error: ParseError): string {
  const pathStr = error.path?.length ? ` at ${error.path.join('.')}` : '';
  return `${error.message}${pathStr}`;
}
