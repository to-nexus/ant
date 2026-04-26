/**
 * Regression guard: the screenshot/reference-image intents (`gen-ui-ref`,
 * `gen-art-ref`) and the `inputs/references` canonical slot were removed.
 * This test asserts that none of the SSOT modules reintroduce them.
 */
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_FEATURE_DIRS,
  FREE_FORM_DIRS,
  ARTIFACT_DIR_POLICIES,
  INTENT_DEFINITIONS,
  isValidIntentId,
  type IntentId,
} from '@ant/shared';
import { getConfigSlots } from '@ant/shared';
import { getPromptPolicies } from '@ant/shared';

describe('Legacy reference / screenshot intents are absent', () => {
  it('canonical directories do not include inputs/references', () => {
    expect(CANONICAL_FEATURE_DIRS).not.toContain('inputs/references');
  });

  it('free-form directories do not include inputs/references', () => {
    expect(FREE_FORM_DIRS as readonly string[]).not.toContain('inputs/references');
  });

  it('artifact-dir policy has no entry for inputs/references', () => {
    expect(Object.keys(ARTIFACT_DIR_POLICIES)).not.toContain('inputs/references');
  });

  it('intent registry omits gen-ui-ref / gen-art-ref', () => {
    const ids = INTENT_DEFINITIONS.map(d => d.id);
    expect(ids).not.toContain('gen-ui-ref');
    expect(ids).not.toContain('gen-art-ref');
    expect(isValidIntentId('gen-ui-ref')).toBe(false);
    expect(isValidIntentId('gen-art-ref')).toBe(false);
  });

  it('config matrix has no slot config for the removed intents', () => {
    expect(getConfigSlots('gen-ui-ref' as IntentId)).toBeNull();
    expect(getConfigSlots('gen-art-ref' as IntentId)).toBeNull();
  });

  it('prompt-policy matrix has no entry for the removed intents', () => {
    expect(() => getPromptPolicies('gen-ui-ref' as IntentId)).not.toThrow();
    expect(getPromptPolicies('gen-ui-ref' as IntentId)).toBeUndefined();
    expect(getPromptPolicies('gen-art-ref' as IntentId)).toBeUndefined();
  });

  it('no design job intent advertises a `*-by-ref` template suffix', () => {
    const designByRefSuffixes = INTENT_DEFINITIONS
      .filter(d => d.id.startsWith('gen-ui-') || d.id.startsWith('gen-art-'))
      .filter(d => d.id.endsWith('-ref'));
    expect(designByRefSuffixes).toEqual([]);
  });
});
