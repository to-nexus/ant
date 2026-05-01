import { describe, it, expect } from 'vitest';
import {
  extractJsonFromLlmResponse,
  extractFirstJsonObject,
  stripCodeFence,
  sanitizeJsonControlChars,
  prepareTagJson,
} from '../../src/core/utils/llmResponseParser';

/**
 * SSOT for LLM JSON extraction. Every consumer (decompose code/design,
 * specDecompose, direct) goes through `extractJsonFromLlmResponse`, so
 * the prose-tolerance / fence-stripping guards live here exactly once.
 */

describe('extractJsonFromLlmResponse — XML tag tier', () => {
  it('parses a clean tag body', () => {
    const r = extractJsonFromLlmResponse<{ id: string }>(
      '<tasks>{"id":"t1"}</tasks>',
      { tag: 'tasks' },
    );
    expect(r).toEqual({ id: 't1' });
  });

  it('tolerates trailing prose inside the tag (regression: tiny-logging-haven)', () => {
    const r = extractJsonFromLlmResponse<{ id: string }>(
      '<tasks>{"id":"t1"}\n\n**Reasoning**: trailing analytical commentary</tasks>',
      { tag: 'tasks' },
    );
    expect(r).toEqual({ id: 't1' });
  });

  it('tolerates leading prose inside the tag', () => {
    const r = extractJsonFromLlmResponse<{ id: string }>(
      '<tasks>**leading**\n{"id":"t1"}</tasks>',
      { tag: 'tasks' },
    );
    expect(r).toEqual({ id: 't1' });
  });

  it('tolerates a markdown fence wrapping the tag body', () => {
    const r = extractJsonFromLlmResponse<{ id: string }>(
      '<tasks>```json\n{"id":"t1"}\n```</tasks>',
      { tag: 'tasks' },
    );
    expect(r).toEqual({ id: 't1' });
  });
});

describe('extractJsonFromLlmResponse — fence tier', () => {
  it('parses a ```json fence when no tag is present', () => {
    const r = extractJsonFromLlmResponse<{ id: string }>(
      'Some prose before...\n```json\n{"id":"t1"}\n```\n... and after',
    );
    expect(r).toEqual({ id: 't1' });
  });

  it('tolerates trailing prose inside the fence body', () => {
    const r = extractJsonFromLlmResponse<{ id: string }>(
      '```json\n{"id":"t1"}\n\n**aside**: this is the answer\n```',
    );
    expect(r).toEqual({ id: 't1' });
  });
});

describe('extractJsonFromLlmResponse — raw / brace-balanced tier', () => {
  it('parses raw JSON only', () => {
    const r = extractJsonFromLlmResponse<{ id: string }>('{"id":"t1"}');
    expect(r).toEqual({ id: 't1' });
  });

  it('extracts the first object even with surrounding prose', () => {
    const r = extractJsonFromLlmResponse<{ id: string }>(
      '<executionTier>3</executionTier>\nhere is the spec:\n{"id":"t1","title":"T"}\nlet me know.',
    );
    expect(r).toEqual({ id: 't1', title: 'T' });
  });

  it('returns null when no JSON is present', () => {
    const r = extractJsonFromLlmResponse<any>('just plain prose, no JSON');
    expect(r).toBeNull();
  });

  it('returns null on completely empty input', () => {
    expect(extractJsonFromLlmResponse<any>('')).toBeNull();
    expect(extractJsonFromLlmResponse<any>('   \n  ')).toBeNull();
  });
});

describe('extractJsonFromLlmResponse — tag is optional', () => {
  it('skips tag tier when tag is omitted', () => {
    const raw = '<decompose>{"a":1}</decompose>\n\n{"b":2}';
    const r = extractJsonFromLlmResponse<any>(raw);
    // No tag specified → Tier 1 skipped → falls to fence tier (none) → raw
    // brace-balanced. The first `{` in the string is inside the
    // `<decompose>` tag, so brace-balanced still slices `{"a":1}` out.
    expect(r).toEqual({ a: 1 });
  });

  it('honours tag when provided even with surrounding noise', () => {
    const raw = 'preamble\n<decompose>{"a":1}</decompose>\n\n{"b":2}';
    const r = extractJsonFromLlmResponse<any>(raw, { tag: 'decompose' });
    expect(r).toEqual({ a: 1 });
  });
});

describe('extractFirstJsonObject', () => {
  it('returns the first complete object', () => {
    expect(extractFirstJsonObject('{"a":1} extra')).toBe('{"a":1}');
  });

  it('honours nested braces', () => {
    expect(extractFirstJsonObject('{"a":{"b":2}} tail')).toBe('{"a":{"b":2}}');
  });

  it('honours string-literal braces (escape state)', () => {
    expect(extractFirstJsonObject('{"name":"has } brace"} tail'))
      .toBe('{"name":"has } brace"}');
  });

  it('honours escaped quotes inside strings', () => {
    expect(extractFirstJsonObject('{"name":"a\\"b"} tail'))
      .toBe('{"name":"a\\"b"}');
  });

  it('returns body unchanged when no `{` is present', () => {
    expect(extractFirstJsonObject('no json here')).toBe('no json here');
  });
});

describe('stripCodeFence', () => {
  it('strips a triple-backtick fence with language hint', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a bare triple-backtick fence', () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a single-backtick wrap', () => {
    expect(stripCodeFence('`{"a":1}`')).toBe('{"a":1}');
  });

  it('is a no-op when there is no fence', () => {
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe('sanitizeJsonControlChars', () => {
  it('escapes newlines inside string literals', () => {
    const raw = '{"a":"line1\nline2"}';
    const escaped = sanitizeJsonControlChars(raw);
    expect(JSON.parse(escaped)).toEqual({ a: 'line1\nline2' });
  });

  it('does not touch newlines outside string literals', () => {
    const raw = '{\n  "a": 1\n}';
    expect(sanitizeJsonControlChars(raw)).toBe(raw);
    expect(JSON.parse(raw)).toEqual({ a: 1 });
  });
});

describe('prepareTagJson', () => {
  it('strips fence then sanitizes', () => {
    const raw = '```json\n{"a":"line1\nline2"}\n```';
    const prepared = prepareTagJson(raw);
    expect(JSON.parse(prepared)).toEqual({ a: 'line1\nline2' });
  });
});
