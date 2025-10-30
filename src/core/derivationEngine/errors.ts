const readErrorKinds = {
  derivationNotFound: {
    kind: 'derivation_not_found',
    message: (ctx: { derivationId: string }) =>
      `#REF! Cell definition (ID: ${ctx.derivationId}) not found.`
  },
  unexpectedDerivationComputationError: {
    kind: 'unexpected_derivation_computation_error',
    message: (ctx: { error: string }) =>
      `#INTERNAL! Unexpected cell computation error: ${ctx.error}`
  },
  pinnedPathNotFound: {
    kind: 'pinned_path_not_found',
    message: (ctx: { pinnedPath: string }) => `#REF_PATH! Pinned path ${ctx.pinnedPath} not found.`
  },
  pinnedContentHashNotFound: {
    kind: 'pinned_content_hash_not_found',
    message: (ctx: { pinnedPath: string; docId: string }) =>
      `#REF_PATH! Content for pinned path ${ctx.pinnedPath} (docId ${ctx.docId}) not found.`
  },
  inputContentHashNotFound: {
    kind: 'input_content_hash_not_found',
    message: (ctx: { hash: string }) => `#REF! Input content (hash: ${ctx.hash}) not found.`
  },
  stepNotFound: {
    kind: 'step_not_found',
    message: (ctx: { stepId: string }) => `#REF! Step ${ctx.stepId} not found.`
  },
  invalidInputArity: {
    kind: 'invalid_input_arity',
    message: (ctx: { issues: string }) => `#ARITY! Invalid input arity: ${ctx.issues}`
  },
  unsupportedOperation: {
    kind: 'unsupported_operation',
    message: (ctx: { operation: string }) =>
      `#UNSUPPORTED! Operation '${ctx.operation}' not supported.`
  },
  operationResultError: {
    kind: 'operation_result_error',
    message: (ctx: { error: string }) => `#OP_FAIL! Operation result error: ${ctx.error}`
  },
  unspecifiedOperationFailure: {
    kind: 'unspecified_operation_failure',
    message: (ctx: { operation: string }) => `#OP_FAIL! Operation '${ctx.operation}' failed.`
  },
  derivationStoreFailure: {
    kind: 'derivation_store_failure',
    message: (ctx: { error: string }) =>
      `#STORE_FAIL! Failed to store cell result: ${ctx.error}`
  },
  dbError: {
    kind: 'db_error',
    message: () => 'DB error retrieving input content.'
  }
} as const;

export type ReadErrorInfo = {
  kind: (typeof readErrorKinds)[keyof typeof readErrorKinds]['kind'];
  message: string;
};

export const getReadErrorInfo = <Kind extends keyof typeof readErrorKinds>(
  errorKind: Kind,
  ...rest: Parameters<(typeof readErrorKinds)[Kind]['message']>
): ReadErrorInfo => {
  const error = readErrorKinds[errorKind];
  const messageFunc = error.message as (
    ...args: Parameters<(typeof readErrorKinds)[Kind]['message']>
  ) => string;
  return {
    kind: error.kind,
    message: messageFunc(...rest)
  };
};
