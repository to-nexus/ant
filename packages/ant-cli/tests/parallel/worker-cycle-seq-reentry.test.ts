/**
 * Worker cycleSeq re-entry isolation — verification re-entry stale-card RCA guard.
 *
 * Locks the contract that:
 *   1. `nextWorkerCycleSeq(turnId, taskKey)` is per-(turn, task) —
 *      re-entry of one task does not perturb a sibling task's cycleSeq.
 *   2. `getCurrentWorkerCycleSeq` is GET-only (no implicit INCR).
 *   3. `LLMResponseService.nextWorkerCycleSeq` / `getCurrentWorkerCycleSeq`
 *      delegate to the StateStorePort with the service's bound turnId.
 *   4. `TurnContext.getWorkerScopeKey` mints `worker-N#task-K#p{n}` for
 *      cycleSeq>=1 and `worker-N#task-K` for cycleSeq=0 — the latter
 *      is what guarantees fresh-entry chat.jsonl events fold into the
 *      legacy two-axis section without a migration.
 *
 * The bug this guards: when verification batchSplit Path A re-queues the
 * same task.id with `interrupted=true`, `TaskWorker.executeTask` MUST
 * INCR cycleSeq so a fresh `LLMResponseService.WorkerLocalState` slot
 * is minted. Without the INCR the second cycle inherits the first
 * cycle's `fileCardByPath` / `commandCardByCommand` / `thinking` cardId
 * caches, terminal `chat_status` events carry old cardIds, and FE folds
 * them into the prior cycle's card position (scrollback updates
 * spuriously).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import type { BaseTask } from '@ant/shared';
import type { StateStorePort } from '../../src/core/ports/stateStore';
import { LLMResponseService } from '../../src/core/llm-response/LLMResponseService';
import type { LLMResponseEnv } from '../../src/core/llm-response/types';
import { TurnContext } from '../../src/core/llm-response/TurnContext';
import {
  runInTaskScope,
  runInWorkerScope,
} from '../../src/core/parallel/workerScope';
import { isTaskReentry } from '../../src/agents/architect/graph/code/parallel/TaskWorker';

// ─────────────────────────────────────────────────────────────────────
// Test double — narrow StateStorePort surface
// ─────────────────────────────────────────────────────────────────────

class CycleSeqStore implements Partial<StateStorePort> {
  // (turnId, taskKey) → counter
  private counters = new Map<string, number>();
  // Diagnostic: track INCR vs GET call sites so tests can lock the
  // "GET-only never auto-INCRs" invariant.
  incrCalls: Array<{ turnId: string; taskKey: string }> = [];
  getCalls: Array<{ turnId: string; taskKey: string }> = [];

  private k(turnId: string, taskKey: string): string {
    return `${turnId}::${taskKey}`;
  }

  async nextWorkerCycleSeq(turnId: string, taskKey: string): Promise<number> {
    this.incrCalls.push({ turnId, taskKey });
    const key = this.k(turnId, taskKey);
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async getCurrentWorkerCycleSeq(turnId: string, taskKey: string): Promise<number> {
    this.getCalls.push({ turnId, taskKey });
    return this.counters.get(this.k(turnId, taskKey)) ?? 0;
  }

  // pauseSeq stays untouched by the worker path — provided for any
  // callers that incidentally hit it.
  async nextPauseSeq(_turnId: string): Promise<number> { return 0; }
  async getCurrentPauseSeq(_turnId: string): Promise<number> { return 0; }
}

function makeService(): { service: LLMResponseService; store: CycleSeqStore } {
  const env: LLMResponseEnv = {
    projectId: 'proj',
    featureName: 'feat',
    jobId: 'job-1',
    jobType: 'code',
    agent: 'architect',
    userId: 'user-1',
    organizationId: 'org-1',
  };
  const store = new CycleSeqStore();
  const service = new LLMResponseService(store as unknown as StateStorePort, env);
  service.setTurnId('turn-1');
  return { service, store };
}

// ─────────────────────────────────────────────────────────────────────
// `isTaskReentry` truth table — locks the marker matrix so any future
// re-entry source MUST extend this predicate (or the worker will skip
// cycleSeq INCR and the verification re-entry stale-card bug recurs).
// ─────────────────────────────────────────────────────────────────────

describe('isTaskReentry — re-entry marker truth table', () => {
  function task(over: Partial<BaseTask> & Record<string, unknown> = {}): BaseTask {
    return {
      id: 't',
      name: 'task',
      type: 'verification',
      priority: 1000,
      ...over,
    } as BaseTask;
  }

  it('fresh task (no markers) is NOT a re-entry', () => {
    expect(isTaskReentry(task())).toBe(false);
  });

  it('`task.interrupted === true` IS a re-entry — covers Stop+Resume / batchSplit Path A / orchestrator transient retry', () => {
    expect(isTaskReentry(task({ interrupted: true }))).toBe(true);
  });

  it('`task._failedAttempts > 0` IS a re-entry — defensive fallback for any path that bumps the counter without touching `interrupted`', () => {
    expect(isTaskReentry(task({ _failedAttempts: 1 } as any))).toBe(true);
    expect(isTaskReentry(task({ _failedAttempts: 5 } as any))).toBe(true);
  });

  it('`task._failedAttempts === 0` is NOT a re-entry by itself', () => {
    expect(isTaskReentry(task({ _failedAttempts: 0 } as any))).toBe(false);
  });

  it('`task.interrupted === false` (explicit) is NOT a re-entry by itself', () => {
    expect(isTaskReentry(task({ interrupted: false }))).toBe(false);
  });

  it('either marker alone is sufficient — they are independently sufficient (OR semantics)', () => {
    expect(isTaskReentry(task({ interrupted: true, _failedAttempts: 0 } as any))).toBe(true);
    expect(isTaskReentry(task({ interrupted: false, _failedAttempts: 2 } as any))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// SSOT — per-(turn, task) isolation
// ─────────────────────────────────────────────────────────────────────

describe('CycleSeqStore — per-(turn, task) isolation', () => {
  let store: CycleSeqStore;
  beforeEach(() => {
    store = new CycleSeqStore();
  });

  it('returns 0 before any INCR (peek-only contract)', async () => {
    expect(await store.getCurrentWorkerCycleSeq('turn-1', 'task-A')).toBe(0);
    expect(store.incrCalls).toHaveLength(0);
  });

  it('first INCR returns 1, second returns 2 — monotonic for the same (turn, task)', async () => {
    expect(await store.nextWorkerCycleSeq('turn-1', 'task-A')).toBe(1);
    expect(await store.nextWorkerCycleSeq('turn-1', 'task-A')).toBe(2);
    expect(await store.getCurrentWorkerCycleSeq('turn-1', 'task-A')).toBe(2);
  });

  it('two tasks in the same turn carry independent cycleSeq counters', async () => {
    expect(await store.nextWorkerCycleSeq('turn-1', 'task-A')).toBe(1);
    expect(await store.getCurrentWorkerCycleSeq('turn-1', 'task-B')).toBe(0);
    expect(await store.nextWorkerCycleSeq('turn-1', 'task-B')).toBe(1);
    // task-A unaffected
    expect(await store.getCurrentWorkerCycleSeq('turn-1', 'task-A')).toBe(1);
  });

  it('two turns carry independent counters even for the same taskKey', async () => {
    await store.nextWorkerCycleSeq('turn-1', 'task-A');
    await store.nextWorkerCycleSeq('turn-1', 'task-A');
    expect(await store.getCurrentWorkerCycleSeq('turn-2', 'task-A')).toBe(0);
  });

  it('GET never implicitly INCRs (peek-only)', async () => {
    await store.getCurrentWorkerCycleSeq('turn-1', 'task-A');
    await store.getCurrentWorkerCycleSeq('turn-1', 'task-A');
    expect(store.incrCalls).toHaveLength(0);
    expect(await store.getCurrentWorkerCycleSeq('turn-1', 'task-A')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// LLMResponseService — delegation contract
// ─────────────────────────────────────────────────────────────────────

describe('LLMResponseService.nextWorkerCycleSeq / getCurrentWorkerCycleSeq', () => {
  it('delegate to the bound turnId — caller passes only taskKey', async () => {
    const { service, store } = makeService();
    expect(await service.nextWorkerCycleSeq('task-A')).toBe(1);
    expect(store.incrCalls).toEqual([{ turnId: 'turn-1', taskKey: 'task-A' }]);

    expect(await service.getCurrentWorkerCycleSeq('task-A')).toBe(1);
    expect(store.getCalls).toEqual([{ turnId: 'turn-1', taskKey: 'task-A' }]);
  });

  it('returns 0 best-effort when turnId is unset (no Redis blip should abort the worker)', async () => {
    const env: LLMResponseEnv = {
      projectId: 'proj',
      featureName: 'feat',
      jobId: 'job-1',
      jobType: 'code',
      agent: 'architect',
      userId: 'user-1',
      organizationId: 'org-1',
    };
    const store = new CycleSeqStore();
    const service = new LLMResponseService(store as unknown as StateStorePort, env);
    // Intentionally NOT calling setTurnId — simulating worker entry
    // before the runner has assigned a turnId yet.
    expect(await service.nextWorkerCycleSeq('task-A')).toBe(0);
    expect(await service.getCurrentWorkerCycleSeq('task-A')).toBe(0);
    expect(store.incrCalls).toHaveLength(0);
    expect(store.getCalls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Scope key composition — re-entry mints a fresh section/slot
// ─────────────────────────────────────────────────────────────────────

describe('TurnContext.getWorkerScopeKey × cycleSeq from re-entry', () => {
  function makeContext(): TurnContext {
    return new TurnContext({
      projectId: 'proj',
      featureName: 'feat',
      jobId: 'job-1',
      jobType: 'code',
      agent: 'architect',
    } as LLMResponseEnv);
  }

  it('first attempt (cycleSeq=0) mints `worker-N#task-K` — legacy schema parity', async () => {
    const ctx = makeContext();
    await runInWorkerScope(2, async () => {
      await runInTaskScope('task-V', 0, async () => {
        // Two-axis form so chat.jsonl fold rules stay BC.
        expect(ctx.getWorkerScopeKey()).toBe('worker-2#task-V');
      });
    });
  });

  it('first re-entry (cycleSeq=1) mints `worker-N#task-K#p1` — fresh FE section AND fresh WorkerLocalState slot', async () => {
    const ctx = makeContext();
    await runInWorkerScope(2, async () => {
      await runInTaskScope('task-V', 1, async () => {
        expect(ctx.getWorkerScopeKey()).toBe('worker-2#task-V#p1');
      });
    });
  });

  it('subsequent re-entries (cycleSeq=2, 3, ...) chain into distinct scope keys', async () => {
    const ctx = makeContext();
    await runInWorkerScope(2, async () => {
      await runInTaskScope('task-V', 2, async () => {
        expect(ctx.getWorkerScopeKey()).toBe('worker-2#task-V#p2');
      });
      await runInTaskScope('task-V', 3, async () => {
        expect(ctx.getWorkerScopeKey()).toBe('worker-2#task-V#p3');
      });
    });
  });

  it('different (worker, task) pairs are independent — sibling tasks do not collide on cycleSeq=1', async () => {
    const ctx = makeContext();
    await runInWorkerScope(2, async () => {
      await runInTaskScope('task-A', 1, async () => {
        expect(ctx.getWorkerScopeKey()).toBe('worker-2#task-A#p1');
      });
      await runInTaskScope('task-B', 1, async () => {
        expect(ctx.getWorkerScopeKey()).toBe('worker-2#task-B#p1');
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// End-to-end shape — re-entry mints a fresh service-side cache slot
// ─────────────────────────────────────────────────────────────────────

describe('verification re-entry — scope-key change isolates LLMResponseService cache slot', () => {
  it('two cycles of the same task on the same worker mint distinct workerScopeKeys when cycleSeq INCRs between them', async () => {
    const env: LLMResponseEnv = {
      projectId: 'proj',
      featureName: 'feat',
      jobId: 'job-1',
      jobType: 'code',
      agent: 'architect',
      userId: 'user-1',
      organizationId: 'org-1',
    };
    const store = new CycleSeqStore();
    const service = new LLMResponseService(store as unknown as StateStorePort, env);
    service.setTurnId('turn-1');
    // The service composes its own TurnContext from the same env;
    // construct a sibling instance with the same env so we can probe
    // the worker-scope key the service would observe.
    const ctx = new TurnContext(env);

    // Cycle 1 — fresh entry (no marker → peek returns 0).
    const cycle1Seq = await service.getCurrentWorkerCycleSeq('task-V');
    expect(cycle1Seq).toBe(0);
    let key1 = '';
    await runInWorkerScope(2, async () => {
      await runInTaskScope('task-V', cycle1Seq, async () => {
        key1 = ctx.getWorkerScopeKey();
      });
    });
    expect(key1).toBe('worker-2#task-V');

    // Cycle 2 — re-entry (marker present → INCR returns 1).
    const cycle2Seq = await service.nextWorkerCycleSeq('task-V');
    expect(cycle2Seq).toBe(1);
    let key2 = '';
    await runInWorkerScope(2, async () => {
      await runInTaskScope('task-V', cycle2Seq, async () => {
        key2 = ctx.getWorkerScopeKey();
      });
    });
    expect(key2).toBe('worker-2#task-V#p1');

    // The two keys differ → `workerStates.get(key)` returns distinct
    // slots → fileCardByPath / commandCardByCommand / thinking caches
    // are isolated → no stale cardId carry-over.
    expect(key1).not.toBe(key2);
  });
});
