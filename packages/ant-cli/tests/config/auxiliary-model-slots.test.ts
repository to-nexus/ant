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
import { getConfigMergeDefaults, getDefaultWorkspaceConfig } from '../../src/core/types/workspace';
import { getDefaultLlmModels, envVarForSlot, listBindingEnvVars } from '../../src/core/config/defaultModels';
import type { LLMContext } from '../../src/periphery/adapters/llm/LLMClientFactory';

describe('auxiliary model slots', () => {
  it('every auxiliary key has a BE job-level default', () => {
    const defaults = getConfigMergeDefaults();
    for (const key of AUXILIARY_MODEL_KEYS) {
      expect(defaults[key]?.default, `missing default for aux key "${key}"`).toBeTruthy();
    }
  });

  it('every auxiliary key is in the binding table every default surface derives from', () => {
    // The `commit` chip rendered blank because the creation snapshot, the config
    // heal map and the FE seed each carried their own copy of the default table
    // and only two of five had this key. They now all derive from
    // `getDefaultLlmModels()`, so covering it here covers all of them.
    const full = getDefaultLlmModels();
    for (const key of AUXILIARY_MODEL_KEYS) {
      expect(full[key]?.default, `missing from binding table: "${key}"`).toBeTruthy();
      expect(getDefaultWorkspaceConfig('p').llmModels?.[key]?.default).toBe(full[key]!.default);
    }
  });

  it('every auxiliary key is bindable by env like any job slot', () => {
    for (const key of AUXILIARY_MODEL_KEYS) {
      expect(listBindingEnvVars()).toContain(envVarForSlot(key, 'default'));
    }
  });

  it('the commit aux slot defaults to the Sonnet tier', () => {
    expect(getConfigMergeDefaults().commit?.default).toBe(DEFAULT_MODELS.anthropic.sonnet);
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
