import { describe, it, expect, assert } from 'vitest';
import { parseDerivationExpression, __parseDerivationExpressionAst } from './index.js';

describe('parseDerivationExpression', () => {
  it('parses llm with constant positional input and keyword args', () => {
    const result = parseDerivationExpression(
      'llm("hello", prompt="Summarize", model="gpt-4o")'
    );
    expect(result.success).toBe(true);
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'llm',
      inputs: [{ type: 'constant', value: 'hello' }],
      prompt: 'Summarize',
      model: 'gpt-4o'
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
      'llm(identity("hello"), prompt="rewrite", model="gpt-4o-mini")'
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
      model: 'gpt-4o-mini'
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
      'identity("a") |> llm(prompt="b", model="gpt-4o")'
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
      model: 'gpt-4o'
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
    const parsed = __parseDerivationExpressionAst('llm(prompt="p", model="gpt-4o")');
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
      `$${expectedId} |> llm(prompt="Summarize", model="gpt-4o")`
    );
    assert(result.success);
    const params = result.params;
    expect(params).toEqual({
      operation: 'llm',
      inputs: [{ type: 'derivation', id: expectedId }],
      prompt: 'Summarize',
      model: 'gpt-4o'
    });
  });

  describe('error cases', () => {
    it('reports lexer errors with kind=lexer', () => {
      const result = parseDerivationExpression('llm("unterminated)');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.kind).toBe('lexer');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('reports parser errors with kind=parser', () => {
      const result = parseDerivationExpression('llm(,)');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.kind).toBe('parser');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('reports ast-validation errors with kind=ast-validation', () => {
      // Valid syntax and tokens, but invalid model enum => ast-validation
      const result = parseDerivationExpression('llm("x", prompt="ok", model="nope")');
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.kind).toBe('ast-validation');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('enforces kwargs must follow positional inputs', () => {
      const ok = parseDerivationExpression('llm("x", prompt="p", model="gpt-4o")');
      expect(ok.success).toBe(true);

      const bad = parseDerivationExpression('llm(prompt="p", "x", model="gpt-4o")');
      expect(bad.success).toBe(false);
      assert(!bad.success);
      expect(bad.kind).toBe('ast-transform');
      expect(bad.errors.length).toBeGreaterThan(0);
    });
  });
});
