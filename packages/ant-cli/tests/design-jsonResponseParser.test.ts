import { describe, it, expect } from 'vitest';
import { parseLLMJsonResponse } from '../src/agents/architect/graph/design/utils/jsonResponseParser';

/**
 * Regression coverage for the design decompose JSON parser. After the
 * SSOT consolidation (`core/utils/llmResponseParser`), the design
 * wrapper inherits prose-tolerance + fence stripping + brace-balanced
 * extraction at every fallback tier.
 *
 * The base contract — `<decompose>{...}</decompose>` first, then
 * markdown fence, then raw object — must be preserved, and the legacy
 * "Could not parse task breakdown from LLM response" throw is the
 * SSOT-null contract that `uiDesignDecompose` / `systemDesignDecompose`
 * / `gameArtDesignDecompose` rely on for repair-call activation.
 */

describe('parseLLMJsonResponse (design wrapper)', () => {
  it('parses a clean <decompose> tag body', () => {
    const r = parseLLMJsonResponse(
      '<decompose>{"tasks":[{"id":"t1"}],"targetFiles":["fe-system-main.md"]}</decompose>',
    );
    expect(r.tasks[0].id).toBe('t1');
    expect(r.targetFiles).toEqual(['fe-system-main.md']);
  });

  it('tolerates trailing prose inside <decompose> (regression: prose-leak class)', () => {
    const raw = [
      '<executionTier>3</executionTier>',
      '<decompose>',
      '{"tasks":[{"id":"t1"}],"targetFiles":["fe-system-main.md"]}',
      '',
      '**Reasoning**: this breakdown covers...',
      '</decompose>',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.tasks[0].id).toBe('t1');
  });

  it('tolerates leading analytical prose inside <decompose>', () => {
    const raw = [
      '<decompose>',
      '**분석**: 단일 fe-system-main.md 대상',
      '',
      '{"tasks":[{"id":"t1"}],"targetFiles":["fe-system-main.md"]}',
      '</decompose>',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.tasks[0].id).toBe('t1');
  });

  it('tolerates a ```json fence wrapping the <decompose> body', () => {
    const raw = [
      '<decompose>',
      '```json',
      '{"tasks":[{"id":"t1"}],"targetFiles":["fe-system-main.md"]}',
      '```',
      '</decompose>',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.tasks[0].id).toBe('t1');
  });

  it('falls back to ```json fence when no tag wrapper is present', () => {
    const raw = [
      'preamble',
      '```json',
      '{"tasks":[{"id":"t1"}],"targetFiles":["fe-system-main.md"]}',
      '```',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.tasks[0].id).toBe('t1');
  });

  it('falls back to brace-balanced extraction (last-resort tier)', () => {
    const raw = [
      '<executionTier>3</executionTier>',
      '여기 결과입니다:',
      '{"tasks":[{"id":"t1"}],"targetFiles":["fe-system-main.md"]}',
      '추가 메모는 없습니다.',
    ].join('\n');
    const r = parseLLMJsonResponse(raw);
    expect(r.tasks[0].id).toBe('t1');
  });

  it('throws the canonical error when no JSON is recoverable', () => {
    expect(() => parseLLMJsonResponse('totally non-JSON response')).toThrow(
      'Could not parse task breakdown from LLM response',
    );
  });
});
