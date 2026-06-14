/**
 * Locks the `platform` band (L1) — the scheduling tier between `foundation`
 * (pure contracts) and ordinary feature work (consumers), for shared runtime
 * services a producer-closure depends on.
 *
 * Covers:
 *   1. deriveBandFromPriority — the single priority→band SSOT, a STRICT reverse
 *      lookup over the `TASK_PRIORITY` window map. design-system [200,219] and
 *      feature.foundation [220,259] are DISTINCT windows: only [220,259]
 *      derives 'foundation' (design-system is a TYPE, never band-derived).
 *   2. entry-point-ownership-rule + checklist — the band-gated ownership
 *      branches (platform owns producer; integration mounts only; consumer
 *      must not hand-construct a shared value).
 */

import { describe, it, expect } from 'vitest';
import { deriveBandFromPriority } from '../../src/agents/architect/graph/code/nodes/decompose/responseParser';
import { TASK_PRIORITY, windowFor } from '../../src/agents/architect/graph/code/state';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import type { SetupTask, FeatureTask } from '@ant/shared';

describe('band discriminated-union compile guard (setup=root only, feature=feature bands only)', () => {
  it('per-variant band constraint holds at the type level', () => {
    const common = { name: 'n', description: 'd' };
    const rootSetup: SetupTask = { id: 's', priority: 100, type: 'setup', band: 'root', ...common };
    const pkgSetup: SetupTask = { id: 's2', priority: 101, type: 'setup', ...common }; // band-absent
    const foundationFeat: FeatureTask = { id: 'f', priority: 200, type: 'feature', band: 'foundation', ...common };
    // @ts-expect-error setup tasks may only carry band:'root', never a feature band
    const badSetup: SetupTask = { id: 'b', priority: 100, type: 'setup', band: 'foundation', ...common };
    // @ts-expect-error feature tasks may not carry the setup 'root' band
    const badFeat: FeatureTask = { id: 'b2', priority: 300, type: 'feature', band: 'root', ...common };
    expect([rootSetup, pkgSetup, foundationFeat, badSetup, badFeat]).toHaveLength(5);
  });
});

describe('platform band — deriveBandFromPriority (priority→band SSOT, STRICT)', () => {
  it('design-system [200,219] is NOT a feature band → undefined; feature.foundation [220,259] → foundation', () => {
    // design-system is a TYPE (band derivation never runs for it); a stray
    // FEATURE priority inside its window degrades to undefined (ordinary).
    expect(deriveBandFromPriority(200)).toBeUndefined();
    expect(deriveBandFromPriority(219)).toBeUndefined();
    expect(deriveBandFromPriority(220)).toBe('foundation');
    expect(deriveBandFromPriority(259)).toBe('foundation');
  });

  it('maps [260,299] → platform', () => {
    expect(deriveBandFromPriority(260)).toBe('platform');
    expect(deriveBandFromPriority(windowFor('feature', 'platform').min)).toBe('platform');
    expect(deriveBandFromPriority(290)).toBe('platform');
    expect(deriveBandFromPriority(windowFor('feature', 'platform').max)).toBe('platform');
  });

  it('keeps feature / integration windows', () => {
    expect(deriveBandFromPriority(300)).toBeUndefined(); // ordinary feature (consumer)
    expect(deriveBandFromPriority(599)).toBeUndefined();
    expect(deriveBandFromPriority(600)).toBe('integration');
    expect(deriveBandFromPriority(649)).toBe('integration');
  });

  it("maps setup.root(100) → 'root' (unique workspace-level setup); package setups 101+ → undefined", () => {
    expect(deriveBandFromPriority(windowFor('setup', 'root').min)).toBe('root');
    expect(deriveBandFromPriority(100)).toBe('root');
    // Band-absent (package/member) setups occupy 101..setup.default.max — no band.
    expect(deriveBandFromPriority(101)).toBeUndefined();
    expect(deriveBandFromPriority(150)).toBeUndefined();
    expect(deriveBandFromPriority(windowFor('setup').max)).toBeUndefined();
    // 'root' is strictly the lowest priority → ahead of every band-absent setup.
    expect(windowFor('setup', 'root').min).toBeLessThan(windowFor('setup').min);
  });

  it('design-system and feature.foundation are distinct, adjacent windows', () => {
    expect(windowFor('design-system')).toEqual({ min: 200, max: 219 });
    expect(windowFor('feature', 'foundation')).toEqual({ min: 220, max: 259 });
    expect(windowFor('feature', 'platform')).toEqual({ min: 260, max: 299 });
    expect(windowFor('feature', 'integration')).toEqual({ min: 600, max: 649 });
    // distinct: design-system ceiling sits just below the foundation band floor.
    expect(TASK_PRIORITY['design-system'].default.max).toBeLessThan(
      TASK_PRIORITY.feature.foundation.min,
    );
  });
});

describe('platform band — entry-point-ownership-rule branches', () => {
  const adapter = new FilePromptAdapter();
  const RULE = 'jobs/code/base/injections/entry-point-ownership-rule';
  const CHECK = 'jobs/code/base/injections/entry-point-ownership-checklist';

  it('platform branch: owns the shared runtime service (contract + producer)', async () => {
    const out = await adapter.render(RULE, { taskBand: 'platform' });
    expect(out).toMatch(/`platform` band task/);
    expect(out).toMatch(/access contract.*AND its.*implementation/i);
    expect(out).toMatch(/do NOT also own host entries/i);
  });

  it('integration branch: mounts platform services, does not author them', async () => {
    const out = await adapter.render(RULE, { taskBand: 'integration' });
    expect(out).toMatch(/Mount\/register the shared runtime services produced by `platform`/);
  });

  it('foundation branch: pure contracts only, runtime services belong to platform', async () => {
    const out = await adapter.render(RULE, { taskBand: 'foundation' });
    expect(out).toMatch(/pure contracts/);
    expect(out).toMatch(/belong to a `platform` band task/);
  });

  it('consumer branch (no band): no-stub producer-closure constraint', async () => {
    const out = await adapter.render(RULE, {}); // taskBand undefined → consumer
    expect(out).toMatch(/CONSUMES a shared runtime value/);
    expect(out).toMatch(/Do NOT satisfy the type by constructing the shared value locally with empty or placeholder fields/);
  });

  it('checklist sibling stays in sync (platform + consumer lines present)', async () => {
    const platform = await adapter.render(CHECK, { taskBand: 'platform' });
    expect(platform).toMatch(/define its access contract AND its producer/);
    const consumer = await adapter.render(CHECK, {});
    expect(consumer).toMatch(/never hand-construct it with empty\/placeholder fields/);
  });
});
