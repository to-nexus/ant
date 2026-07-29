/**
 * Design plan phase — report delivery integrity (sage-causing-rover C1/C2/C3).
 *
 * C1: the fallthrough join barrier must be consumed IN-NODE (code-twin
 *     parity). The old delta-return misrouted to execute (`routeAfterPlan`
 *     saw the tool node's cleared toolCalls) AFTER `collectCompleted` had
 *     already deleted the registry entries — collect-then-discard.
 * C2: reports settled at seal time must reach the plan LLM before finalize
 *     (non-blocking: pending children still flow to execute per doc 43).
 * C3: a task re-entry (cycleSeq INCR) strands prior-cycle registry entries
 *     under an unreachable ownerKey — swept at pickup.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  launchEntry,
  collectCompleted,
  clearOwnerByTaskPrefix,
  clearAll,
  getEntry,
} from '../../src/agents/common/subagent/registry';
import type { SubagentResult } from '../../src/agents/common/subagent/types';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '../../', rel), 'utf-8');
}

function settledEntry(id: string, ownerKey: string, report = `findings ${id}`) {
  const entry = launchEntry({
    id,
    ownerKey,
    goal: `goal ${id}`,
    run: async (): Promise<SubagentResult> => ({ report, rounds: 1, state: 'done' }),
  });
  if ('denied' in entry) throw new Error('unexpected denial');
  return entry.promise;
}

beforeEach(() => {
  clearAll();
});

describe('C3 — clearOwnerByTaskPrefix', () => {
  it('sweeps every cycle of one task, never a sibling task', async () => {
    await settledEntry('a', 'job1:worker-0#task-A');
    await settledEntry('b', 'job1:worker-0#task-A#p1');
    await settledEntry('c', 'job1:worker-0#task-A#p2');
    // Sibling task whose key shares a prefix — must survive.
    await settledEntry('d', 'job1:worker-0#task-AB');
    // Different worker — must survive.
    await settledEntry('e', 'job1:worker-1#task-A');

    const dropped = clearOwnerByTaskPrefix('job1', 0, 'task-A');
    expect(dropped).toBe(3);
    expect(getEntry('a')).toBeUndefined();
    expect(getEntry('b')).toBeUndefined();
    expect(getEntry('c')).toBeUndefined();
    expect(getEntry('d')).toBeDefined();
    expect(getEntry('e')).toBeDefined();
  });

  it('handles the nojob fallback key', async () => {
    await settledEntry('x', 'nojob:worker-2#t');
    expect(clearOwnerByTaskPrefix(undefined, 2, 't')).toBe(1);
  });
});

describe('C2 — drainSettledReportsAtSeal (non-blocking collect)', () => {
  it('collects settled entries without awaiting pending ones', async () => {
    const ownerKey = 'jobX:worker-0#t1';
    await settledEntry('s1', ownerKey);
    // A still-running child: never settles during this test.
    const pending = launchEntry({
      id: 'p1',
      ownerKey,
      goal: 'slow',
      run: () => new Promise(() => { /* never settles */ }),
    });
    if ('denied' in pending) throw new Error('unexpected denial');

    // collectCompleted (what the seal drain uses) returns ONLY settled ones
    // and does not block on the pending child.
    const completed = collectCompleted(ownerKey);
    expect(completed.map((e) => e.id)).toEqual(['s1']);
    // The pending entry survives for the execute phase (doc-43 contract).
    expect(getEntry('p1')).toBeDefined();
  });
});

describe('C1/C2 — design plan node wiring (static source guards)', () => {
  const src = read('src/agents/architect/graph/design/nodes/plan/index.ts');

  it('the fallthrough join is consumed IN-NODE (no misrouted graph delta)', () => {
    // The collect-then-discard shape is gone…
    expect(src).not.toContain('deliverOwedExploreReportsDelta');
    // …replaced by history-producing join + an in-node re-run of the loop.
    expect(src).toContain('joinOwedReportsIntoHistory');
    expect(src).toMatch(/joined\.history[\s\S]{0,200}sharedRunPlanToolLoopPhase/);
  });

  it('seal path drains settled reports before finalize (C2), non-blocking', () => {
    expect(src).toContain('drainSettledReportsAtSeal');
    // Uses collectCompleted (settled only) — never joinAll (which would
    // block the seal on still-running children).
    expect(src).toMatch(/collectCompleted\(/);
    expect(src).not.toMatch(/joinAll\(/);
    // Bounded: the seal drain fires at most once.
    expect(src).toContain('sealDrainDone');
  });

  it('TaskWorker sweeps prior-cycle entries on re-entry (C3 call site)', () => {
    const worker = read('src/agents/architect/graph/code/parallel/TaskWorker.ts');
    expect(worker).toContain('clearOwnerByTaskPrefix');
    expect(worker).toMatch(/if \(isReentry\) \{[\s\S]{0,400}clearOwnerByTaskPrefix/);
  });
});
