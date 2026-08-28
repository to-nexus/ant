/**
 * `shared/utils/actor-utils` — `resolveLLMInfoFromConfig` unit tests.
 *
 * Covers spec T6 cases (a)–(f): the FE config-fallback helper that resolves
 * the LLM actor node's displayed model from workspace config when the SSE
 * `realtimeState.llmInfo` is absent (pre-start / stale state). The helper
 * mirrors BE `resolveModelForContext` priority (per-node override → job
 * default → hardcoded fallback) and BE `detectProviderFromModel` prefix
 * heuristics.
 *
 * Runner: vitest.
 */

import { describe, it, expect } from 'vitest';
import { resolveLLMInfoFromConfig } from '@/shared/utils/actor-utils';
import { DEFAULT_MODELS } from '@ant/shared';
import type { ProjectConfig } from '@/infrastructure/http/api/config';

/** Build a ProjectConfig fixture with a `universal` job config. */
function makeConfig(llmModels?: ProjectConfig['llmModels']): ProjectConfig {
  return {
    repositoryName: 'test',
    llmModels,
  };
}

describe('resolveLLMInfoFromConfig', () => {
  describe('(a) per-node override present', () => {
    it('resolves the per-node model when nodeType is set and configured', () => {
      const config = makeConfig({
        universal: { default: 'gpt-5', agent: 'claude-opus-5' },
      });
      const result = resolveLLMInfoFromConfig(config, 'universal', 'agent');
      expect(result).toEqual({ provider: 'anthropic', model: 'claude-opus-5' });
    });
  });

  describe('(b) job default only', () => {
    it('falls back to job default when nodeType is undefined', () => {
      const config = makeConfig({
        universal: { default: 'gpt-5' },
      });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'openai', model: 'gpt-5' });
    });

    it('falls back to job default when nodeType is set but not configured', () => {
      const config = makeConfig({
        universal: { default: 'gpt-5' },
      });
      const result = resolveLLMInfoFromConfig(config, 'universal', 'agent');
      expect(result).toEqual({ provider: 'openai', model: 'gpt-5' });
    });
  });

  describe('(c) no config', () => {
    it('returns null when config is null', () => {
      const result = resolveLLMInfoFromConfig(null, 'universal', 'agent');
      expect(result).toBeNull();
    });

    it('returns null when config is undefined', () => {
      const result = resolveLLMInfoFromConfig(undefined, 'universal', 'agent');
      expect(result).toBeNull();
    });
  });

  describe('(d) no llmModels', () => {
    it('returns null when llmModels is absent', () => {
      const config: ProjectConfig = { repositoryName: 'x' };
      const result = resolveLLMInfoFromConfig(config, 'universal', 'agent');
      expect(result).toBeNull();
    });
  });

  describe('(e) provider detection', () => {
    it('detects google for gemini-* models', () => {
      const config = makeConfig({ universal: { default: 'gemini-2.5-pro' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'google', model: 'gemini-2.5-pro' });
    });

    it('detects deepseek for deepseek-* models', () => {
      const config = makeConfig({ universal: { default: 'deepseek-v3' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'deepseek', model: 'deepseek-v3' });
    });

    it('detects glm for glm-* models', () => {
      const config = makeConfig({ universal: { default: 'glm-5.2' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'glm', model: 'glm-5.2' });
    });

    it('detects kimi for kimi-* models', () => {
      const config = makeConfig({ universal: { default: 'kimi-k3' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'kimi', model: 'kimi-k3' });
    });

    it('detects anthropic for claude-* models', () => {
      const config = makeConfig({ universal: { default: 'claude-opus-5' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'anthropic', model: 'claude-opus-5' });
    });

    it('detects openai for gpt-* models', () => {
      const config = makeConfig({ universal: { default: 'gpt-5' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'openai', model: 'gpt-5' });
    });

    it('detects openai for o1-* models', () => {
      const config = makeConfig({ universal: { default: 'o1-preview' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'openai', model: 'o1-preview' });
    });

    it('detects openai for o3-* models', () => {
      const config = makeConfig({ universal: { default: 'o3-mini' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'openai', model: 'o3-mini' });
    });

    it('defaults to anthropic for unknown model prefixes', () => {
      const config = makeConfig({ universal: { default: 'unknown-model' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({ provider: 'anthropic', model: 'unknown-model' });
    });
  });

  describe('(f) fallback to DEFAULT_MODELS', () => {
    it('falls back to DEFAULT_MODELS.anthropic.sonnet when job config is an empty object', () => {
      const config = makeConfig({ universal: {} });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({
        provider: 'anthropic',
        model: DEFAULT_MODELS.anthropic.sonnet,
      });
    });

    it('falls back to DEFAULT_MODELS.anthropic.sonnet when nodeType and default are both absent', () => {
      const config = makeConfig({ universal: { agent: 'claude-opus-5' } });
      const result = resolveLLMInfoFromConfig(config, 'universal', undefined);
      expect(result).toEqual({
        provider: 'anthropic',
        model: DEFAULT_MODELS.anthropic.sonnet,
      });
    });
  });

  describe('job config absence', () => {
    it('returns null when the requested jobType has no config', () => {
      const config = makeConfig({ universal: { default: 'gpt-5' } });
      const result = resolveLLMInfoFromConfig(config, 'code', 'execute');
      expect(result).toBeNull();
    });
  });
});
