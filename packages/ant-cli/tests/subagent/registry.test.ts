/**
 * Subagent registry — launch/settle/collect lifecycle, ownerKey isolation,
 * double-drain guard, concurrency cap, joinAll timeout force-settle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  launchEntry,
  collectCompleted,
  hasPending,
  pendingOlderThan,
  joinAll,
  clearOwner,
  clearAll,
  knownIds,
} from '../../src/agents/common/subagent/registry';
import type { SubagentResult } from '../../src/agents/common/subagent/types';

const OWNER_A = 'job1:worker-1#task-a';
const OWNER_B = 'job1:worker-2#task-b';

function deferred() {
  let resolve!: (r: SubagentResult) => void;
  const promise = new Promise<SubagentResult>((res) => { resolve = res; });
  return { promise, resolve };
}

const doneResult = (report = 'findings'): SubagentResult => ({
  report,
  rounds: 2,
  state: 'done',
});

beforeEach(() => clearAll());
afterEach(() => clearAll());

describe('subagent registry', () => {
  it('launch → settle → collect lifecycle (single consumer)', async () => {
    const d = deferred();
    const entry = launchEntry({ id: 'c1', ownerKey: OWNER_A, goal: 'g', run: () => d.promise });
    expect('denied' in entry).toBe(false);
    expect(hasPending(OWNER_A)).toBe(true);
    expect(collectCompleted(OWNER_A)).toHaveLength(0);

    d.resolve(doneResult());
    await (entry as any).promise;

    expect(hasPending(OWNER_A)).toBe(false);
    const collected = collectCompleted(OWNER_A);
    expect(collected).toHaveLength(1);
    expect(collected[0].result?.report).toBe('findings');

    // Double-drain guard: second collect returns nothing.
    expect(collectCompleted(OWNER_A)).toHaveLength(0);
  });

  it('ownerKey isolation — no cross-worker drain', async () => {
    const d = deferred();
    const e = launchEntry({ id: 'c2', ownerKey: OWNER_A, goal: 'g', run: () => d.promise });
    d.resolve(doneResult());
    await (e as any).promise;

    expect(collectCompleted(OWNER_B)).toHaveLength(0);
    expect(collectCompleted(OWNER_A)).toHaveLength(1);
  });

  it('concurrency cap denies launch beyond the limit', () => {
    const pending = deferred();
    for (let i = 0; i < 3; i++) {
      const r = launchEntry({ id: `cap${i}`, ownerKey: OWNER_A, goal: 'g', run: () => pending.promise });
      expect('denied' in r).toBe(false);
    }
    const over = launchEntry({ id: 'cap3', ownerKey: OWNER_A, goal: 'g', run: () => pending.promise });
    expect('denied' in over).toBe(true);
    // A different owner is unaffected by A's saturation.
    const other = launchEntry({ id: 'capB', ownerKey: OWNER_B, goal: 'g', run: () => pending.promise });
    expect('denied' in other).toBe(false);
  });

  it('runner throw is converted to error-shaped settled result (never-reject)', async () => {
    const e = launchEntry({
      id: 'c3', ownerKey: OWNER_A, goal: 'g',
      run: () => Promise.reject(new Error('boom')),
    });
    await (e as any).promise;
    const [entry] = collectCompleted(OWNER_A);
    expect(entry.result?.state).toBe('error');
    expect(entry.result?.report).toContain('boom');
  });

  it('joinAll force-settles stragglers with a partial report on timeout', async () => {
    const never = new Promise<SubagentResult>(() => { /* never settles */ });
    launchEntry({ id: 'c4', ownerKey: OWNER_A, goal: 'slow goal', run: () => never });

    await joinAll(OWNER_A, 50);
    expect(hasPending(OWNER_A)).toBe(false);
    const [entry] = collectCompleted(OWNER_A);
    expect(entry.result?.state).toBe('partial');
    expect(entry.result?.report).toContain('[partial]');
  });

  it('pendingOlderThan + clearOwner leak guard', async () => {
    const never = new Promise<SubagentResult>(() => { /* never settles */ });
    launchEntry({ id: 'c5', ownerKey: OWNER_A, goal: 'g', run: () => never });

    expect(pendingOlderThan(OWNER_A, 0)).toHaveLength(1);
    expect(pendingOlderThan(OWNER_A, 60_000)).toHaveLength(0);
    expect(knownIds(OWNER_A).has('c5')).toBe(true);

    expect(clearOwner(OWNER_A)).toBe(1);
    expect(hasPending(OWNER_A)).toBe(false);
    expect(clearOwner(OWNER_A)).toBe(0);
  });
});
