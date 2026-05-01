import { describe, it, expect, vi, beforeAll } from 'vitest';
import { parseInferredActionFromLLM } from '../../src/core/types/detection';

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/**
 * Regression coverage for `parseInferredActionFromLLM` after the SSOT
 * consolidation (`core/utils/llmResponseParser`). The detect parser
 * inherits prose-tolerance + fence stripping + brace-balanced extraction
 * at every fallback tier — closing the silent-failure surface called
 * out in §3.4 of the decompose SSOT handoff.
 *
 * Pre-SSOT this function used a hand-rolled `<detect>` regex + greedy
 * `\{[\s\S]*\}` fallback + `JSON.parse`. Trailing prose inside `<detect>`
 * (or any prose alongside the JSON in fence/raw tiers) surfaced as a
 * SyntaxError caught by the silent `null` branch — the LLM's intent was
 * dropped without a recoverable signal.
 */
describe('parseInferredActionFromLLM', () => {
  it('parses a clean <detect> tag body', () => {
    const raw = '<detect>{"intentId":"gen-spec","reasoning":"Feature spec request"}</detect>';
    const result = parseInferredActionFromLLM(raw, 'design');
    expect(result).not.toBeNull();
    expect(result!.intentId).toBe('gen-spec');
    expect(result!.sourceJob).toBe('design');
    expect(result!.reasoning?.intent).toBe('Feature spec request');
  });

  it('tolerates trailing prose inside <detect> (regression: prose-leak class)', () => {
    const raw = [
      '<detect>',
      '{"intentId":"gen-sys-fe","reasoning":"Frontend system design"}',
      '',
      '**Reasoning**: user wants the FE-side architecture.',
      '</detect>',
    ].join('\n');
    const result = parseInferredActionFromLLM(raw, 'design');
    expect(result).not.toBeNull();
    expect(result!.intentId).toBe('gen-sys-fe');
  });

  it('tolerates a ```json fence wrapping the <detect> body', () => {
    const raw = [
      '<detect>',
      '```json',
      '{"intentId":"gen-spec","reasoning":"Spec from fence"}',
      '```',
      '</detect>',
    ].join('\n');
    const result = parseInferredActionFromLLM(raw, 'design');
    expect(result).not.toBeNull();
    expect(result!.intentId).toBe('gen-spec');
  });

  it('falls back to ```json fence when no <detect> wrapper is present', () => {
    const raw = [
      'preamble',
      '```json',
      '{"intentId":"gen-spec","reasoning":"No tag wrapper"}',
      '```',
    ].join('\n');
    const result = parseInferredActionFromLLM(raw, 'design');
    expect(result).not.toBeNull();
    expect(result!.intentId).toBe('gen-spec');
  });

  it('falls back to brace-balanced extraction (last-resort tier)', () => {
    const raw = [
      'analysis follows:',
      '{"intentId":"gen-spec","reasoning":"raw object"}',
      'tail prose ignored.',
    ].join('\n');
    const result = parseInferredActionFromLLM(raw, 'plan');
    expect(result).not.toBeNull();
    expect(result!.intentId).toBe('gen-spec');
    expect(result!.sourceJob).toBe('plan');
  });

  it('returns null when intentId is missing', () => {
    const raw = '<detect>{"reasoning":"no intentId"}</detect>';
    expect(parseInferredActionFromLLM(raw, 'design')).toBeNull();
  });

  it('returns null when intentId is invalid (unknown id)', () => {
    const raw = '<detect>{"intentId":"not-a-real-intent"}</detect>';
    expect(parseInferredActionFromLLM(raw, 'design')).toBeNull();
  });

  it('returns null when no JSON is recoverable', () => {
    expect(parseInferredActionFromLLM('totally non-JSON response', 'design')).toBeNull();
  });

  it('returns null on empty response', () => {
    expect(parseInferredActionFromLLM('', 'design')).toBeNull();
  });

  it('preserves the secondary reasoning fallback chain', () => {
    const raw = '<detect>{"intentId":"gen-spec","jobModeReasoning":"fallback reason"}</detect>';
    const result = parseInferredActionFromLLM(raw, 'design');
    expect(result).not.toBeNull();
    expect(result!.reasoning?.intent).toBe('fallback reason');
  });
});
