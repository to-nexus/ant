/**
 * `shared/utils/actor-utils` — `getActorInfo` provider-label mapping and
 * `graphNodeIdToModelNodeKey` node-id mapping unit tests.
 *
 * Covers spec T6 / AC1·AC2:
 *  - AC1: `getActorInfo('llm', { provider, model })` maps all 6 provider tags
 *    (anthropic/google/openai/glm/deepseek/kimi) to their display labels via
 *    `PROVIDER_LABEL_MAP`, falls back to `'OpenAI'` for unknown tags, and
 *    passes the model id through verbatim.
 *  - AC2: `graphNodeIdToModelNodeKey(jobType, graphNodeId)` returns the id as
 *    a `ModelNodeKey` when it is a member of `OVERRIDABLE_MODEL_SLOTS[jobType]`,
 *    and falls back to `'default'` for non-overlapping ids and undefined.
 *
 * The sibling `resolveLLMInfoFromConfig.test.ts` (PRESERVED) covers the
 * config-fallback helper; this file covers the rendering label map and the
 * node-id mapping that the prior fix added.
 *
 * Runner: vitest.
 */

import { describe, it, expect } from 'vitest';
import { getActorInfo, graphNodeIdToModelNodeKey } from '@/shared/utils/actor-utils';

describe('getActorInfo — provider label mapping (AC1)', () => {
  describe('6 provider tags → display labels', () => {
    it('maps anthropic → Anthropic', () => {
      expect(getActorInfo('llm', { provider: 'anthropic', model: 'claude-opus-5' })?.provider).toBe('Anthropic');
    });

    it('maps google → Google', () => {
      expect(getActorInfo('llm', { provider: 'google', model: 'gemini-2.5-pro' })?.provider).toBe('Google');
    });

    it('maps openai → OpenAI', () => {
      expect(getActorInfo('llm', { provider: 'openai', model: 'gpt-5' })?.provider).toBe('OpenAI');
    });

    it('maps glm → GLM', () => {
      expect(getActorInfo('llm', { provider: 'glm', model: 'glm-5.2' })?.provider).toBe('GLM');
    });

    it('maps deepseek → DeepSeek', () => {
      expect(getActorInfo('llm', { provider: 'deepseek', model: 'deepseek-v3' })?.provider).toBe('DeepSeek');
    });

    it('maps kimi → Kimi', () => {
      expect(getActorInfo('llm', { provider: 'kimi', model: 'kimi-k3' })?.provider).toBe('Kimi');
    });
  });

  it('passes the model id through verbatim (no transformation)', () => {
    const info = getActorInfo('llm', { provider: 'glm', model: 'glm-5.2' });
    expect(info?.model).toBe('glm-5.2');
  });

  it('falls back to OpenAI for an unknown provider tag', () => {
    expect(getActorInfo('llm', { provider: 'unknown-provider', model: 'mystery-model' })?.provider).toBe('OpenAI');
  });
});

describe('graphNodeIdToModelNodeKey — node-id mapping (AC2)', () => {
  describe('overlapping ids (valid ModelNodeKey for the job)', () => {
    it("returns 'agent' for ('universal', 'agent')", () => {
      expect(graphNodeIdToModelNodeKey('universal', 'agent')).toBe('agent');
    });

    it("returns 'execute' for ('code', 'execute')", () => {
      expect(graphNodeIdToModelNodeKey('code', 'execute')).toBe('execute');
    });

    it("returns 'decompose' for ('design', 'decompose')", () => {
      expect(graphNodeIdToModelNodeKey('design', 'decompose')).toBe('decompose');
    });

    it("returns 'render' for ('visual', 'render')", () => {
      expect(graphNodeIdToModelNodeKey('visual', 'render')).toBe('render');
    });
  });

  describe('non-overlapping ids (not a ModelNodeKey for the job)', () => {
    it("returns 'default' for ('code', 'resolve')", () => {
      expect(graphNodeIdToModelNodeKey('code', 'resolve')).toBe('default');
    });

    it("returns 'default' for ('code', 'enforce')", () => {
      expect(graphNodeIdToModelNodeKey('code', 'enforce')).toBe('default');
    });

    it("returns 'default' for ('universal', 'writeFiles')", () => {
      expect(graphNodeIdToModelNodeKey('universal', 'writeFiles')).toBe('default');
    });
  });

  describe('undefined graph node id', () => {
    it("returns 'default' for ('universal', undefined)", () => {
      expect(graphNodeIdToModelNodeKey('universal', undefined)).toBe('default');
    });
  });
});
