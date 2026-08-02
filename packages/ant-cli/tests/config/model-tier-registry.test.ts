/**
 * Model tier registry invariants.
 *
 * `ModelSpec.tier` is the code-owned half of model selection: it names one
 * provider's model family above version, and `(provider, tier)` is what an
 * operator binds a job/node default to. This file locks the properties that make
 * that addressable — every model reachable, no collisions, no provider silently
 * absent. A provider missing its tiers is exactly the defect these rows exist to
 * catch: it makes whole families unbindable with no compile error.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_MODELS, MODEL_REGISTRY, PROVIDER_API_KEY_ENV, type ModelProvider } from '@ant/shared';

const ALL_PROVIDERS = Object.keys(PROVIDER_API_KEY_ENV) as ModelProvider[];

describe('MODEL_REGISTRY tiers', () => {
  it('every model declares a non-empty tier', () => {
    for (const [id, spec] of Object.entries(MODEL_REGISTRY)) {
      expect(spec.tier, `model "${id}" has no tier`).toBeTruthy();
      expect(spec.tier.trim(), `model "${id}" tier is blank`).toBe(spec.tier);
    }
  });

  it('a tier name never contains the ":" the binding syntax uses as a separator', () => {
    // `"<provider>:<tier>"` is parsed by splitting on ':' — a colon inside either
    // half would make the ref ambiguous.
    for (const [id, spec] of Object.entries(MODEL_REGISTRY)) {
      expect(spec.tier, `model "${id}"`).not.toContain(':');
      expect(spec.provider, `model "${id}"`).not.toContain(':');
    }
  });

  it('(provider, tier) is unique — no model shadows another', () => {
    const seen = new Map<string, string>();
    for (const [id, spec] of Object.entries(MODEL_REGISTRY)) {
      const key = `${spec.provider}:${spec.tier}`;
      const prev = seen.get(key);
      expect(prev, `"${key}" claimed by both ${prev} and ${id}`).toBeUndefined();
      seen.set(key, id);
    }
  });

  it('every registry model is reachable through DEFAULT_MODELS', () => {
    for (const [id, spec] of Object.entries(MODEL_REGISTRY)) {
      expect(DEFAULT_MODELS[spec.provider]?.[spec.tier], `unreachable: ${id}`).toBe(id);
    }
  });

  it('DEFAULT_MODELS introduces no id that is not in the registry', () => {
    for (const byTier of Object.values(DEFAULT_MODELS)) {
      for (const id of Object.values(byTier)) {
        expect(MODEL_REGISTRY[id], `DEFAULT_MODELS points at unknown id "${id}"`).toBeDefined();
      }
    }
  });

  it('every declared provider has at least one tier', () => {
    // The regression this file was written for: a provider present in
    // ModelProvider / PROVIDER_API_KEY_ENV but absent from the tier map, so none
    // of its models can be bound by env.
    for (const provider of ALL_PROVIDERS) {
      const tiers = Object.keys(DEFAULT_MODELS[provider] ?? {});
      expect(tiers.length, `provider "${provider}" declares no tier`).toBeGreaterThan(0);
    }
  });

  it('image-generation models are tier-addressable (visual sketch/render bind to them)', () => {
    const imageModels = Object.values(MODEL_REGISTRY).filter((m) =>
      m.capabilities?.includes('image-generation'),
    );
    expect(imageModels.length).toBeGreaterThan(0);
    for (const spec of imageModels) {
      expect(DEFAULT_MODELS[spec.provider]?.[spec.tier]).toBe(spec.id);
    }
  });
});
