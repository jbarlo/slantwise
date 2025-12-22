import { z } from 'zod/v4';
import { llmModels, getAlias } from '@lang-data/models.js';

export const assertNever = (value: never): never => value;

export const InputDescriptorItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), hash: z.string() }),
  z.object({ type: z.literal('derivation'), id: z.string() }),
  z.object({ type: z.literal('pinned_path'), path: z.string() }),
  z.object({ type: z.literal('internal_step_link'), targetStepId: z.string() }),
  z.object({ type: z.literal('constant'), value: z.string() })
]);

export type InputDescriptorItem = z.infer<typeof InputDescriptorItemSchema>;

const ExternalInputPrimitivesSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), hash: z.string() }),
  z.object({ type: z.literal('derivation'), id: z.string() }),
  z.object({ type: z.literal('pinned_path'), path: z.string() }),
  z.object({ type: z.literal('constant'), value: z.string() })
]);
type ExternalInputPrimitives = z.infer<typeof ExternalInputPrimitivesSchema>;

export type ExternalInputDescriptorItem =
  | ExternalInputPrimitives
  | { type: 'computed_step'; step: ExternalStepParams };
export const ExternalInputDescriptorItemSchema = z.discriminatedUnion('type', [
  ExternalInputPrimitivesSchema,
  z.object({
    type: z.literal('computed_step'),
    get step() {
      return ExternalStepParamsSchema;
    }
  })
]) satisfies z.ZodType<ExternalInputDescriptorItem>;

const BaseDerivationParamsSchema = z.object({
  get inputs() {
    return InputDescriptorItemSchema.array();
  }
});

const modelAliases = llmModels.map((m) => getAlias(m));
const LlmModelSchema = z.enum(modelAliases);
export type LlmModel = z.infer<typeof LlmModelSchema>;

const LlmDerivationParamsSchema = BaseDerivationParamsSchema.extend({
  operation: z.literal('llm'),
  get inputs() {
    return InputDescriptorItemSchema.array().length(1);
  },
  prompt: z.string(),
  model: LlmModelSchema
});

export type LlmDerivationParams = z.infer<typeof LlmDerivationParamsSchema>;

const IdentityDerivationParamsSchema = BaseDerivationParamsSchema.extend({
  operation: z.literal('identity'),
  get inputs() {
    return InputDescriptorItemSchema.array().length(1);
  }
});

export type IdentityDerivationParams = z.infer<typeof IdentityDerivationParamsSchema>;

const TestConstantDerivationParamsSchema = BaseDerivationParamsSchema.extend({
  operation: z.literal('testConstant'),
  get inputs() {
    return InputDescriptorItemSchema.array().min(0);
  }
});

export type TestConstantDerivationParams = z.infer<typeof TestConstantDerivationParamsSchema>;

const ConcatDerivationParamsSchema = BaseDerivationParamsSchema.extend({
  operation: z.literal('concat'),
  get inputs() {
    return InputDescriptorItemSchema.array().min(2);
  }
});

export type ConcatDerivationParams = z.infer<typeof ConcatDerivationParamsSchema>;

const GetUrlContentDerivationParamsSchema = BaseDerivationParamsSchema.extend({
  operation: z.literal('getUrlContent'),
  get inputs() {
    return InputDescriptorItemSchema.array().length(1);
  }
});

export type GetUrlContentDerivationParams = z.infer<typeof GetUrlContentDerivationParamsSchema>;

export const StepParamsSchema = z.discriminatedUnion('operation', [
  LlmDerivationParamsSchema,
  IdentityDerivationParamsSchema,
  TestConstantDerivationParamsSchema,
  ConcatDerivationParamsSchema,
  GetUrlContentDerivationParamsSchema
]);
export type StepParams = z.infer<typeof StepParamsSchema>;

export type DerivationParams = {
  recipeParams: StepParams;
  label: string | null;
};

const ExternalBaseDerivationParamsSchema = z.object({
  get inputs(): z.ZodArray<z.ZodType<ExternalInputDescriptorItem>> {
    return ExternalInputDescriptorItemSchema.array();
  }
});

const ExternalLlmDerivationParamsSchema = ExternalBaseDerivationParamsSchema.extend({
  operation: z.literal('llm'),
  get inputs(): z.ZodArray<z.ZodType<ExternalInputDescriptorItem>> {
    return ExternalInputDescriptorItemSchema.array().length(1);
  },
  prompt: z.string(),
  model: LlmModelSchema
});

const ExternalIdentityDerivationParamsSchema = ExternalBaseDerivationParamsSchema.extend({
  operation: z.literal('identity'),
  get inputs(): z.ZodArray<z.ZodType<ExternalInputDescriptorItem>> {
    return ExternalInputDescriptorItemSchema.array().length(1);
  }
});

const ExternalTestConstantDerivationParamsSchema = ExternalBaseDerivationParamsSchema.extend({
  operation: z.literal('testConstant'),
  get inputs(): z.ZodArray<z.ZodType<ExternalInputDescriptorItem>> {
    return ExternalInputDescriptorItemSchema.array().min(0);
  }
});

const ExternalConcatDerivationParamsSchema = ExternalBaseDerivationParamsSchema.extend({
  operation: z.literal('concat'),
  get inputs(): z.ZodArray<z.ZodType<ExternalInputDescriptorItem>> {
    return ExternalInputDescriptorItemSchema.array().min(2);
  }
});

const ExternalGetUrlContentDerivationParamsSchema = ExternalBaseDerivationParamsSchema.extend({
  operation: z.literal('getUrlContent'),
  get inputs(): z.ZodArray<z.ZodType<ExternalInputDescriptorItem>> {
    return ExternalInputDescriptorItemSchema.array().length(1);
  }
});

// TODO define internal and external in a way to standardize the union
export const ExternalStepParamsSchema = z.discriminatedUnion('operation', [
  ExternalLlmDerivationParamsSchema,
  ExternalIdentityDerivationParamsSchema,
  ExternalTestConstantDerivationParamsSchema,
  ExternalConcatDerivationParamsSchema,
  ExternalGetUrlContentDerivationParamsSchema
]);
export type ExternalStepParams = z.infer<typeof ExternalStepParamsSchema>;

export type ExternalDerivationParams = {
  recipeParams: ExternalStepParams;
  label: string | null;
};

export type OperationWarning = {
  type: 'inputTooLarge';
  inputContentLength: number;
  contextWindowLimit: number;
};

// TODO consider an extended shape mirroring StepParams
export type DependencyTree = (
  | {
      type: 'content' | 'pinned_path' | 'constant';
      contentHash: string;
    }
  | {
      type: 'derivation' | 'computed_step';
      wasCached: boolean;
      dependencies: DependencyTree;
      contentHash: string;
      warnings: OperationWarning[];
      operation: StepParams['operation'];
    }
)[];

export type ExecutionTree = {
  operation: StepParams['operation'];
  wasCached: boolean;
  dependencies: DependencyTree;
  warnings: OperationWarning[];
  contentHash: string;
  // SCC metadata (present when this derivation was evaluated as part of an SCC)
  sccMetadata?: {
    sccId: string;
    iterationCount: number;
    sccMembers: string[];
  };
};

// Produces a version of StepParams suitable for deterministic sort keys by removing
// identifiers that are non-semantic for ordering (ids, paths, hashes, constants).
export const normalizeStepParamsForSort = (recipeParams: StepParams): StepParams => {
  try {
    const normalizedInputs: InputDescriptorItem[] = recipeParams.inputs.map((item) => {
      switch (item.type) {
        case 'derivation':
          return { type: 'derivation', id: '<deriv>' };
        case 'internal_step_link':
          return { type: 'internal_step_link', targetStepId: '<step>' } as InputDescriptorItem;
        case 'pinned_path':
          return { type: 'pinned_path', path: '<path>' };
        case 'content':
          return { type: 'content', hash: '<hash>' };
        case 'constant':
          return { type: 'constant', value: '<const>' };
        default:
          return assertNever(item);
      }
    });

    const base: StepParams = { ...recipeParams };
    if (normalizedInputs) base.inputs = normalizedInputs;
    return base;
  } catch {
    return recipeParams;
  }
};
