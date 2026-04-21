import { describe, it, expect } from 'vitest';
import {
  isIntentCommitted,
  buildIntentClarifyTemplateVars,
} from '../src/agents/common/intentCommit';

/**
 * Regression coverage for the intent-commit SSOT.
 *
 * `isIntentCommitted` is the single predicate that downstream phase
 * nodes consult before emitting intent-level escape hatches (currently
 * only `<specClarify>` in decompose). The two committed signals it
 * consumes cover ActionsPanel explicit starts AND @-mention metadata
 * injection — both must yield true.
 */
describe('isIntentCommitted', () => {
  it('returns true when actionMetadata.intent is present (infer source)', () => {
    expect(
      isIntentCommitted({
        actionMetadata: { intent: 'gen-code-directive' },
        resolvedAction: { source: 'infer' },
      }),
    ).toBe(true);
  });

  it('returns true when actionMetadata.intent is present (no resolvedAction)', () => {
    expect(
      isIntentCommitted({
        actionMetadata: { intent: 'gen-code-sys' },
      }),
    ).toBe(true);
  });

  it('returns true when resolvedAction.source is explicit (no actionMetadata)', () => {
    expect(
      isIntentCommitted({
        resolvedAction: { source: 'explicit' },
      }),
    ).toBe(true);
  });

  it('returns true when BOTH signals are present', () => {
    expect(
      isIntentCommitted({
        actionMetadata: { intent: 'gen-code-spec' },
        resolvedAction: { source: 'explicit' },
      }),
    ).toBe(true);
  });

  it('returns false when neither signal is present', () => {
    expect(
      isIntentCommitted({
        resolvedAction: { source: 'infer' },
      }),
    ).toBe(false);
  });

  it('returns false when actionMetadata has no intent', () => {
    expect(
      isIntentCommitted({
        actionMetadata: {},
        resolvedAction: { source: 'infer' },
      }),
    ).toBe(false);
  });

  it('returns false when state is null or undefined', () => {
    expect(isIntentCommitted(null)).toBe(false);
    expect(isIntentCommitted(undefined)).toBe(false);
  });

  it('returns false on an empty state object', () => {
    expect(isIntentCommitted({})).toBe(false);
  });
});

describe('buildIntentClarifyTemplateVars', () => {
  it('emits { intentClarifyDisabled: true } when intent is committed', () => {
    expect(
      buildIntentClarifyTemplateVars({
        actionMetadata: { intent: 'gen-code-directive' },
      }),
    ).toEqual({ intentClarifyDisabled: true });
  });

  it('emits { intentClarifyDisabled: false } when intent is NOT committed', () => {
    expect(
      buildIntentClarifyTemplateVars({
        resolvedAction: { source: 'infer' },
      }),
    ).toEqual({ intentClarifyDisabled: false });
  });
});
