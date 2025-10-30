import {
  autocompletion,
  CompletionContext,
  CompletionResult,
  Completion,
  snippet
} from '@codemirror/autocomplete';
import { llmModels } from '@lang-data/models.js';
import { operations as operationConfigs, type OperationName } from '@lang-data/operations.js';
import { derivationIdCharClass, derivationPrefix } from '@lang-data/tokens';
import { map } from 'lodash-es';

/**
 * Type for derivation data used in autocomplete
 */
export type DerivationForAutocomplete = {
  id: string;
  label?: string | null;
  operation: string;
};

const operations: (Completion & { label: OperationName })[] = map([...operationConfigs], (op) => ({
  label: op.name,
  type: 'function',
  detail: op.detail,
  info: op.info,
  apply: snippet(op.snippet)
}));

const operationsAfterPipe: (Completion & { label: OperationName })[] = map(
  [...operationConfigs],
  (op) => ({
    label: op.name,
    type: 'function',
    detail: op.detail,
    info: op.info,
    apply: snippet(op.snippetAfterPipe)
  })
);

const llmModelCompletions: Completion[] = llmModels.map((model) => ({
  label: model.alias,
  detail: model.name,
  type: 'constant' as const,
  apply: model.alias
}));

const keywordArgs: Record<string, Completion[]> = {
  llm: [
    {
      label: 'prompt',
      type: 'property',
      detail: 'string',
      info: 'The prompt to use for the LLM transformation',
      // Don't use snippet fields inside quotes - just insert template
      apply: 'prompt=""'
    },
    {
      label: 'model',
      type: 'property',
      detail: 'LlmModel',
      info: 'The LLM model to use',
      // FIXME pick first available model
      apply: 'model="gpt-4o"'
    }
  ]
};

function createDerivationCompletions(derivations: DerivationForAutocomplete[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context;
    const text = state.doc.toString();
    const before = text.slice(0, pos);

    // Check for derivation reference
    const derivationRefMatch = context.matchBefore(
      new RegExp(`${derivationPrefix}${derivationIdCharClass}*`)
    );
    if (derivationRefMatch) {
      const derivationCompletions: Completion[] = derivations.map((deriv) => ({
        label: `$${deriv.id}`,
        type: 'constant',
        detail: deriv.operation,
        info: deriv.label ? `${deriv.label} (${deriv.operation})` : deriv.operation,
        apply: `$${deriv.id}`
      }));

      return {
        from: derivationRefMatch.from,
        options: derivationCompletions,
        validFor: new RegExp(`^${derivationPrefix}${derivationIdCharClass}*`)
      };
    }

    const word = context.matchBefore(/\w*/);
    if (!word) return null;

    // Check if we're after a pipe operator (with optional partial function name)
    const afterPipe = /\|>\s*\w*$/.test(before);

    // Check if we're inside a function call (after opening paren)
    const insideFunctionMatch = before.match(/(\w+)\([^)]*$/);
    const insideFunction = insideFunctionMatch ? insideFunctionMatch[1] : null;

    // Check if we're after "model=" to suggest model names
    const afterModelParam = /model\s*=\s*$/.test(before) || /model\s*=\s*"$/.test(before);

    // Check if we're typing a keyword argument
    const afterComma = /,\s*$/.test(before) || /,\s*\w*$/.test(before);

    // Suggest model names after model=
    if (afterModelParam) {
      return {
        from: word.from,
        options: llmModelCompletions,
        validFor: /^[\w".-]*/
      };
    }

    // Suggest keyword arguments inside llm
    if (insideFunction && keywordArgs[insideFunction] && afterComma) {
      return {
        from: word.from,
        options: keywordArgs[insideFunction] || [],
        validFor: /^\w*/
      };
    }

    // After pipe operator: suggest operations without first parameter (it's piped in)
    if (afterPipe) {
      return {
        from: word.from,
        options: operationsAfterPipe,
        validFor: /^\w*/
      };
    }

    // At the start: suggest normal operations
    if (pos === 0 || word.from === 0) {
      return {
        from: word.from,
        options: operations,
        validFor: /^\w*/
      };
    }

    // Default: suggest normal operations if typing a word
    if (word.from < pos) {
      return {
        from: word.from,
        options: operations,
        validFor: /^\w*/
      };
    }

    return null;
  };
}

export function createDerivationAutocomplete(derivations: DerivationForAutocomplete[]) {
  return autocompletion({
    override: [createDerivationCompletions(derivations)],
    activateOnTyping: true,
    maxRenderedOptions: 10,
    defaultKeymap: true
  });
}
