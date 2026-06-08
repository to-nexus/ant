/**
 * Backend frontend-leakage gate regression guard.
 *
 * The shared `default` execute variant (rules.md + base.md) is the sole
 * code-writing template for backend `feature` / `setup` tasks (they have no
 * dedicated variant). Three frontend-specific blocks used to render
 * unconditionally on backend prompts:
 *
 *   - rules.md `### 3. Design Tokens Integration`
 *   - base.md  `### 4. ASSET-FIRST FOR UI`
 *   - base.md  PATH CONVENTION asset source/destination (SVGR / public/)
 *
 * They are now gated behind `{{#if hasFrontend}}`. `backend-safety.md` also
 * dropped its frontend-framework (COOP/COEP) caveat.
 *
 * This guard locks (2 layers — see plan Part E matrix):
 *   1. flag layer  — `computeStackFlags` truth table (fail-open is a *value*
 *                    of `true`, so the template shows the block for FE / unknown)
 *   2. template layer — render the default variant with hasFrontend true/false
 *                    and assert the frontend blocks appear/disappear WHILE the
 *                    backend-critical blocks (ENV SYNC / LAYER-AWARE) survive
 *                    in BOTH cases (over-gating guard).
 *   3. backend-safety trim — COOP caveat gone, backend statement kept.
 *
 * Proof of no legitimate-FE omission: a FE task always resolves to
 * stack ∈ {frontend, omitted→size 0, fullstack} ⇒ hasFrontend=true ⇒ blocks
 * shown. hasFrontend=false only when stacks={backend} = by definition backend.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import type { TechTier } from '@ant/shared';
import { AutoInjectionResolver } from '../../src/core/prompt/builder/AutoInjectionResolver';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const REPO_ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_ROOT = path.join(REPO_ROOT, 'src/core/prompt/templates');

const EXECUTE_RULES = 'jobs/code/nodes/execute/variants/default/rules';
const EXECUTE_BASE = 'jobs/code/nodes/execute/variants/default/base';
const BACKEND_SAFETY = 'jobs/code/nodes/execute/injections/backend-safety';

// Sentinels — appear ONLY in their respective gated/ungated block.
const SENTINEL_TOKENS = 'Design Tokens Integration';
const SENTINEL_ASSET = 'ASSET-FIRST FOR UI';
const SENTINEL_SVGR = 'required for SVGR import';
const SENTINEL_ENV = 'ENV FILE SYNC CONTRACT'; // backend-critical — must survive
const SENTINEL_LAYER = 'LAYER-AWARE FIX'; // always-on core principle — must survive
const SENTINEL_COOP = 'Cross-Origin-Opener-Policy'; // removed frontend caveat
const SENTINEL_BE_HARDENING = 'custom backend server'; // retained backend statement

const tier = (stack?: 'frontend' | 'backend' | 'fullstack'): TechTier => ({ stack } as TechTier);

// =============================================================================
// 1. flag layer — computeStackFlags truth table (the VALUE the template sees)
// =============================================================================

describe('computeStackFlags — backend/frontend truth table', () => {
  it('no tier resolved ({}) → hasFrontend true (fail-open), hasBackend false', () => {
    expect(AutoInjectionResolver.computeStackFlags([])).toEqual({ hasFrontend: true, hasBackend: false });
  });

  it('{frontend} → hasFrontend true', () => {
    expect(AutoInjectionResolver.computeStackFlags([tier('frontend')])).toEqual({
      hasFrontend: true,
      hasBackend: false,
    });
  });

  it('{backend} → hasFrontend FALSE (the only block-hiding case)', () => {
    expect(AutoInjectionResolver.computeStackFlags([tier('backend')])).toEqual({
      hasFrontend: false,
      hasBackend: true,
    });
  });

  it('{fullstack} → both true', () => {
    expect(AutoInjectionResolver.computeStackFlags([tier('fullstack')])).toEqual({
      hasFrontend: true,
      hasBackend: true,
    });
  });
});

// =============================================================================
// 2. template layer — render gate drives frontend-block presence
// =============================================================================

describe('execute default variant — hasFrontend gate render', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_ROOT);
    adapter = new FilePromptAdapter(TEMPLATES_ROOT);
  });

  it('rules.md hasFrontend=true → Design Tokens block present', async () => {
    const out = await adapter.render(EXECUTE_RULES, { hasFrontend: true });
    expect(out).toContain(SENTINEL_TOKENS);
  });

  it('rules.md hasFrontend=false → Design Tokens block absent, backend-critical survives', async () => {
    const out = await adapter.render(EXECUTE_RULES, { hasFrontend: false });
    expect(out).not.toContain(SENTINEL_TOKENS);
  });

  it('base.md hasFrontend=true → ASSET-FIRST + SVGR path present', async () => {
    const out = await adapter.render(EXECUTE_BASE, { hasFrontend: true });
    expect(out).toContain(SENTINEL_ASSET);
    expect(out).toContain(SENTINEL_SVGR);
  });

  it('base.md hasFrontend=false → ASSET-FIRST + SVGR path absent', async () => {
    const out = await adapter.render(EXECUTE_BASE, { hasFrontend: false });
    expect(out).not.toContain(SENTINEL_ASSET);
    expect(out).not.toContain(SENTINEL_SVGR);
  });

  // Over-gating guard: backend-critical content MUST remain in BOTH cases.
  for (const hasFrontend of [true, false]) {
    it(`base.md hasFrontend=${hasFrontend} → ENV SYNC + LAYER-AWARE survive (no over-gating)`, async () => {
      const out = await adapter.render(EXECUTE_BASE, { hasFrontend });
      expect(out).toContain(SENTINEL_ENV);
      expect(out).toContain(SENTINEL_LAYER);
    });
  }
});

// =============================================================================
// 3. backend-safety trim — frontend caveat removed, backend statement kept
// =============================================================================

describe('backend-safety — frontend caveat trimmed', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_ROOT);
    adapter = new FilePromptAdapter(TEMPLATES_ROOT);
  });

  it('frontend-framework COOP/COEP caveat is gone', async () => {
    const out = await adapter.render(BACKEND_SAFETY, {});
    expect(out).not.toContain(SENTINEL_COOP);
  });

  it('backend Response-Hardening statement is retained', async () => {
    const out = await adapter.render(BACKEND_SAFETY, {});
    expect(out).toContain(SENTINEL_BE_HARDENING);
  });
});
