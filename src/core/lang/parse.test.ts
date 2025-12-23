import { describe, it, expect, assert } from 'vitest';
import { parseDerivationExpression, __parseDerivationExpressionAst } from './index.js';

describe('parseDerivationExpression', () => {
  it('parses llm with constant positional input and keyword args', () => {
    const result = parseDerivationExpression(
      'llm("hello", prompt="Summarize", model="openai/gpt-o3")'
    );
    expect(result.success).toBe(true);
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'llm',
      inputs: [{ type: 'constant', value: 'hello' }],
      prompt: 'Summarize',
      model: 'openai/gpt-o3'
    });
  });

  it('parses content hash as positional input', () => {
    const expectedHash = 'deadbeefcafebaba';
    const result = parseDerivationExpression(`identity(#${expectedHash})`);
    expect(result.success).toBe(true);
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'identity',
      inputs: [{ type: 'content', hash: expectedHash }]
    });
  });

  it('parses pinned path as positional input', () => {
    const expectedPath = 'watched/file.txt';
    const result = parseDerivationExpression(`identity(\`${expectedPath}\`)`);
    expect(result.success).toBe(true);
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'identity',
      inputs: [{ type: 'pinned_path', path: expectedPath }]
    });
  });

  it('parses nested computed step as positional input', () => {
    const result = parseDerivationExpression(
      'llm(identity("hello"), prompt="rewrite", model="openai/gpt-5")'
    );
    expect(result.success).toBe(true);
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'llm',
      inputs: [
        {
          type: 'computed_step',
          step: {
            operation: 'identity',
            inputs: [{ type: 'constant', value: 'hello' }]
          }
        }
      ],
      prompt: 'rewrite',
      model: 'openai/gpt-5'
    });
  });

  it('parses multiple positional inputs (concat)', () => {
    const result = parseDerivationExpression('concat("a", "b", "c")');
    expect(result.success).toBe(true);
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'concat',
      inputs: [
        { type: 'constant', value: 'a' },
        { type: 'constant', value: 'b' },
        { type: 'constant', value: 'c' }
      ]
    });
  });

  it('supports the pipe operator and injects LHS as first input of RHS', () => {
    const result = parseDerivationExpression(
      'identity("a") |> llm(prompt="b", model="openai/gpt-o3")'
    );
    expect(result.success).toBe(true);
    assert(result.success);
    expect(result.params).toEqual({
      operation: 'llm',
      inputs: [
        {
          type: 'computed_step',
          step: {
            operation: 'identity',
            inputs: [{ type: 'constant', value: 'a' }]
          }
        }
      ],
      prompt: 'b',
      model: 'openai/gpt-o3'
    });
  });

  it('parses single-quoted strings with escaping', () => {
    const result = parseDerivationExpression("concat('a \\'quote\\'', 'b')");
    expect(result.success).toBe(true);
    assert(result.success);
    expect(result.params).toEqual({
      operation: 'concat',
      inputs: [
        { type: 'constant', value: "a 'quote'" },
        { type: 'constant', value: 'b' }
      ]
    });
  });

  it('parser-only: allows kwargs when no positional args in RHS list', () => {
    const parsed = __parseDerivationExpressionAst('llm(prompt="p", model="openai/gpt-o3")');
    expect(parsed.success).toBe(true);
  });

  it('parses derivation reference as positional input', () => {
    const expectedId = 'abc123';
    const result = parseDerivationExpression(`identity($${expectedId})`);
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'identity',
      inputs: [{ type: 'derivation', id: expectedId }]
    });
  });

  it('parses derivation reference with hyphens and underscores', () => {
    const expectedId = 'my-derivation_id-123';
    const result = parseDerivationExpression(`identity($${expectedId})`);
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'identity',
      inputs: [{ type: 'derivation', id: expectedId }]
    });
  });

  it('parses derivation reference in pipeline', () => {
    const expectedId = 'source-doc';
    const result = parseDerivationExpression(
      `$${expectedId} |> llm(prompt="Summarize", model="openai/gpt-o3")`
    );
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'llm',
      inputs: [{ type: 'derivation', id: expectedId }],
      prompt: 'Summarize',
      model: 'openai/gpt-o3'
    });
  });

  describe('error cases', () => {
    it('reports lexer errors with kind=lexer and position', () => {
      const result = parseDerivationExpression('llm("unterminated)');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.kind).toBe('lexer');
      expect(result.errors.length).toBeGreaterThan(0);
      const first = result.errors[0]!;
      expect(first.code).toBe('SYNTAX_ERROR');
      expect(first.position).toBeDefined();
      // position should have either line/column or offset
      const pos = first.position!;
      const hasLineCol = pos.line !== undefined && pos.column !== undefined;
      const hasOffset = pos.offset !== undefined;
      expect(hasLineCol || hasOffset).toBe(true);
    });

    it('reports parser errors with kind=parser and position', () => {
      const result = parseDerivationExpression('llm(,)');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.kind).toBe('parser');
      expect(result.errors.length).toBeGreaterThan(0);
      const first = result.errors[0]!;
      expect(first.code).toBe('SYNTAX_ERROR');
      expect(first.position).toBeDefined();
    });

    it('reports ast-validation errors with kind=ast-validation and error codes', () => {
      // Valid syntax and tokens, but invalid model enum => ast-validation
      const result = parseDerivationExpression('llm("x", prompt="ok", model="nope")');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.kind).toBe('ast-validation');
      expect(result.errors.length).toBeGreaterThan(0);
      // Validation errors should have INVALID_MODEL code
      expect(result.errors.some((e) => e.code === 'INVALID_MODEL')).toBe(true);
    });

    it('enforces kwargs must follow positional inputs', () => {
      const ok = parseDerivationExpression('llm("x", prompt="p", model="openai/gpt-o3")');
      expect(ok.success).toBe(true);

      const bad = parseDerivationExpression('llm(prompt="p", "x", model="openai/gpt-o3")');
      expect(bad.success).toBe(false);
      assert(!bad.success);
      expect(bad.kind).toBe('ast-transform');
      expect(bad.errors.length).toBeGreaterThan(0);
    });
  });
});
