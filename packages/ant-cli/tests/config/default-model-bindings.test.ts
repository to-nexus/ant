/**
 * Job/node default → tier binding, and its env override layer.
 *
 * Two axes deliberately kept apart (see `core/config/defaultModels.ts`):
 *   - tier → concrete id  : code-owned (MODEL_REGISTRY), NOT env-configurable
 *   - job/node → tier     : env-overridable per slot, `ANT_DEFAULT_MODEL_<JOB>[_<NODE>]`
 *
 * These rows lock the second axis: that a binding resolves, and that a bad value is
 * ignored loudly rather than substituted silently.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_MODELS, MODEL_REGISTRY } from '@ant/shared';
import {
  envVarForSlot,
  FALLBACK_ENV_VAR,
  getDefaultJobModels,
  getDefaultLlmModels,
  getFallbackModel,
  listBindingEnvVars,
  listDefaultBindings,
} from '../../src/core/config/defaultModels';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Silence + capture the warn channel these rejections report through. */
function captureWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

describe('env var naming', () => {
  it.each([
    ['code', 'default', 'ANT_DEFAULT_MODEL_CODE'],
    ['code', 'decompose', 'ANT_DEFAULT_MODEL_CODE_DECOMPOSE'],
    ['commit', 'default', 'ANT_DEFAULT_MODEL_COMMIT'],
    ['visual', 'flashImageSlotDoesNotExist', 'ANT_DEFAULT_MODEL_VISUAL_FLASH_IMAGE_SLOT_DOES_NOT_EXIST'],
  ] as const)('%s.%s → %s', (job, node, expected) => {
    expect(envVarForSlot(job as any, node as any)).toBe(expected);
  });

  it('every binding slot has a unique env var', () => {
    const vars = listBindingEnvVars();
    expect(new Set(vars).size).toBe(vars.length);
  });
});

describe('built-in bindings', () => {
  it('every built-in binding resolves to a registered model', () => {
    for (const { job, node, ref } of listDefaultBindings()) {
      const [provider, tier] = ref.split(':');
      const id = DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS]?.[tier];
      expect(id, `${job}.${node} → "${ref}" does not resolve`).toBeDefined();
      expect(MODEL_REGISTRY[id!]).toBeDefined();
    }
  });

  it('image-generation slots bind to image models', () => {
    const models = getDefaultLlmModels();
    for (const node of ['sketch', 'render'] as const) {
      const id = (models.visual as Record<string, string>)[node];
      expect(MODEL_REGISTRY[id]?.capabilities, `visual.${node} → ${id}`).toContain('image-generation');
    }
  });

  it('the commit aux slot has a default — the gap this whole change closed', () => {
    expect(getDefaultLlmModels().commit?.default).toBe(DEFAULT_MODELS.anthropic.sonnet);
    expect(getDefaultJobModels().commit?.default).toBe(DEFAULT_MODELS.anthropic.sonnet);
  });

  it('the job-level merge base carries no node overrides', () => {
    // Guards the derivation that replaced a hand-copied merge base: a user who
    // customized only `job.default` must fall through to it for every node.
    for (const [job, cfg] of Object.entries(getDefaultJobModels())) {
      expect(Object.keys(cfg!), `job "${job}"`).toEqual(['default']);
    }
  });

  it('the full table keeps the node overrides the merge base drops', () => {
    const full = getDefaultLlmModels();
    expect(full.code?.decompose).toBe(DEFAULT_MODELS.anthropic.opus);
    expect(full.plan?.plan).toBe(DEFAULT_MODELS.anthropic.opus);
    expect(full.visual?.explain).toBeDefined();
  });
});

describe('per-slot env override', () => {
  it('rebinds one node without touching its siblings', () => {
    vi.stubEnv('ANT_DEFAULT_MODEL_CODE_DECOMPOSE', 'glm:flagship');
    const models = getDefaultLlmModels();
    expect(models.code?.decompose).toBe(DEFAULT_MODELS.glm.flagship);
    expect(models.code?.default).toBe(DEFAULT_MODELS.anthropic.sonnet);
    expect(models.design?.decompose).toBe(DEFAULT_MODELS.anthropic.sonnet);
  });

  it('rebinds a whole job across providers — the point of the binding axis', () => {
    vi.stubEnv('ANT_DEFAULT_MODEL_CODE', 'kimi:code');
    expect(getDefaultLlmModels().code?.default).toBe(DEFAULT_MODELS.kimi.code);
  });

  it('rebinds the commit aux slot', () => {
    vi.stubEnv('ANT_DEFAULT_MODEL_COMMIT', 'anthropic:haiku');
    expect(getDefaultLlmModels().commit?.default).toBe(DEFAULT_MODELS.anthropic.haiku);
  });

  it.each([
    ['claude-opus-5', 'a concrete id instead of provider:tier'],
    ['anthropic', 'a bare provider'],
    ['nosuchprovider:opus', 'an unknown provider'],
    ['anthropic:nosuchtier', 'an unknown tier'],
    ['anthropic:opus:extra', 'a trailing segment'],
  ])('ignores %s (%s) and warns', (value) => {
    const warn = captureWarn();
    vi.stubEnv('ANT_DEFAULT_MODEL_CODE', value);
    expect(getDefaultLlmModels().code?.default).toBe(DEFAULT_MODELS.anthropic.sonnet);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('ANT_DEFAULT_MODEL_CODE');
  });

  it('rejects a text model on an image slot — it would fail far away, at render time', () => {
    const warn = captureWarn();
    vi.stubEnv('ANT_DEFAULT_MODEL_VISUAL_RENDER', 'anthropic:sonnet');
    expect(getDefaultLlmModels().visual?.render).toBe(DEFAULT_MODELS.google.proImage);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('image-generation');
  });

  it('accepts a different image model on an image slot', () => {
    vi.stubEnv('ANT_DEFAULT_MODEL_VISUAL_RENDER', 'google:flashImage');
    expect(getDefaultLlmModels().visual?.render).toBe(DEFAULT_MODELS.google.flashImage);
  });
});

describe('global fallback slot', () => {
  it('defaults to the opus tier', () => {
    expect(getFallbackModel()).toBe(DEFAULT_MODELS.anthropic.opus);
  });

  it('is env-rebindable', () => {
    vi.stubEnv(FALLBACK_ENV_VAR, 'deepseek:pro');
    expect(getFallbackModel()).toBe(DEFAULT_MODELS.deepseek.pro);
  });

  it('ignores an invalid value with a warn', () => {
    const warn = captureWarn();
    vi.stubEnv(FALLBACK_ENV_VAR, 'bogus');
    expect(getFallbackModel()).toBe(DEFAULT_MODELS.anthropic.opus);
    expect(warn).toHaveBeenCalled();
  });
});
