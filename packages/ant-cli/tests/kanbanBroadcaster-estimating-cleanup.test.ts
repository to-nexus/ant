/**
 * KanbanBroadcaster — estimating-phase battery cleanup.
 *
 * Ensures the `MAIN_WORKER_KEY` slot holding a triage/detect/decompose
 * snapshot is dropped the moment tasks start running, so the chat-input
 * gauge no longer shows a stale "작업계획수립중" battery during parallel
 * worker orchestration.
 *
 * See plan: chat-gauge-stale-estimating-fix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PhaseTokenUsage } from '@ant/shared';

// ioredis must be mocked BEFORE KanbanBroadcaster is imported. Every Redis
// instance records set/publish calls on a shared `calls` array so the test
// can inspect the last published payload.
const calls: { method: 'set' | 'publish'; channel?: string; payload: string }[] = [];

vi.mock('ioredis', () => {
  class MockRedis {
    on() { return this; }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async set(_key: string, value: string, ..._rest: unknown[]) {
      calls.push({ method: 'set', payload: value });
      return 'OK' as const;
    }
    async publish(channel: string, payload: string) {
      calls.push({ method: 'publish', channel, payload });
      return 1;
    }
    async quit() { return 'OK' as const; }
  }
  return { Redis: MockRedis, default: MockRedis };
});

const { KanbanBroadcaster } = await import('../src/core/realtime/KanbanBroadcaster');

function mkPhase(phase: string, input: number, output: number, workerId?: number): PhaseTokenUsage {
  return {
    phase,
    label: phase,
    tokenUsage: {
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
      callCount: 1,
    },
    ...(typeof workerId === 'number' && { workerId }),
  };
}

function mkBroadcaster() {
  return new KanbanBroadcaster({
    redisUrl: 'redis://mock',
    jobId: 'job-1',
    projectId: 'proj-1',
    featureName: 'feat-1',
    jobType: 'code',
    userContext: { userId: 'u1', organizationId: 'org1' } as any,
  });
}

async function flush() {
  // KanbanBroadcaster fires broadcasts via .catch(); await a tick so the
  // mocked Redis set/publish complete before assertions.
  await new Promise((r) => setImmediate(r));
}

function latestPublished(): any {
  const lastPublish = [...calls].reverse().find((c) => c.method === 'publish');
  if (!lastPublish) return undefined;
  return JSON.parse(lastPublish.payload).data;
}

describe('KanbanBroadcaster — estimating battery cleanup', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('drops the decompose snapshot when tasks begin executing', async () => {
    const kb = mkBroadcaster();

    // Estimating: decompose LLM call lands in the MAIN_WORKER_KEY slot.
    kb.updateCurrentPhaseTokenUsage(mkPhase('decompose', 1200, 400));
    await flush();

    const beforeTasks = latestPublished();
    expect(beforeTasks?.currentPhaseTokenUsages).toHaveLength(1);
    expect(beforeTasks?.currentPhaseTokenUsages?.[0]?.phase).toBe('decompose');

    // Parallel orchestration begins — first task is assigned, worker 0
    // emits its own snapshot.
    kb.updateTaskQueue(
      'job-1',
      [{ id: 't1', name: 'Task 1' } as any],
      [],
      [],
    );
    await flush();
    kb.updateCurrentPhaseTokenUsage(mkPhase('execute', 800, 200, 0));
    await flush();

    const afterTasks = latestPublished();
    const phases = afterTasks?.currentPhaseTokenUsages ?? [];
    // Decompose battery must be gone; only worker 0's execute battery survives.
    expect(phases.map((p: PhaseTokenUsage) => p.phase)).toEqual(['execute']);
    expect(phases[0].workerId).toBe(0);
  });

  it('is idempotent: post-estimating main-phase snapshot (learn) is preserved', async () => {
    const kb = mkBroadcaster();

    // Simulate estimating → tasks → main graph re-engages with a non-estimating
    // phase (learn). The learn snapshot must NOT be dropped on subsequent
    // task-queue broadcasts.
    kb.updateCurrentPhaseTokenUsage(mkPhase('decompose', 1000, 300));
    kb.updateTaskQueue('job-1', [{ id: 't1', name: 'T1' } as any], [], []);
    await flush();

    kb.updateCurrentPhaseTokenUsage(mkPhase('learn', 500, 150));
    kb.updateTaskQueue('job-1', [], [], [{ id: 't1', name: 'T1' } as any]);
    await flush();

    const phases = latestPublished()?.currentPhaseTokenUsages ?? [];
    expect(phases.map((p: PhaseTokenUsage) => p.phase)).toEqual(['learn']);
  });

  it('clears the estimating snapshot when clearEstimatingActivity runs', async () => {
    const kb = mkBroadcaster();

    kb.setEstimatingActivity('triage', 'triage');
    kb.updateCurrentPhaseTokenUsage(mkPhase('triage', 300, 50));
    await flush();

    kb.clearEstimatingActivity();
    await flush();

    const phases = latestPublished()?.currentPhaseTokenUsages;
    // The broadcaster omits the field when the cache is empty — kanbanReducer
    // on the frontend handles the "no batteries" state from there.
    expect(phases).toBeUndefined();
  });
});
