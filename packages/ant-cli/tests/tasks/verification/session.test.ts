/**
 * L1 — `VerificationSession` model invariants.
 *
 *   - `createFresh` / `rehydrate` (construction & snapshot round-trip)
 *   - Gate transitions: `onCommand`, `onFileChanged`, `onPlanEntry`
 *   - Plan history + repeated-plan detection
 *   - Deep-diagnostic mode
 *   - Batch-split cycle counter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VerificationSession,
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
 * Build a JSON plan body with N modify entries plus optional batches.
 * Used to drive `isPlanRepeated` detection.
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

  it('markInstallNeeded drives the install flag (observation-based, F3)', () => {
    expect(s.installNeeded()).toBe(false);
    s.markInstallNeeded(true);
    expect(s.installNeeded()).toBe(true);
    expect(s.dependencyStatus()).toBe('changed');
    s.markInstallNeeded(false);
    expect(s.installNeeded()).toBe(false);
    expect(s.dependencyStatus()).toBe('current');
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

  it('records empty plans as stable hashes and skips the body buffer', () => {
    // Empty planText is the "silent give-up" signal: the LLM ended the
    // plan cycle without emitting a `<plan>` block. We still want the
    // repetition detector to see it (so the hash list IS appended) but
    // the bounded body buffer is for prompt-injection display and has
    // no meaningful empty rendering.
    const s = freshTs();
    s.onPlanApplied('');
    s.onPlanApplied('');
    expect(s.snapshot().planHistoryHashes.length).toBe(2);
    expect(s.planHistoryBodies()).toEqual([]);
    expect(s.isPlanRepeated('')).toEqual({ repeated: true, count: 2 });
  });

  it('isPlanRepeated distinguishes empty from non-empty plan hashes', () => {
    const s = freshTs();
    s.onPlanApplied(plan({ modify: 1, seed: 'x' }));
    s.onPlanApplied(plan({ modify: 1, seed: 'x' }));
    // Trailing non-empty plan pair — an empty candidate does not match it.
    expect(s.isPlanRepeated('')).toEqual({ repeated: false, count: 0 });
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
    s.markInstallNeeded(false);

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
