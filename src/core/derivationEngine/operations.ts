import { AppDal } from '../db/app_dal.js';
import {
  logDerivationInputReadError,
  logDerivationInputTooLarge,
  logDerivationComputeUnexpectedError,
  logDerivationOperationStart
} from '../logger.js';
import {
  LlmDerivationParams,
  StepParams,
  IdentityDerivationParams,
  TestConstantDerivationParams,
  GetUrlContentDerivationParams,
  OperationWarning,
  ConcatDerivationParams
} from '../db/types.js';
import { isNil } from 'lodash-es';
import { ReadErrorInfo, getReadErrorInfo } from './errors.js';
import { CONTEXT_WINDOW_LIMIT_CHARS } from './constants.js';
import { Prettify } from '../types.js';
import { callLlm } from './llms';
import type { ConfigType } from '@config/types.js';
import { OperationOptions } from './types.js';

type OperationResult = {
  output?: string;
  error?: string;
  warnings: OperationWarning[];
  tokensOutput?: number; // only present for LLM ops
};

type Operations = StepParams['operation'];

type OperationInputMap = {
  llm: [string];
  identity: [string];
  getUrlContent: [string];
  concat: [string, ...string[]];
  testConstant: string[];
};
type OperationParams = {
  [K in Operations]: (
    inputContent: OperationInputMap[K],
    recipeParams: Prettify<StepParams & { operation: K }>,
    logging: { derivationId: string },
    options?: Partial<OperationOptions>
  ) => Promise<OperationResult>;
};

export const performOperation = async (
  appDal: AppDal,
  inputContentHashes: string[],
  recipeParams: StepParams,
  config: ConfigType,
  logging: { derivationId: string },
  options?: Partial<OperationOptions>
): Promise<
  { success: true; result: OperationResult } | { success: false; error: ReadErrorInfo }
> => {
  const derivationId = logging.derivationId;

  const contentsPerInput = inputContentHashes.map((hash) => {
    try {
      const content = appDal.core.findContentByHash(hash);
      if (content === undefined) {
        // Use hash/id for path/docId placeholders
        logDerivationInputReadError(
          hash,
          derivationId,
          'Input content hash not found in content_cache.'
        );
        return {
          success: false,
          error: getReadErrorInfo('inputContentHashNotFound', { hash })
        };
      }
      return { success: true, content };
    } catch (dbError: unknown) {
      // Use hash/id for path/docId placeholders
      logDerivationInputReadError(hash, derivationId, dbError);
      return {
        success: false,
        error: getReadErrorInfo('dbError')
      };
    }
  });
  const contentError = contentsPerInput.find((content) => !content.success)?.error;
  if (!isNil(contentError)) {
    return { success: false, error: contentError };
  }

  // all content must have succeeded or have been caught by the find above
  const inputContent = contentsPerInput.map((content) => content.content!);

  const operationToAction: OperationParams = {
    llm: (...rest) => {
      logDerivationOperationStart(derivationId, 'LLM');
      return _executeLlmOperation(config, ...rest);
    },
    identity: (...rest) => {
      logDerivationOperationStart(derivationId, 'Identity');
      return _executeIdentityOperation(...rest);
    },
    testConstant: (...rest) => {
      logDerivationOperationStart(derivationId, 'Test Constant');
      return _executeTestConstantOperation(...rest);
    },
    concat: (...rest) => {
      logDerivationOperationStart(derivationId, 'Concat');
      return _executeConcatOperation(...rest);
    },
    getUrlContent: (...rest) => {
      logDerivationOperationStart(derivationId, 'Get URL Content');
      return _executeGetUrlContentOperation(...rest);
    }
  };

  const doOperation = async <P extends StepParams>(
    inputContent: string[],
    recipeParams: P extends StepParams ? P : never,
    options?: Partial<OperationOptions>
  ): Promise<
    { success: true; result: OperationResult } | { success: false; error: ReadErrorInfo }
  > => {
    // cast as selection of one subtype rather than the union
    const action = operationToAction[recipeParams.operation] as
      | OperationParams[P['operation']]
      | undefined;
    if (action === undefined) {
      logDerivationComputeUnexpectedError(
        derivationId,
        `Unsupported operation: ${recipeParams.operation}`
      );
      return {
        success: false,
        error: getReadErrorInfo('unsupportedOperation', {
          operation: recipeParams.operation
        })
      };
    }
    const operationResult = await action(
      // TODO standardize operation arity in one place
      inputContent as OperationInputMap[P['operation']],
      recipeParams,
      logging,
      options
    );
    return { success: true, result: operationResult };
  };

  const result = await doOperation(inputContent, recipeParams, options);

  if (result.success) return { ...result };
  return result;
};

export const readOperationOptions = (opts?: Partial<OperationOptions>): OperationOptions => {
  return { environment: opts?.environment ?? 'production' };
};

const _executeOperation = async <P extends StepParams, InputContent extends string[]>(
  inputContent: InputContent,
  params: P,
  doOperation: (content: InputContent, params: P) => Promise<OperationResult>,
  options?: Partial<OperationOptions>,
  // options to configure behaviour in testing environment
  testingOptions?: {
    simulateDelay?: { delayMs?: number; jitterMs?: number } | boolean;
  }
): Promise<OperationResult> => {
  const operationOptions = readOperationOptions(options);

  const { simulateDelay = false } = testingOptions ?? {};

  if (operationOptions.environment === 'test') {
    if (simulateDelay) {
      const delayMs = (typeof simulateDelay === 'object' ? simulateDelay.delayMs : undefined) ?? 50;
      const jitterMs =
        (typeof simulateDelay === 'object' ? simulateDelay.jitterMs : undefined) ?? 100;
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, delayMs + Math.random() * jitterMs));
    }
  }

  return await doOperation(inputContent, params);
};

async function _executeLlmOperation(
  config: ConfigType,
  inputContent: [string],
  params: LlmDerivationParams,
  logging: { derivationId: string },
  options?: Partial<OperationOptions>
): Promise<OperationResult> {
  return await _executeOperation<LlmDerivationParams, [string]>(
    inputContent,
    params,
    async (content, params) => {
      let llmInput = content[0];

      const warnings: OperationWarning[] = [];

      if (llmInput.length > CONTEXT_WINDOW_LIMIT_CHARS) {
        logDerivationInputTooLarge(
          logging.derivationId,
          llmInput.length,
          CONTEXT_WINDOW_LIMIT_CHARS
        );
        warnings.push({
          type: 'inputTooLarge',
          inputContentLength: llmInput.length,
          contextWindowLimit: CONTEXT_WINDOW_LIMIT_CHARS
        });
        llmInput = llmInput.slice(-CONTEXT_WINDOW_LIMIT_CHARS);
      }

      const model = params.model;
      const systemPrompt = params.prompt;

      const operationOptions = readOperationOptions(options);

      if (operationOptions.environment === 'test') {
        // behave like identity during test
        return { output: llmInput, warnings };
      }

      const response = await callLlm(
        {
          model,
          systemPrompt,
          prompt: llmInput
        },
        config
      );
      return {
        output: response.text,
        warnings,
        tokensOutput: response.usage.outputTokens
      };
    },
    options,
    { simulateDelay: true }
  );
}

async function _executeIdentityOperation(
  inputContent: [string],
  params: IdentityDerivationParams,
  logging: { derivationId: string },
  options?: Partial<OperationOptions>
): Promise<OperationResult> {
  return await _executeOperation<IdentityDerivationParams, [string]>(
    inputContent,
    params,
    async (content) => {
      return { output: content[0], warnings: [] };
    },
    options,
    { simulateDelay: false }
  );
}

async function _executeTestConstantOperation(
  inputContent: string[],
  params: TestConstantDerivationParams,
  logging: { derivationId: string },
  options?: Partial<OperationOptions>
): Promise<OperationResult> {
  return await _executeOperation<TestConstantDerivationParams, string[]>(
    inputContent,
    params,
    async () => {
      return { output: 'Test Constant', warnings: [] };
    },
    options,
    { simulateDelay: false }
  );
}

async function _executeConcatOperation(
  inputContent: [string, ...string[]],
  params: ConcatDerivationParams,
  logging: { derivationId: string },
  options?: Partial<OperationOptions>
): Promise<OperationResult> {
  return await _executeOperation<ConcatDerivationParams, [string, ...string[]]>(
    inputContent,
    params,
    async (content) => {
      return { output: content.join('\n'), warnings: [] };
    },
    options,
    { simulateDelay: false }
  );
}

async function _executeGetUrlContentOperation(
  inputContent: [string],
  params: GetUrlContentDerivationParams,
  logging: { derivationId: string },
  options?: Partial<OperationOptions>
): Promise<OperationResult> {
  return await _executeOperation<GetUrlContentDerivationParams, [string]>(
    inputContent,
    params,
    async (content) => {
      const url = content[0];
      const response = await fetch(`https://r.jina.ai/${url}`);
      const text = await response.text();
      return { output: text, warnings: [] };
    },
    options,
    { simulateDelay: false }
  );
}
