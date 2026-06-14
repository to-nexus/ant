/**
 * Locks the `platform` band (L1) — the scheduling tier between `foundation`
 * (pure contracts) and ordinary feature work (consumers), for shared runtime
 * services a producer-closure depends on.
 *
 * Covers:
 *   1. deriveBandFromPriority — the single priority→band SSOT. Platform is a
 *      sub-range [280,299] carved from the top of the foundation window;
 *      [200,279] stays foundation, FOUNDATION_MAX (299) is untouched so the
 *      orthogonal design-job `doc` classifier is unaffected.
 *   2. entry-point-ownership-rule + checklist — the band-gated ownership
 *      branches (platform owns producer; integration mounts only; consumer
 *      must not hand-construct a shared value).
 */

import { describe, it, expect } from 'vitest';
import { deriveBandFromPriority } from '../../src/agents/architect/graph/code/nodes/decompose/responseParser';
import { TASK_PRIORITIES } from '../../src/agents/architect/graph/code/state';
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

describe('platform band — deriveBandFromPriority (priority→band SSOT)', () => {
  it('maps [200,259] → foundation, [260,299] → platform', () => {
    // (design-system TYPE lives at 200-219 by decompose guidance, but it is not
    // a feature so deriveBandFromPriority is never invoked for it; a FEATURE at
    // 200-259 derives 'foundation'.)
    expect(deriveBandFromPriority(200)).toBe('foundation');
    expect(deriveBandFromPriority(220)).toBe('foundation'); // infra-adapters, shared types
    expect(deriveBandFromPriority(259)).toBe('foundation');
    expect(deriveBandFromPriority(260)).toBe('platform');
    expect(deriveBandFromPriority(TASK_PRIORITIES.PLATFORM_MIN)).toBe('platform');
    expect(deriveBandFromPriority(290)).toBe('platform');
    expect(deriveBandFromPriority(TASK_PRIORITIES.PLATFORM_MAX)).toBe('platform');
  });

  it('keeps feature / integration windows unchanged', () => {
    expect(deriveBandFromPriority(300)).toBeUndefined(); // ordinary feature (consumer)
    expect(deriveBandFromPriority(599)).toBeUndefined();
    expect(deriveBandFromPriority(600)).toBe('integration');
    expect(deriveBandFromPriority(649)).toBe('integration');
  });

  it("maps SETUP_PROJECT(100) → 'root' (unique workspace-level setup); package setups 101+ → undefined", () => {
    // The root setup is the lowest priority in the queue and dequeues first.
    expect(deriveBandFromPriority(TASK_PRIORITIES.SETUP_PROJECT)).toBe('root');
    expect(deriveBandFromPriority(100)).toBe('root');
    // Band-absent (package/member) setups occupy 101..SETUP_MAX — no band.
    expect(deriveBandFromPriority(101)).toBeUndefined();
    expect(deriveBandFromPriority(150)).toBeUndefined();
    expect(deriveBandFromPriority(TASK_PRIORITIES.SETUP_MAX)).toBeUndefined();
    // 'root' is strictly the lowest priority → ahead of every band-absent setup.
    expect(TASK_PRIORITIES.SETUP_PROJECT).toBeLessThan(101);
  });

  it('FOUNDATION_MAX stays 299 (design-job doc classifier window untouched)', () => {
    // The platform sub-range is checked first in deriveBandFromPriority, so the
    // constant itself is unchanged — the design-job `doc` bundle still reads
    // [SHARED_FOUNDATION, FOUNDATION_MAX] = [200, 299].
    expect(TASK_PRIORITIES.FOUNDATION_MAX).toBe(299);
    expect(TASK_PRIORITIES.PLATFORM_MIN).toBe(260);
    expect(TASK_PRIORITIES.PLATFORM_MAX).toBe(299);
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
