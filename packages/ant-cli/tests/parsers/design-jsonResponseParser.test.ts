import { describe, it, expect } from 'vitest';
import { parseLLMJsonResponse } from '../../src/agents/architect/graph/design/utils/jsonResponseParser';

/**
 * Regression coverage for the design decompose JSON parser.
 *
 * Single contract — meta tags + `<tasks><task>{json}</task></tasks>`.
 * Legacy `<decompose>{...}</decompose>` and bare-JSON shapes are NOT
 * accepted; the system-design repair-call re-prompts in the new
 * contract on mismatch and ui / game-art / spec callers surface the
 * canonical throw via their outer try-catch.
 *
 * The parser inherits prose-tolerance + fence stripping +
 * brace-balanced extraction from the project-wide SSOT
 * (`core/utils/llmResponseParser`) at every fallback tier inside the
 * tag bodies, so meta and task bodies tolerate analytical prose, doubled
 * fences, and control characters without dropping the payload.
 */

describe('parseLLMJsonResponse — meta tags + <task> sequence', () => {
  it('parses meta tags + <tasks><task> sequence into { ...meta, tasks }', () => {
    const raw = [
      '<executionTier>4</executionTier>',
      '<targetFiles>["fe-system-main.md"]</targetFiles>',
      '<documentType>contract-first</documentType>',
      '<tasks>',
      '<task>{"id":"t1","name":"first","priority":100,"description":"d1","targetFile":"fe-system-main.md"}</task>',
      '<task>{"id":"t2","name":"second","priority":200,"description":"d2","targetFile":"fe-system-main.md"}</task>',
      '</tasks>',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(Array.isArray(r.tasks)).toBe(true);
    expect(r.tasks.map((t: any) => t.id)).toEqual(['t1', 't2']);
    expect(r.targetFiles).toEqual(['fe-system-main.md']);
    expect(r.documentType).toBe('contract-first');
  });

  it('parses scalar meta tags as raw strings (e.g. <documentType>unified</documentType>)', () => {
    const raw = [
      '<documentType>unified</documentType>',
      '<slug>system-design</slug>',
      '<title>System Architecture</title>',
      '<tasks>',
      '<task>{"id":"only","name":"only","priority":100,"description":"d","targetFile":"f.md"}</task>',
      '</tasks>',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.documentType).toBe('unified');
    expect(r.slug).toBe('system-design');
    expect(r.title).toBe('System Architecture');
    expect(r.tasks).toHaveLength(1);
  });

  it('parses object meta tags as JSON objects (e.g. <techTier>{"stack":...}</techTier>)', () => {
    const raw = [
      '<techTier>{"stack":"backend","language":"typescript"}</techTier>',
      '<services>["auth","payments"]</services>',
      '<tasks>',
      '<task>{"id":"only","name":"only","priority":100,"description":"d","targetFile":"f.md"}</task>',
      '</tasks>',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.techTier).toEqual({ stack: 'backend', language: 'typescript' });
    expect(r.services).toEqual(['auth', 'payments']);
  });

  it('tolerates trailing prose inside <task> bodies (regression: prose-leak class)', () => {
    const raw = [
      '<targetFiles>["f.md"]</targetFiles>',
      '<tasks>',
      '<task>',
      '{"id":"t1","name":"first","priority":100,"description":"d","targetFile":"f.md"}',
      '',
      '> NOTE: this task seeds the architecture.',
      '</task>',
      '</tasks>',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.tasks[0].id).toBe('t1');
  });

  it('skips malformed <task> bodies without aborting the whole response', () => {
    const raw = [
      '<targetFiles>["f.md"]</targetFiles>',
      '<tasks>',
      '<task>{"id":"t1","name":"ok","priority":100,"description":"d","targetFile":"f.md"}</task>',
      '<task>not even close to JSON</task>',
      '<task>{"id":"t3","name":"ok","priority":50,"description":"d","targetFile":"f.md"}</task>',
      '</tasks>',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.tasks.map((t: any) => t.id)).toEqual(['t1', 't3']);
  });

  it('treats empty <tasks></tasks> as "contract followed, zero tasks"', () => {
    const raw = [
      '<targetFiles>["f.md"]</targetFiles>',
      '<tasks></tasks>',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.tasks).toEqual([]);
    expect(r.targetFiles).toEqual(['f.md']);
  });

  it('throws the canonical error when <tasks> block is missing entirely', () => {
    expect(() => parseLLMJsonResponse('totally non-contract response')).toThrow(
      'Could not parse task breakdown from LLM response',
    );
  });

  it('throws for legacy <decompose>{...}</decompose> wrapper (BC removed)', () => {
    // BC fallback was removed — legacy contract is no longer accepted.
    // The system-design repair-call re-prompts in the new contract on
    // mismatch; ui / game-art / spec surface the throw via their outer
    // try-catch.
    const raw = '<decompose>{"tasks":[{"id":"t1"}],"targetFiles":["f.md"]}</decompose>';
    expect(() => parseLLMJsonResponse(raw)).toThrow(
      'Could not parse task breakdown from LLM response',
    );
  });

  it('throws for bare JSON objects (BC removed)', () => {
    const raw = '{"tasks":[{"id":"t1"}],"targetFiles":["f.md"]}';
    expect(() => parseLLMJsonResponse(raw)).toThrow(
      'Could not parse task breakdown from LLM response',
    );
  });

  it('tolerates analytical prose around the <tasks> block (meta + prose mixed)', () => {
    const raw = [
      '**분석**: fe-system-main.md 단일 대상으로 정렬',
      '<executionTier>3</executionTier>',
      '<targetFiles>["fe-system-main.md"]</targetFiles>',
      '',
      '아래는 task 분해 결과입니다:',
      '',
      '<tasks>',
      '<task>{"id":"t1","name":"first","priority":100,"description":"d","targetFile":"fe-system-main.md"}</task>',
      '</tasks>',
      '',
      '추가 메모는 없습니다.',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.tasks[0].id).toBe('t1');
    expect(r.targetFiles).toEqual(['fe-system-main.md']);
  });
});
