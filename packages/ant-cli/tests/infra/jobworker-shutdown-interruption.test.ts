/**
 * Regression — `JobWorker.shutdown()` MUST proactively publish a
 * `server_shutdown` interruption for every active job.
 *
 * Bug (`loud-crafting-glare`): on a graceful worker SIGTERM (rolling redeploy /
 * scale-in) while the API server stays up, the in-progress job died silently —
 * no chat cancelled card, kanban stuck in "in progress". Root cause: the worker
 * process exited before its child's RESULT reached BullMQ's queueEvents.completed,
 * and `shutdown()` — unlike the `stalled` handler — never published to
 * JOB_STATUS_UPDATES. So the API-side RouteConfigurator → pauseJob (card + kanban
 * reset) never ran.
 *
 * The fix publishes DIRECTLY, and two orderings are load-bearing (guarded here):
 *  - publish BEFORE worker.close()/stateStore.close() (so it lands within a
 *    short pod grace window),
 *  - NO updateJobStatus('paused') from the worker (leaving status='running'
 *    keeps the BullMQ stalled net armed if the publish is cut short).
 * canResume is job-type-gated via the single owner (buildInfrastructureInterruption).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Avoid opening a real Redis connection in the constructor.
vi.mock('../../src/infrastructure/state/RedisStateStore', () => ({
  RedisStateStore: class {},
}));

import { JobWorker, settledLogLine } from '../../src/infrastructure/worker/JobWorker.js';
import { REDIS_CHANNELS } from '../../src/infrastructure/state/redisConstants';

let callOrder: string[];
let publishArgs: Array<{ channel: string; payload: any }>;

function makeFakeStore(jobType: string) {
  return {
    acquireLock: vi.fn(async (key: string) => { callOrder.push(`acquireLock:${key}`); return true; }),
    setKillReason: vi.fn(async () => { callOrder.push('setKillReason'); }),
    getJobMapping: vi.fn(async () => ({
      projectId: 'p1',
      featureName: 'f1',
      jobType,
      userContext: { userId: 'u1', organizationId: 'o1' },
    })),
    updateJobStatus: vi.fn(async () => { callOrder.push('updateJobStatus'); }),
    publish: vi.fn(async (channel: string, payload: any) => {
      callOrder.push('publish');
      publishArgs.push({ channel, payload });
    }),
    close: vi.fn(async () => { callOrder.push('stateStore.close'); }),
  };
}

function makeFakeChild() {
  const child: any = new EventEmitter();
  child.pid = 4242;
  child.kill = vi.fn(() => { callOrder.push('child.kill'); return true; });
  return child;
}

function buildWorker(jobType = 'design') {
  const w = new JobWorker({ redisUrl: 'redis://test', queueName: 'q', concurrency: 2 });
  const store = makeFakeStore(jobType);
  (w as any).stateStore = store;
  (w as any).worker = { close: vi.fn(async () => { callOrder.push('worker.close'); }) };
  const child = makeFakeChild();
  (w as any).runningProcesses = new Map([['job-1', child]]);
  return { w, store, child };
}

beforeEach(() => {
  callOrder = [];
  publishArgs = [];
  vi.clearAllMocks();
});

describe('settledLogLine — BullMQ "completed" is not "finished"', () => {
  // A gracefully interrupted run resolves the processor, so BullMQ fires
  // `completed` and the summary line used to read "Job completed" for a job
  // killed mid-run. Four sleep-killed builds were scored as finished that way.
  it.each([
    ['sleep kill', { output: { interruption: { reason: 'system_sleep' } } }, /settled without finishing \(system_sleep\)/],
    ['user stop', { interruption: { reason: 'user_stopped' } }, /settled without finishing \(user_stopped\)/],
    ['real completion', { output: { success: true } }, /^Job completed: j1$/],
    ['no return value', undefined, /^Job completed: j1$/],
    ['empty reason is not a reason', { interruption: { reason: '' } }, /^Job completed: j1$/],
  ])('%s', (_label, rv, pattern) => {
    expect(settledLogLine('j1', rv)).toMatch(pattern);
  });
});

describe('JobWorker.shutdown() — server_shutdown interruption publish', () => {
  it('publishes a server_shutdown interruption to JOB_STATUS_UPDATES', async () => {
    const { w } = buildWorker('design');
    await w.shutdown();

    expect(publishArgs).toHaveLength(1);
    const { channel, payload } = publishArgs[0];
    expect(channel).toBe(REDIS_CHANNELS.API_SERVER.JOB_STATUS_UPDATES);
    expect(payload.type).toBe('failed');
    expect(payload.status).toBe('paused');
    expect(payload.jobId).toBe('job-1');
    expect(payload.interruption.reason).toBe('server_shutdown');
    expect(payload.projectId).toBe('p1');
    expect(payload.featureName).toBe('f1');
    expect(payload.userEmail).toBe('u1@o1');
  });

  it('publishes BEFORE worker.close() and stateStore.close() (grace-window guard)', async () => {
    const { w } = buildWorker();
    await w.shutdown();

    const publishIdx = callOrder.indexOf('publish');
    const workerCloseIdx = callOrder.indexOf('worker.close');
    const storeCloseIdx = callOrder.indexOf('stateStore.close');
    expect(publishIdx).toBeGreaterThanOrEqual(0);
    expect(publishIdx).toBeLessThan(workerCloseIdx);
    expect(publishIdx).toBeLessThan(storeCloseIdx);
  });

  it('does NOT write updateJobStatus from the worker (keeps stalled net armed)', async () => {
    const { w, store } = buildWorker();
    await w.shutdown();
    expect(store.updateJobStatus).not.toHaveBeenCalled();
  });

  it('acquires the poison lock and terminates the child', async () => {
    const { w, store, child } = buildWorker();
    await w.shutdown();
    expect(store.acquireLock).toHaveBeenCalledWith('ant:job-poisoned:job-1', 600);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('gates canResume by job type (single owner): code/design → true', async () => {
    const { w } = buildWorker('design');
    await w.shutdown();
    expect(publishArgs[0].payload.interruption.canResume).toBe(true);
  });

  it('gates canResume by job type (single owner): plan/visual → false', async () => {
    const { w } = buildWorker('plan');
    await w.shutdown();
    expect(publishArgs[0].payload.interruption.canResume).toBe(false);
  });
});
