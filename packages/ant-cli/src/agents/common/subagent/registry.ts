/**
 * Pending-children registry — process-local runtime state.
 *
 * Holds promise handles for in-flight explore subagents of the ONE job this
 * job-runner child process executes. Like composition/jobAbort.ts, these are
 * non-serializable runtime handles, NOT a mirror of Redis-owned SSOT state:
 * nothing here is authoritative across processes, and the map dying with the
 * process is by design (resume converts orphaned launches into explicit LOST
 * notifications — see drain.ts).
 */

import { subagentMaxConcurrent, subagentJoinTimeoutMs } from './config';
import type { SubagentEntry, SubagentResult } from './types';

const entries = new Map<string, SubagentEntry>();

export function launchEntry(init: {
  id: string;
  ownerKey: string;
  goal: string;
  run: () => Promise<SubagentResult>;
}): SubagentEntry | { denied: string } {
  const running = pendingFor(init.ownerKey).length;
  const cap = subagentMaxConcurrent();
  if (running >= cap) {
    return {
      denied:
        `Error: subagent concurrency limit reached (${running}/${cap} running). ` +
        `Do this investigation yourself, or launch explore again after a pending report arrives.`,
    };
  }

  const entry: SubagentEntry = {
    id: init.id,
    ownerKey: init.ownerKey,
    goal: init.goal,
    status: 'running',
    promise: Promise.resolve(),
    launchedAt: Date.now(),
    delivered: false,
  };
  // The runner never rejects; the catch is a last-resort safety net so a
  // programming error cannot leave the entry permanently pending.
  entry.promise = init
    .run()
    .then((result) => {
      entry.result = result;
    })
    .catch((err: unknown) => {
      entry.result = {
        report: `Exploration failed: ${(err as Error)?.message ?? String(err)}. Treat as no findings; re-issue explore or read directly if needed.`,
        rounds: 0,
        state: 'error',
      };
    })
    .then(() => {
      entry.status = 'settled';
    });
  entries.set(entry.id, entry);
  return entry;
}

export function getEntry(id: string): SubagentEntry | undefined {
  return entries.get(id);
}

export function pendingFor(ownerKey: string): SubagentEntry[] {
  return [...entries.values()].filter((e) => e.ownerKey === ownerKey && e.status === 'running');
}

export function hasPending(ownerKey: string): boolean {
  return pendingFor(ownerKey).length > 0;
}

export function pendingOlderThan(ownerKey: string, ageMs: number): SubagentEntry[] {
  const cutoff = Date.now() - ageMs;
  return pendingFor(ownerKey).filter((e) => e.launchedAt <= cutoff);
}

/**
 * Collect settled, undelivered entries for this owner. Marks them delivered
 * and removes them from the map — single-consumer semantics (drain sites for
 * one owner are serialized by node execution on the single event loop).
 */
export function collectCompleted(ownerKey: string): SubagentEntry[] {
  const done = [...entries.values()].filter(
    (e) => e.ownerKey === ownerKey && e.status === 'settled' && !e.delivered,
  );
  for (const e of done) {
    e.delivered = true;
    entries.delete(e.id);
  }
  return done;
}

/**
 * Await every pending child of this owner, bounded by joinTimeoutMs. Entries
 * still unsettled after the bound are force-settled with a partial report so
 * the subsequent collectCompleted always drains them.
 */
export async function joinAll(ownerKey: string, timeoutMs = subagentJoinTimeoutMs()): Promise<void> {
  const pending = pendingFor(ownerKey);
  if (pending.length === 0) return;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const all = Promise.allSettled(pending.map((e) => e.promise)).then(() => 'settled' as const);
  const outcome = await Promise.race([all, timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === 'timeout') {
    for (const e of pending) {
      if (e.status !== 'settled') {
        e.result = {
          report: `[partial] Exploration timed out during phase join (goal: ${e.goal}). No further findings will arrive.`,
          rounds: 0,
          state: 'partial',
        };
        e.status = 'settled';
      }
    }
  }
}

/** Known (undelivered) ids for this owner — used by orphan detection. */
export function knownIds(ownerKey: string): Set<string> {
  const ids = new Set<string>();
  for (const e of entries.values()) {
    if (e.ownerKey === ownerKey) ids.add(e.id);
  }
  return ids;
}

/**
 * Drop every entry of this owner (task-completion / terminal paths — leak
 * guard). In serial mode every task shares the `_main_` scope, so stale
 * settled entries would otherwise be drained into the NEXT task's
 * conversation. Returns the number of entries dropped (0 = clean path).
 */
export function clearOwner(ownerKey: string): number {
  let dropped = 0;
  for (const [id, e] of entries) {
    if (e.ownerKey === ownerKey) {
      entries.delete(id);
      dropped++;
    }
  }
  return dropped;
}

/** Test helper. */
export function clearAll(): void {
  entries.clear();
}
