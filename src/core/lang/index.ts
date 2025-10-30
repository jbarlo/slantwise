import { createToken, Lexer, CstParser, IToken, CstNode } from 'chevrotain';
import {
  ExternalInputDescriptorItem,
  ExternalStepParams,
  ExternalStepParamsSchema
} from '../db/types.js';
import { tokenPatterns } from '@lang-data/tokens.js';

/*
 * ---------------------------------------------------------------------------
 *  Token Definitions
 * ---------------------------------------------------------------------------
 */
const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: tokenPatterns.whiteSpace,
  group: Lexer.SKIPPED
});

const Pipe = createToken({ name: 'Pipe', pattern: tokenPatterns.pipe });
const Comma = createToken({ name: 'Comma', pattern: tokenPatterns.comma });
const LParen = createToken({ name: 'LParen', pattern: tokenPatterns.lParen });
const RParen = createToken({ name: 'RParen', pattern: tokenPatterns.rParen });
const Equals = createToken({ name: 'Equals', pattern: tokenPatterns.equals });

const StringLiteral = createToken({
  name: 'StringLiteral',
  // Supports either double-quoted or single-quoted strings with escapes
  pattern: tokenPatterns.stringLiteral
});

const HashLiteral = createToken({
  name: 'HashLiteral',
  pattern: tokenPatterns.hashLiteral
});

const PathLiteral = createToken({
  name: 'PathLiteral',
  pattern: tokenPatterns.pathLiteral
});

const DerivationRef = createToken({
  name: 'DerivationRef',
  pattern: tokenPatterns.derivationReferenceLiteral
});

const Identifier = createToken({
  name: 'Identifier',
  pattern: tokenPatterns.identifier
});

const allTokens = [
  WhiteSpace,
  Pipe,
  Comma,
  LParen,
  RParen,
  Equals,
  StringLiteral,
  HashLiteral,
  PathLiteral,
  DerivationRef,
  Identifier
];

export const DerivationLexer = new Lexer(allTokens);

/*
 * ---------------------------------------------------------------------------
 *  Parser Definition (CST)
 * ---------------------------------------------------------------------------
 */
class _DerivationCstParser extends CstParser {
  constructor() {
    super(allTokens, { recoveryEnabled: true });
    this.performSelfAnalysis();
  }

  public expression = this.RULE('expression', () => {
    this.SUBRULE(this.pipeline);
  });

  private pipeline = this.RULE('pipeline', () => {
    this.SUBRULE(this.pipeHead);
    this.MANY(() => {
      this.CONSUME(Pipe);
      this.SUBRULE(this.operationCall);
    });
  });

  private pipeHead = this.RULE('pipeHead', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.operationCall) },
      { ALT: () => this.SUBRULE(this.literal) }
    ]);
  });

  private operationCall = this.RULE('operationCall', () => {
    this.CONSUME(Identifier);
    this.CONSUME(LParen);
    this.OPTION(() => {
      this.SUBRULE(this.argList);
    });
    this.CONSUME(RParen);
  });

  private argList = this.RULE('argList', () => {
    this.SUBRULE(this.arg);
    this.MANY(() => {
      this.CONSUME(Comma);
      this.SUBRULE2(this.arg);
    });
  });

  private arg = this.RULE('arg', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.keywordArg) },
      { ALT: () => this.SUBRULE(this.literal) },
      { ALT: () => this.SUBRULE(this.operationCall) }
    ]);
  });

  private keywordArg = this.RULE('keywordArg', () => {
    this.CONSUME(Identifier);
    this.CONSUME(Equals);
    this.SUBRULE(this.keywordValue);
  });

  private keywordValue = this.RULE('keywordValue', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.literal) },
      { ALT: () => this.SUBRULE(this.operationCall) }
    ]);
  });

  private literal = this.RULE('literal', () => {
    this.OR([
      { ALT: () => this.CONSUME(StringLiteral) },
      { ALT: () => this.CONSUME(HashLiteral) },
      { ALT: () => this.CONSUME(PathLiteral) },
      { ALT: () => this.CONSUME(DerivationRef) }
    ]);
  });
}

const parserInstance = new _DerivationCstParser();

/*
 * ---------------------------------------------------------------------------
 *  CST → AST Visitor
 * ---------------------------------------------------------------------------
 */
const BaseVisitor = parserInstance.getBaseCstVisitorConstructor();

type NonEmpty<T> = [T, ...T[]];

// Helpers to safely access first elements
const firstToken = (tokens: NonEmpty<IToken> | undefined, label: string): IToken => {
  if (!tokens || tokens.length === 0) {
    throw new Error(`Parser invariant violated: expected token ${label}`);
  }
  return tokens[0];
};

const firstNode = (nodes: NonEmpty<CstNode> | undefined, label: string): CstNode => {
  if (!nodes || nodes.length === 0) {
    throw new Error(`Parser invariant violated: expected node ${label}`);
  }
  return nodes[0];
};

// Typed CST context interfaces
type ExpressionCtx = { pipeline: NonEmpty<CstNode> };

type PipelineCtx = {
  pipeHead: NonEmpty<CstNode>;
  operationCall?: CstNode[];
};

type PipeHeadCtx = {
  operationCall?: NonEmpty<CstNode>;
  literal?: NonEmpty<CstNode>;
};

type OperationCallCtx = {
  Identifier: NonEmpty<IToken>;
  LParen: NonEmpty<IToken>;
  argList?: NonEmpty<CstNode>;
  RParen: NonEmpty<IToken>;
};

type ArgListCtx = { arg: NonEmpty<CstNode> };

type ArgCtx = {
  keywordArg?: NonEmpty<CstNode>;
  literal?: NonEmpty<CstNode>;
  operationCall?: NonEmpty<CstNode>;
};

type KeywordArgCtx = {
  Identifier: NonEmpty<IToken>;
  keywordValue: NonEmpty<CstNode>;
};

type KeywordValueCtx = {
  literal?: NonEmpty<CstNode>;
  operationCall?: NonEmpty<CstNode>;
};

type LiteralCtx = {
  StringLiteral?: NonEmpty<IToken>;
  HashLiteral?: NonEmpty<IToken>;
  PathLiteral?: NonEmpty<IToken>;
  DerivationRef?: NonEmpty<IToken>;
};

// Visitor result helper types
type KwPair = { kind: 'kw'; key: string; value: unknown };
type InputItemRes = { kind: 'input'; value: ExternalInputDescriptorItem };
type ArgVisitResult = InputItemRes | KwPair;

type LiteralRaw = { kind: 'literalRaw'; value: string };
type LiteralResult = LiteralRaw | ExternalInputDescriptorItem;

type PipelineValue = ExternalInputDescriptorItem | ExternalStepParams;

const isObjectRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const isInputRes = (v: unknown): v is InputItemRes =>
  isObjectRecord(v) &&
  (v as Record<string, unknown>).kind === 'input' &&
  isObjectRecord((v as Record<string, unknown>).value);

const isKwRes = (v: unknown): v is KwPair =>
  isObjectRecord(v) &&
  (v as Record<string, unknown>).kind === 'kw' &&
  typeof (v as Record<string, unknown>).key === 'string';

const isLiteralRaw = (v: unknown): v is LiteralRaw =>
  isObjectRecord(v) &&
  (v as Record<string, unknown>).kind === 'literalRaw' &&
  typeof (v as Record<string, unknown>).value === 'string';

const isStepParamsLike = (v: unknown): v is ExternalStepParams =>
  isObjectRecord(v) &&
  typeof (v as Record<string, unknown>).operation === 'string' &&
  Array.isArray((v as Record<string, unknown>).inputs);

class AstBuilder extends BaseVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  private tokenToString(tok: IToken): string {
    return tok.image;
  }

  private toInputDescriptor(value: PipelineValue): ExternalInputDescriptorItem {
    if (isStepParamsLike(value)) {
      return { type: 'computed_step', step: value };
    }
    return value;
  }

  private parseStringToken(raw: string): string {
    const first = raw[0];
    if (first === '"') {
      return JSON.parse(raw);
    }
    // Convert single-quoted string to JSON-compatible double-quoted
    // Handle escapes: \' -> ', unescaped " must be escaped
    const inner = raw.slice(1, -1);
    let jsonInner = '';
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]!;
      if (ch === '\\') {
        const next = inner[i + 1];
        if (next === "'") {
          jsonInner += "'";
          i += 1;
          continue;
        }
        // Preserve other escapes for JSON.parse (e.g., \n, \", \\)
        if (next != null) {
          jsonInner += '\\' + next;
          i += 1;
          continue;
        }
        jsonInner += '\\';
        continue;
      }
      if (ch === '"') {
        jsonInner += '\\"';
        continue;
      }
      jsonInner += ch;
    }
    const jsonWrapped = '"' + jsonInner + '"';
    return JSON.parse(jsonWrapped);
  }

  public expression(ctx: ExpressionCtx): unknown {
    return this.visit(firstNode(ctx.pipeline, 'pipeline'));
  }

  public pipeline(ctx: PipelineCtx): unknown {
    let current = this.visit(firstNode(ctx.pipeHead, 'pipeHead')) as PipelineValue | LiteralResult;

    // Normalize literalRaw to constant input for pipeline head if needed
    if (isLiteralRaw(current)) {
      current = {
        type: 'constant',
        value: current.value
      } as ExternalInputDescriptorItem;
    }

    if (!ctx.operationCall || ctx.operationCall.length === 0) {
      return current;
    }

    for (let i = 0; i < ctx.operationCall.length; i++) {
      const rhs = this.visit(ctx.operationCall[i]!) as ExternalStepParams;
      const pipedInput = this.toInputDescriptor(current as PipelineValue);
      const combined: ExternalStepParams = {
        ...rhs,
        inputs: [pipedInput, ...rhs.inputs]
      } as ExternalStepParams;
      current = combined;
    }

    return current;
  }

  public pipeHead(ctx: PipeHeadCtx): PipelineValue | LiteralResult {
    if (ctx.operationCall) {
      return this.visit(firstNode(ctx.operationCall, 'operationCall')) as ExternalStepParams;
    }
    return this.visit(firstNode(ctx.literal, 'literal')) as LiteralResult;
  }

  public operationCall(ctx: OperationCallCtx): unknown {
    const operationNameTok: IToken = firstToken(ctx.Identifier, 'Identifier');
    const operation = this.tokenToString(operationNameTok);

    const positionalInputs: ExternalInputDescriptorItem[] = [];
    const keywordPairs: Record<string, unknown> = {};

    if (ctx.argList) {
      const { inputs, kwargs } = this.visit(firstNode(ctx.argList, 'argList')) as {
        inputs: ExternalInputDescriptorItem[];
        kwargs: Record<string, unknown>;
      };
      positionalInputs.push(...inputs);
      Object.assign(keywordPairs, kwargs);
    }

    const step = {
      operation,
      inputs: positionalInputs,
      ...keywordPairs
    };

    return step;
  }

  public argList(ctx: ArgListCtx): {
    inputs: ExternalInputDescriptorItem[];
    kwargs: Record<string, unknown>;
  } {
    const first = this.visit(firstNode(ctx.arg, 'arg'));

    const inputs: ExternalInputDescriptorItem[] = isInputRes(first) ? [first.value] : [];

    const kwargs: Record<string, unknown> = isKwRes(first) ? { [first.key]: first.value } : {};

    let seenKeyword = isKwRes(first);

    if (ctx.arg && ctx.arg.length > 1) {
      for (let i = 1; i < ctx.arg.length; i++) {
        const res = this.visit(ctx.arg[i]!);
        if (isInputRes(res)) {
          if (seenKeyword) {
            throw new Error('Positional arguments cannot follow keyword arguments');
          }
          inputs.push(res.value);
        } else if (isKwRes(res)) {
          seenKeyword = true;
          kwargs[res.key] = res.value;
        }
      }
    }

    return { inputs, kwargs };
  }

  public arg(ctx: ArgCtx): ArgVisitResult | undefined {
    if (ctx.keywordArg) {
      return this.visit(firstNode(ctx.keywordArg, 'keywordArg')) as KwPair;
    }
    if (ctx.literal) {
      const lit = this.visit(firstNode(ctx.literal, 'literal')) as LiteralResult;
      if (isLiteralRaw(lit)) {
        return {
          kind: 'input',
          value: { type: 'constant', value: lit.value }
        };
      }
      return { kind: 'input', value: lit };
    }
    if (ctx.operationCall) {
      const step = this.visit(firstNode(ctx.operationCall, 'operationCall')) as ExternalStepParams;
      return { kind: 'input', value: { type: 'computed_step', step } };
    }
    return undefined;
  }

  public keywordArg(ctx: KeywordArgCtx): KwPair {
    const keyTok: IToken = firstToken(ctx.Identifier, 'Identifier');
    const key = this.tokenToString(keyTok);
    const valNode = this.visit(firstNode(ctx.keywordValue, 'keywordValue'));

    let value: unknown;
    if (typeof valNode === 'string' || typeof valNode === 'number') {
      value = valNode;
    } else if (isLiteralRaw(valNode)) {
      value = (valNode as LiteralRaw).value;
    } else {
      value = valNode;
    }

    return { kind: 'kw', key, value };
  }

  public keywordValue(ctx: KeywordValueCtx): unknown {
    if (ctx.literal) {
      const literalRes = this.visit(firstNode(ctx.literal, 'literal'));
      if (isLiteralRaw(literalRes)) return (literalRes as LiteralRaw).value;
      return literalRes;
    }
    if (ctx.operationCall) {
      return this.visit(firstNode(ctx.operationCall, 'operationCall'));
    }
    return undefined;
  }

  public literal(ctx: LiteralCtx): LiteralResult | undefined {
    if (ctx.StringLiteral) {
      const tok: IToken = firstToken(ctx.StringLiteral, 'StringLiteral');
      const raw = this.tokenToString(tok);
      const value = this.parseStringToken(raw);
      return { kind: 'literalRaw', value };
    }
    if (ctx.HashLiteral) {
      const tok: IToken = firstToken(ctx.HashLiteral, 'HashLiteral');
      const hash = this.tokenToString(tok).slice(1);
      return { type: 'content', hash };
    }
    if (ctx.PathLiteral) {
      const tok: IToken = firstToken(ctx.PathLiteral, 'PathLiteral');
      const path = this.tokenToString(tok).slice(1, -1);
      return { type: 'pinned_path', path };
    }
    if (ctx.DerivationRef) {
      const tok: IToken = firstToken(ctx.DerivationRef, 'DerivationRef');
      const id = this.tokenToString(tok).slice(1);
      return { type: 'derivation', id };
    }
    return undefined;
  }
}

const astBuilder = new AstBuilder();

/*
 * ---------------------------------------------------------------------------
 *  Public API
 * ---------------------------------------------------------------------------
 */
export type ParseDerivationResult =
  | { success: true; params: ExternalStepParams }
  | {
      success: false;
      kind: 'lexer' | 'parser' | 'ast-validation' | 'ast-transform';
      errors: string[];
    };

export type ParseDerivationAstResult =
  | { success: true; ast: unknown }
  | {
      success: false;
      kind: 'lexer' | 'parser' | 'ast-transform';
      errors: string[];
    };

export function __parseDerivationExpressionAst(expression: string): ParseDerivationAstResult {
  const errors: string[] = [];

  const { tokens, errors: lexErrors } = DerivationLexer.tokenize(expression);
  if (lexErrors.length) {
    const lexMessages = lexErrors.map((e, idx) => {
      const parts = [
        `Lex #${idx + 1}: ${e.message}`,
        typeof (e as { line?: number; column?: number }).line === 'number' &&
        typeof (e as { line?: number; column?: number }).column === 'number'
          ? `at line ${(e as { line: number; column: number }).line}, column ${(e as { line: number; column: number }).column}`
          : `at offset ${e.offset}`
      ];
      return parts.join(' ');
    });
    errors.push(...lexMessages);
    return { success: false, kind: 'lexer', errors };
  }

  try {
    parserInstance.input = tokens;
    const cst = parserInstance.expression();
    if (parserInstance.errors.length) {
      const parseMessages = parserInstance.errors.map(
        (e, idx) => `Parse #${idx + 1}: ${e.message}`
      );
      errors.push(...parseMessages);
      return { success: false, kind: 'parser', errors };
    }
    const ast = astBuilder.visit(cst);
    return { success: true, ast };
  } catch (err: unknown) {
    errors.push(`AST transformation error: ${(err as Error)?.message ?? String(err)}`);
    return { success: false, kind: 'ast-transform', errors };
  }
}

export function parseDerivationExpression(expression: string): ParseDerivationResult {
  const parsed = __parseDerivationExpressionAst(expression);
  if (!parsed.success) {
    return parsed;
  }
  const validated = ExternalStepParamsSchema.safeParse(parsed.ast);
  if (!validated.success) {
    const zodIssues = validated.error.issues.map(
      (i) => `Schema: ${i.message} at ${i.path.join('.')}`
    );
    return { success: false, kind: 'ast-validation', errors: zodIssues };
  }
  return { success: true, params: validated.data };
}

// Expose grammar for diagram generation
export const __getSerializedGrammar = () =>
  (
    parserInstance as unknown as { getSerializedGastProductions: () => unknown }
  ).getSerializedGastProductions();
