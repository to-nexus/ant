/**
 * L1 — `VerificationSession` model invariants.
 *
 * Covers the primary API surface introduced in T3:
 *   - `createFresh` / `rehydrate` (construction & snapshot round-trip)
 *   - `evaluate` (every `VerificationOutcome.kind`)
 *   - Gate transitions: `onCommand`, `onFileChanged`, `onPlanEntry`
 *   - Plan history + repeated-plan detection
 *   - Deep-diagnostic mode + remaining budget
 *   - Batch-split cycle counter
 *
 * These tests lock the model contract BEFORE the hook layer (T5) and phase
 * rewiring (T6) start depending on it. The hook tests (`hooks.test.ts`,
 * T5) exercise the adapter surface; this file exercises the model alone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VerificationSession,
  MAX_VERIFICATION_ATTEMPTS,
  DEEP_DIAGNOSTIC_THRESHOLD,
} from '../../../src/agents/architect/graph/code/tasks/verification/model/Session';
import { EMPTY_SNAPSHOT } from '../../../src/agents/architect/graph/code/tasks/verification/model/snapshot';
import type { VerificationSnapshot } from '../../../src/agents/architect/graph/code/tasks/verification/model/snapshot';

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

function freshTs(): VerificationSession {
  return VerificationSession.createFresh({ isTs: true, hasTests: true });
}

function freshNoTsNoTest(): VerificationSession {
  return VerificationSession.createFresh({ isTs: false, hasTests: false });
}

/**
 * Build a JSON plan body with N modify entries plus optional batches. Used
 * to drive `evaluate()` outcomes and `isPlanRepeated` detection.
 */
function plan(opts: {
  modify?: number;
  batches?: number;
  totalErrors?: number;
  seed?: string;
}): string {
  const body: any = {
    implementation: {
      modify: Array.from({ length: opts.modify ?? 0 }, (_, i) => ({
        file: `src/file-${i}.ts`,
        action: 'edit',
      })),
      create: [],
      delete: [],
    },
    diagnostics: { totalErrors: opts.totalErrors ?? 0 },
  };
  if (opts.batches != null && opts.batches > 0) {
    body.batches = Array.from({ length: opts.batches }, (_, i) => ({
      name: `batch-${i}`,
      modify: [`src/file-${i}.ts`],
    }));
  }
  if (opts.seed) body._seed = opts.seed;
  return JSON.stringify(body);
}

// ────────────────────────────────────────────────────────────────────────────
// Construction
// ────────────────────────────────────────────────────────────────────────────

describe('VerificationSession.createFresh', () => {
  it('requires build always, typecheck when isTs, test when hasTests', () => {
    expect(freshTs().required()).toEqual(['typecheck', 'build', 'test']);
    expect(freshNoTsNoTest().required()).toEqual(['build']);
    expect(VerificationSession.createFresh({ isTs: true, hasTests: false }).required())
      .toEqual(['typecheck', 'build']);
    expect(VerificationSession.createFresh({ isTs: false, hasTests: true }).required())
      .toEqual(['build', 'test']);
  });

  it('starts with zero attempts, empty passed, empty history', () => {
    const s = freshTs();
    expect(s.attempts()).toBe(0);
    expect(s.passed()).toEqual([]);
    expect(s.planHistoryBodies()).toEqual([]);
    expect(s.batchSplitCount()).toBe(0);
    expect(s.remainingBudget()).toBe(MAX_VERIFICATION_ATTEMPTS);
  });

  it('reports not complete when required gates are outstanding', () => {
    expect(freshTs().isComplete()).toBe(false);
  });
});

describe('VerificationSession.rehydrate', () => {
  it('restores from snapshot round-trip', () => {
    const s = freshTs();
    s.onPlanEntry('retry');
    s.onCommand('typecheck', true);
    s.onPlanApplied(plan({ modify: 1, seed: 'a' }));
    const snap = s.snapshot();
    const restored = VerificationSession.rehydrate(snap);

    expect(restored.attempts()).toBe(1);
    expect(restored.passed()).toEqual(['typecheck']);
    expect(restored.planHistoryBodies().length).toBe(1);
    expect(restored.snapshot()).toEqual(snap);
  });

  it('tolerates null / undefined / EMPTY_SNAPSHOT', () => {
    const a = VerificationSession.rehydrate(null);
    const b = VerificationSession.rehydrate(undefined);
    const c = VerificationSession.rehydrate(EMPTY_SNAPSHOT);
    for (const s of [a, b, c]) {
      expect(s.attempts()).toBe(0);
      expect(s.required()).toEqual([]);
      expect(s.isComplete()).toBe(true); // vacuously — no required gates
    }
  });

  it('intersects passed with required (rehydrating a shrunk required set)', () => {
    const snap: VerificationSnapshot = {
      required: ['build'],
      passed: ['build', 'test'], // test no longer required after rehydrate
      attemptedThisCycle: [],
      attempts: 2,
      planHistoryHashes: [],
    };
    const s = VerificationSession.rehydrate(snap);
    expect(s.passed()).toEqual(['build']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Gate transitions
// ────────────────────────────────────────────────────────────────────────────

describe('gate mutations', () => {
  let s: VerificationSession;
  beforeEach(() => { s = freshTs(); });

  it('onCommand flips required gates on success, clears on failure', () => {
    s.onCommand('build', true);
    expect(s.passed()).toEqual(['build']);
    s.onCommand('build', false);
    expect(s.passed()).toEqual([]);
  });

  it('onCommand ignores non-required gates', () => {
    const plain = VerificationSession.createFresh({ isTs: false, hasTests: false });
    plain.onCommand('typecheck', true); // not required
    expect(plain.passed()).toEqual([]);
  });

  it('onCommand ignores undefined gate (command not recognised)', () => {
    s.onCommand(undefined, true);
    expect(s.passed()).toEqual([]);
  });

  it('onFileChanged scope=all clears every passed gate', () => {
    s.onCommand('typecheck', true);
    s.onCommand('build', true);
    s.onFileChanged('all');
    expect(s.passed()).toEqual([]);
  });

  it('onFileChanged targeted scope only clears the named gate', () => {
    s.onCommand('typecheck', true);
    s.onCommand('build', true);
    s.onFileChanged('test');
    expect(s.passed()).toEqual(['typecheck', 'build']);
    s.onFileChanged('build');
    expect(s.passed()).toEqual(['typecheck']);
  });

  it('onFileChanged installNeeded flips the install flag', () => {
    expect(s.installNeeded()).toBe(false);
    s.onFileChanged('all', true);
    expect(s.installNeeded()).toBe(true);
    s.onFileChanged('build', false);
    expect(s.installNeeded()).toBe(false);
  });

  it('isComplete() turns true only when all required gates pass', () => {
    s.onCommand('typecheck', true);
    s.onCommand('build', true);
    expect(s.isComplete()).toBe(false);
    s.onCommand('test', true);
    expect(s.isComplete()).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// onPlanEntry / attempts counter / deep mode
// ────────────────────────────────────────────────────────────────────────────

describe('onPlanEntry', () => {
  it('retry/reverify bump attempts; fresh/resumed/toolLoop do not', () => {
    const s = freshTs();
    s.onPlanEntry('fresh');
    s.onPlanEntry('resumed');
    s.onPlanEntry('toolLoop');
    expect(s.attempts()).toBe(0);
    s.onPlanEntry('retry');
    expect(s.attempts()).toBe(1);
    s.onPlanEntry('reverify');
    expect(s.attempts()).toBe(2);
  });

  it('retry/reverify do NOT clear passed gates, only the attempted-this-cycle set', () => {
    const s = freshTs();
    s.onCommand('typecheck', true);
    s.onPlanEntry('retry');
    expect(s.passed()).toEqual(['typecheck']);
  });

  it('inDeepMode flips at DEEP_DIAGNOSTIC_THRESHOLD', () => {
    const s = freshTs();
    expect(s.inDeepMode()).toBe(false);
    for (let i = 0; i < DEEP_DIAGNOSTIC_THRESHOLD; i++) s.onPlanEntry('retry');
    expect(s.inDeepMode()).toBe(true);
  });

  it('remainingBudget counts down monotonically to zero', () => {
    const s = freshTs();
    const start = s.remainingBudget();
    s.onPlanEntry('retry');
    expect(s.remainingBudget()).toBe(start - 1);
    for (let i = 0; i < MAX_VERIFICATION_ATTEMPTS * 2; i++) s.onPlanEntry('retry');
    expect(s.remainingBudget()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Plan history + repeated plan detection
// ────────────────────────────────────────────────────────────────────────────

describe('plan history', () => {
  it('onPlanApplied appends body (bounded) + hash (unbounded)', () => {
    const s = freshTs();
    for (let i = 0; i < 5; i++) s.onPlanApplied(plan({ modify: 1, seed: `s${i}` }));
    expect(s.planHistoryBodies().length).toBe(3); // bounded
    expect(s.snapshot().planHistoryHashes.length).toBe(5);
  });

  it('isPlanRepeated returns false for brand-new plan', () => {
    const s = freshTs();
    s.onPlanApplied(plan({ modify: 1, seed: 'a' }));
    expect(s.isPlanRepeated(plan({ modify: 1, seed: 'b' })).repeated).toBe(false);
  });

  it('isPlanRepeated counts trailing identical hashes', () => {
    const s = freshTs();
    const p = plan({ modify: 1, seed: 'same' });
    s.onPlanApplied(p);
    expect(s.isPlanRepeated(p)).toEqual({ repeated: true, count: 1 });
    s.onPlanApplied(p);
    expect(s.isPlanRepeated(p)).toEqual({ repeated: true, count: 2 });
  });

  it('isPlanRepeated is whitespace/formatting insensitive', () => {
    const s = freshTs();
    s.onPlanApplied('{"implementation":{"modify":[{"file":"a.ts"}]}}');
    expect(
      s.isPlanRepeated(
        '```json\n{\n  "implementation": {\n    "modify": [\n      {"file": "a.ts"}\n    ]\n  }\n}\n```',
      ),
    ).toEqual({ repeated: true, count: 1 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// evaluate — every outcome branch
// ────────────────────────────────────────────────────────────────────────────

describe('evaluate', () => {
  it('short_circuit: already_complete when all gates passed', () => {
    const s = freshTs();
    s.onCommand('typecheck', true);
    s.onCommand('build', true);
    s.onCommand('test', true);
    expect(s.evaluate({ planText: plan({ modify: 2 }) })).toEqual({
      kind: 'short_circuit',
      reason: 'already_complete',
    });
  });

  it('short_circuit: empty_plan when plan has no actionable entries', () => {
    const s = freshTs();
    expect(s.evaluate({ planText: plan({ modify: 0 }) })).toEqual({
      kind: 'short_circuit',
      reason: 'empty_plan',
    });
    // whitespace-only body
    expect(s.evaluate({ planText: '   \n  ' })).toEqual({
      kind: 'short_circuit',
      reason: 'empty_plan',
    });
    // fenced empty body
    expect(s.evaluate({ planText: '```json\n```' })).toEqual({
      kind: 'short_circuit',
      reason: 'empty_plan',
    });
  });

  it('continue when plan has work and nothing else escalates', () => {
    const s = freshTs();
    expect(s.evaluate({ planText: plan({ modify: 1 }), modifyCount: 1 })).toEqual({
      kind: 'continue',
    });
  });

  it('force_split: too_many_errors when totalErrors >= threshold', () => {
    const s = freshTs();
    const p = plan({ modify: 2, totalErrors: 10 });
    expect(s.evaluate({ planText: p, modifyCount: 2, totalErrors: 10 })).toEqual({
      kind: 'force_split',
      reason: 'too_many_errors',
    });
  });

  it('force_split: too_many_files when modifyCount crosses file threshold', () => {
    const s = freshTs();
    expect(s.evaluate({ planText: plan({ modify: 4 }), modifyCount: 4, totalErrors: 0 }))
      .toEqual({ kind: 'force_split', reason: 'too_many_files' });
  });

  it('force_split: repeated_plan when same hash surfaced once with work to split', () => {
    const s = freshTs();
    const p = plan({ modify: 2 });
    s.onPlanApplied(p);
    expect(s.evaluate({ planText: p, modifyCount: 2 })).toEqual({
      kind: 'force_split',
      reason: 'repeated_plan',
    });
  });

  it('terminal: no_progress when same plan hash repeats twice', () => {
    const s = freshTs();
    const p = plan({ modify: 2 });
    s.onPlanApplied(p);
    s.onPlanApplied(p);
    const out = s.evaluate({ planText: p, modifyCount: 2 });
    expect(out.kind).toBe('terminal');
    if (out.kind === 'terminal') expect(out.errorKind).toBe('no_progress');
  });

  it('terminal: budget_exhausted when attempts reach ceiling without force-split conditions', () => {
    const s = freshTs();
    for (let i = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) s.onPlanEntry('retry');
    const out = s.evaluate({ planText: plan({ modify: 0 }), modifyCount: 0 });
    expect(out.kind).toBe('terminal');
    if (out.kind === 'terminal') expect(out.errorKind).toBe('budget_exhausted');
  });

  it('force_split: budget_low when budget=0 but work remains that can split', () => {
    const s = freshTs();
    for (let i = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) s.onPlanEntry('retry');
    expect(s.evaluate({ planText: plan({ modify: 3 }), modifyCount: 3 })).toEqual({
      kind: 'force_split',
      reason: 'budget_low',
    });
  });

  it('terminal: batch_cycle_limit when batchSplitCount reaches ceiling', () => {
    const s = freshTs();
    for (let i = 0; i < 10; i++) s.onBatchSplit('{}');
    const out = s.evaluate({ planText: plan({ modify: 1 }) });
    expect(out.kind).toBe('terminal');
    if (out.kind === 'terminal') expect(out.errorKind).toBe('batch_cycle_limit');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Batch split + install bookkeeping
// ────────────────────────────────────────────────────────────────────────────

describe('batch split + install', () => {
  it('onBatchSplit bumps counter and stores diagnostics', () => {
    const s = freshTs();
    expect(s.batchSplitCount()).toBe(0);
    s.onBatchSplit('{"totalErrors":3}');
    expect(s.batchSplitCount()).toBe(1);
    expect(s.previousBatchDiagnostics()).toBe('{"totalErrors":3}');
  });

  it('onInstallResolved sets depHash and clears installNeeded', () => {
    const s = freshTs();
    s.onFileChanged('all', true);
    expect(s.installNeeded()).toBe(true);
    s.onInstallResolved('deadbeef');
    expect(s.installNeeded()).toBe(false);
    expect(s.depHash()).toBe('deadbeef');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Snapshot round-trip guarantees (carry-over contract)
// ────────────────────────────────────────────────────────────────────────────

describe('snapshot round-trip', () => {
  it('is idempotent: rehydrate(snapshot()) equals the original snapshot', () => {
    const s = freshTs();
    s.onPlanEntry('retry');
    s.onCommand('typecheck', true);
    s.onPlanApplied(plan({ modify: 1, seed: 'x' }));
    s.onBatchSplit('{}');
    s.onInstallResolved('hash');

    const snap1 = s.snapshot();
    const snap2 = VerificationSession.rehydrate(snap1).snapshot();
    expect(snap2).toEqual(snap1);
  });

  it('snapshot returns fresh arrays (caller mutation does not leak back)', () => {
    const s = freshTs();
    s.onPlanApplied(plan({ modify: 1, seed: 'a' }));
    const snap = s.snapshot();
    snap.planHistoryHashes.push('contaminated');
    expect(s.snapshot().planHistoryHashes).not.toContain('contaminated');
  });
});
