/**
 * Auxiliary (non-graph) model-slot consistency guard.
 *
 * `AUXILIARY_MODEL_KEYS` (@ant/shared) enumerates NON-graph LLM calls that
 * expose a default-only model picker (e.g. the ant-authored commit message).
 * These keys MUST stay out of the graph-coupled slot maps — otherwise the
 * llm-model-slots-coverage drift test would try to compile a graph for a key
 * with no agent, and fail. This test locks that isolation plus the two facts a
 * new aux key needs to actually resolve a model: a BE job-default and a valid
 * `LLMContext.jobType` value.
 */

import { describe, it, expect } from 'vitest';
import { AUXILIARY_MODEL_KEYS, OVERRIDABLE_MODEL_SLOTS, MODEL_JOB_AGENT, DEFAULT_MODELS } from '@ant/shared';
import { getConfigMergeDefaults } from '../../src/core/types/workspace';
import type { LLMContext } from '../../src/periphery/adapters/llm/LLMClientFactory';

describe('auxiliary model slots', () => {
  it('every auxiliary key has a BE job-level default', () => {
    const defaults = getConfigMergeDefaults();
    for (const key of AUXILIARY_MODEL_KEYS) {
      expect(defaults[key]?.default, `missing default for aux key "${key}"`).toBeTruthy();
    }
  });

  it('the commit aux slot defaults to the Sonnet tier', () => {
    // Without AI_MODEL_NAME the merge base resolves to the tier default; with it
    // set, the env override wins. Assert the tier default here.
    const prev = process.env.AI_MODEL_NAME;
    delete process.env.AI_MODEL_NAME;
    try {
      const defaults = getConfigMergeDefaults();
      expect(defaults.commit?.default).toBe(DEFAULT_MODELS.sonnetTier);
    } finally {
      if (prev !== undefined) process.env.AI_MODEL_NAME = prev;
    }
  });

  it('auxiliary keys stay OUT of the graph slot maps (drift-test isolation)', () => {
    for (const key of AUXILIARY_MODEL_KEYS) {
      expect(Object.keys(OVERRIDABLE_MODEL_SLOTS)).not.toContain(key);
      expect(Object.keys(MODEL_JOB_AGENT)).not.toContain(key);
    }
  });

  it('auxiliary keys are valid LLMContext.jobType values (compile-time guard)', () => {
    // Fails to COMPILE if an aux key is added to AUXILIARY_MODEL_KEYS without
    // being added to the LLMContext.jobType union — so createLLMClient can
    // resolve `llmModels[key].default`.
    const asJobTypes: LLMContext['jobType'][] = [...AUXILIARY_MODEL_KEYS];
    expect(asJobTypes.length).toBe(AUXILIARY_MODEL_KEYS.length);
  });
});
