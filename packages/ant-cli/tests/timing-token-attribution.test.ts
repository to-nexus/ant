/**
 * Timing/Token Attribution Invariants
 *
 * Locks the contracts established by the `timing-token-attribution-fix`
 * plan:
 *
 *   1. `JobTimingManager.resumeJob` settles `pausedAt` →
 *      `totalPausedDuration` so the kanban header's
 *      `(end - start - totalPaused)` formula stops attributing the idle
 *      window to active runtime.
 *
 *   2. `processDiagnosticBatchSplit` Path A (`requeue-parent`) carries
 *      the parent's accumulated `timing` (via `pauseTask`) AND its
 *      `_currentTaskTokenUsage` (stashed onto `task.tokenUsage`) so the
 *      pre-split runtime + tokens are not orphaned.
 *
 *   3. `processDiagnosticBatchSplit` Path B (`drop-and-replace`)
 *      finalises the parent into `_supersededByBatchSplit` with
 *      `supersededBy` lineage + captured `timing.elapsedTime` +
 *      `tokenUsage`. `completed` stays false so the parent does not
 *      inflate the "X / Y completed" counter.
 *
 *   4. `TaskOrchestrator.reportBatchSplit(workerId, task, supersededDetails)`
 *      merges Path B parents into `completedTasks` so kanban tooltip
 *      rows survive the worker→orchestrator boundary.
 *
 *   5. `TaskOrchestrator.assignTask` dispatches on `task.timing.pausedAt`:
 *      a paused/requeued task takes the `startTask` branch (carry
 *      preserved + paused window accumulated); other tasks take the
 *      legacy `restartTask` branch (cumulative-elapsed regression guard).
 */

import { describe, it, expect } from 'vitest';
import type { BaseTask, TaskTokenUsage } from '@ant/shared';
import { JobTimingManager, type JobTiming } from '../src/agents/common/graph/timing/JobTimingManager';
import { processDiagnosticBatchSplit } from '../src/agents/architect/graph/code/tasks/_shared/batchSplit';
import { TaskQueue, type CodeTask } from '../src/agents/architect/types/task';
import { TaskTimingHelper } from '../src/agents/architect/graph/code/state';
import { TaskOrchestrator } from '../src/agents/architect/graph/code/parallel/TaskOrchestrator';

// ════════════════════════════════════════════════════════════════════════════
// 1. JobTimingManager.resumeJob — pausedAt settlement
// ════════════════════════════════════════════════════════════════════════════

describe('JobTimingManager.resumeJob — pausedAt → totalPausedDuration', () => {
  it('returns timing untouched when pausedAt is absent', () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const input: JobTiming = { startedAt, totalPausedDuration: 0 };
    const { jobTiming } = JobTimingManager.resumeJob('job-1', input);
    expect(jobTiming?.pausedAt).toBeUndefined();
    expect(jobTiming?.totalPausedDuration).toBe(0);
    expect(jobTiming?.startedAt).toBe(startedAt);
  });

  it('settles pausedAt into totalPausedDuration and clears pausedAt', () => {
    const now = Date.now();
    const startedAt = new Date(now - 120_000).toISOString();
    // Job was paused 30s ago; after resume the pause window must be
    // accumulated into totalPausedDuration.
    const pausedAt = new Date(now - 30_000).toISOString();
    const input: JobTiming = { startedAt, pausedAt, totalPausedDuration: 5_000 };
    const { jobTiming } = JobTimingManager.resumeJob('job-1', input);
    expect(jobTiming?.pausedAt).toBeUndefined();
    expect(jobTiming?.lastResumedAt).toBeTruthy();
    // Should be at least the prior 5s + the ~30s pause window.
    expect(jobTiming?.totalPausedDuration ?? 0).toBeGreaterThanOrEqual(34_000);
    expect(jobTiming?.startedAt).toBe(startedAt);
  });

  it('returns undefined timing when called without sessionJobTiming', () => {
    const { jobTiming } = JobTimingManager.resumeJob('job-1', undefined);
    expect(jobTiming).toBeUndefined();
  });

  it('runner uses settled timing — UI elapsed formula no longer counts pause window', () => {
    // Simulates `(end - start - totalPaused)` after a 30s pause + 30s
    // additional active runtime. Without resumeJob, the formula returns
    // ~90s (counting the 30s pause as active). After settlement it
    // returns ~30s of active runtime + small drift from now-time.
    const now = Date.now();
    const startedAt = new Date(now - 90_000).toISOString();
    const pausedAt = new Date(now - 60_000).toISOString();
    const persisted: JobTiming = { startedAt, pausedAt, totalPausedDuration: 0 };
    const { jobTiming } = JobTimingManager.resumeJob('job-1', persisted);
    // Compute elapsed using the kanban formula at "now" — the pause
    // window must NOT count as active runtime.
    const elapsed = now - new Date(jobTiming!.startedAt).getTime() - jobTiming!.totalPausedDuration;
    // Expect ~30s (only pre-pause runtime); without the fix it would be ~90s.
    expect(elapsed).toBeGreaterThanOrEqual(28_000);
    expect(elapsed).toBeLessThan(35_000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Helpers for batchSplit tests
// ════════════════════════════════════════════════════════════════════════════

function makeStartedTask(over: Partial<CodeTask> = {}): CodeTask {
  // Tasks arriving at processDiagnosticBatchSplit have already been
  // through plan-entry → startTask, so they carry timing.startedAt.
  return TaskTimingHelper.startTask({
    id: 'task-1',
    name: 'Final Verification',
    type: 'verification',
    priority: 1000,
    ...over,
  } as CodeTask);
}

function makeState(over: Record<string, any> = {}): any {
  return {
    taskQueue: new TaskQueue<CodeTask>(),
    _batchSplitRequeued: false,
    context: { featurePath: undefined },
    _httpJobId: undefined,
    ...over,
  };
}

const BATCHED_PLAN = JSON.stringify({
  diagnostics: { totalErrors: 2 },
  implementation: { modify: [] },
  batches: [
    { name: 'fix a', rationale: 'remediate a', modify: ['a.ts'] },
    { name: 'fix b', rationale: 'remediate b', modify: ['b.ts'] },
  ],
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Path A (requeue-parent) — timing + token carry
// ════════════════════════════════════════════════════════════════════════════

describe('batchSplit Path A — requeue-parent timing + token carry', () => {
  it('requeued verification parent carries pausedAt timing (not undefined)', () => {
    const task = makeStartedTask({ type: 'verification' });
    const state = makeState({
      _currentTaskTokenUsage: {
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        callCount: 3,
      } satisfies TaskTokenUsage,
    });

    const out = processDiagnosticBatchSplit(state, BATCHED_PLAN, task);
    expect(out).toBe('');
    expect(state._batchSplitRequeued).toBe(true);

    const requeued = state.taskQueue
      .getAll()
      .find((t: any) => t.type === 'verification' && t.id === task.id);
    expect(requeued).toBeDefined();
    // Timing must be present (pre-fix bug: `timing: undefined` wiped carry).
    expect(requeued!.timing).toBeDefined();
    // pauseTask sets pausedAt = now.
    expect(requeued!.timing!.pausedAt).toBeTruthy();
    // startedAt must survive — losing it would orphan the parent's
    // pre-split runtime at the eventual completeTask.
    expect(requeued!.timing!.startedAt).toBe(task.timing!.startedAt);
  });

  it('requeued parent carries _currentTaskTokenUsage as task.tokenUsage stash', () => {
    const task = makeStartedTask({ type: 'verification' });
    const carriedUsage: TaskTokenUsage = {
      inputTokens: 4500,
      outputTokens: 800,
      totalTokens: 5300,
      cacheReadTokens: 1000,
      callCount: 7,
    };
    const state = makeState({ _currentTaskTokenUsage: carriedUsage });

    processDiagnosticBatchSplit(state, BATCHED_PLAN, task);

    const requeued = state.taskQueue.getAll().find((t: any) => t.id === task.id);
    expect(requeued).toBeDefined();
    expect(requeued!.tokenUsage).toEqual(carriedUsage);
    // Detach guarantee: the snapshot is a copy, not a live alias — a
    // post-stash mutation of `_currentTaskTokenUsage` must not bleed
    // back into the requeued task's stash.
    state._currentTaskTokenUsage.inputTokens = 99999;
    expect(requeued!.tokenUsage!.inputTokens).toBe(4500);
  });

  it('falls back to nextTask.tokenUsage when no in-flight token usage', () => {
    // Edge case: cycle 2+ where the parent was previously requeued with
    // `tokenUsage` set, then taken out, then split again before any LLM
    // call accumulated _currentTaskTokenUsage.
    const priorStash: TaskTokenUsage = {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      callCount: 1,
    };
    const task = makeStartedTask({ type: 'verification', tokenUsage: priorStash });
    const state = makeState({ _currentTaskTokenUsage: undefined });

    processDiagnosticBatchSplit(state, BATCHED_PLAN, task);

    const requeued = state.taskQueue.getAll().find((t: any) => t.id === task.id);
    expect(requeued?.tokenUsage).toEqual(priorStash);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Path B (drop-and-replace) — superseded snapshot
// ════════════════════════════════════════════════════════════════════════════

describe('batchSplit Path B — drop-and-replace superseded snapshot', () => {
  it('emits superseded parent with timing/token snapshot + supersededBy lineage', () => {
    const task = makeStartedTask({
      type: 'error',
      priority: 100,
      name: 'fix compile errors',
    });
    const usage: TaskTokenUsage = {
      inputTokens: 3000,
      outputTokens: 500,
      totalTokens: 3500,
      callCount: 4,
    };
    const state = makeState({ _currentTaskTokenUsage: usage });

    const out = processDiagnosticBatchSplit(state, BATCHED_PLAN, task);
    expect(out).toBe('');
    expect(state._batchSplitRequeued).toBe(true);

    const superseded = state._supersededByBatchSplit;
    expect(Array.isArray(superseded)).toBe(true);
    expect(superseded).toHaveLength(1);

    const parent = superseded[0];
    expect(parent.id).toBe(task.id);
    // completed:false — superseded entries must NOT be counted in the
    // "X / Y completed" tally (UI treats `supersededBy` truthy as the
    // distinguishing marker).
    expect(parent.completed).toBe(false);
    // supersededBy carries the spawned sub-task IDs (lineage trace).
    expect(Array.isArray(parent.supersededBy)).toBe(true);
    expect(parent.supersededBy.length).toBeGreaterThanOrEqual(2);
    // timing.elapsedTime + completedAt populated by completeTask.
    expect(parent.timing.completedAt).toBeTruthy();
    expect(typeof parent.timing.elapsedTime).toBe('number');
    expect(parent.timing.startedAt).toBe(task.timing!.startedAt);
    // tokenUsage snapshot preserved.
    expect(parent.tokenUsage).toEqual(usage);
  });

  it('does NOT push to state.completedTasks (string array stays untouched)', () => {
    const task = makeStartedTask({
      type: 'error',
      priority: 100,
      name: 'fix',
    });
    const state = makeState({
      _currentTaskTokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, callCount: 1 },
      completedTasks: ['previously-completed'],
    });

    processDiagnosticBatchSplit(state, BATCHED_PLAN, task);

    expect(state.completedTasks).toEqual(['previously-completed']);
    // Lineage record lives in the dedicated channel, NOT the count array.
    expect(state._supersededByBatchSplit).toHaveLength(1);
  });

  it('Path A re-queue does NOT populate _supersededByBatchSplit', () => {
    // Sanity guard — only Path B (drop-and-replace) emits superseded
    // entries. Path A (verification re-queue) keeps the parent alive in
    // the queue, so a superseded record would double-count.
    const task = makeStartedTask({ type: 'verification' });
    const state = makeState({
      _currentTaskTokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, callCount: 1 },
    });

    processDiagnosticBatchSplit(state, BATCHED_PLAN, task);

    expect(state._supersededByBatchSplit ?? []).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. TaskOrchestrator.reportBatchSplit — superseded merge into completedTasks
// ════════════════════════════════════════════════════════════════════════════

describe('TaskOrchestrator.reportBatchSplit — superseded propagation', () => {
  function buildOrchestrator(initialTasks: CodeTask[] = []) {
    const queue = new TaskQueue<CodeTask>();
    for (const t of initialTasks) queue.push(t);
    const orch = new TaskOrchestrator<CodeTask>(
      queue,
      // graphBuilder unused for this test — we never call run().
      (() => ({})) as any,
      {} as any,
      {},
      { maxWorkers: 1, checkpointInterval: 0 },
    );
    return orch;
  }

  function supersededFixture(over: Partial<BaseTask> = {}): BaseTask {
    return {
      id: 'parent-error-task',
      name: 'fix compile errors',
      type: 'error',
      priority: 100,
      completed: false,
      supersededBy: ['sub-1', 'sub-2'],
      timing: {
        startedAt: new Date(Date.now() - 30_000).toISOString(),
        completedAt: new Date().toISOString(),
        elapsedTime: 30_000,
        totalPausedDuration: 0,
      },
      tokenUsage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, callCount: 3 },
      ...over,
    };
  }

  it('appends superseded details to orchestrator.completedTasks', async () => {
    const orch = buildOrchestrator();
    const reQueuedTask: CodeTask = {
      id: 'fv-task',
      name: 'Final Verification',
      type: 'verification',
      priority: 1000,
    };

    expect(orch.getCompletedTasks()).toEqual([]);
    await orch.reportBatchSplit(0, reQueuedTask, [supersededFixture()]);

    const completed = orch.getCompletedTasks();
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe('parent-error-task');
    expect(completed[0].supersededBy).toEqual(['sub-1', 'sub-2']);
    expect(completed[0].completed).toBe(false);
    expect(completed[0].timing?.elapsedTime).toBe(30_000);
    expect(completed[0].tokenUsage?.totalTokens).toBe(1200);
  });

  it('skips duplicate superseded ids (defence-in-depth)', async () => {
    const orch = buildOrchestrator();
    const fv: CodeTask = { id: 'fv', name: 'fv', type: 'verification', priority: 1000 };
    await orch.reportBatchSplit(0, fv, [supersededFixture()]);
    await orch.reportBatchSplit(0, fv, [supersededFixture()]);
    expect(orch.getCompletedTasks()).toHaveLength(1);
  });

  it('does nothing when supersededDetails is undefined or empty (Path A path)', async () => {
    const orch = buildOrchestrator();
    const fv: CodeTask = { id: 'fv', name: 'fv', type: 'verification', priority: 1000 };
    await orch.reportBatchSplit(0, fv);
    await orch.reportBatchSplit(0, fv, []);
    expect(orch.getCompletedTasks()).toEqual([]);
  });

  it('getRealCompletedTaskIds excludes Path B superseded parents (string-ID array invariant)', async () => {
    // The string `state.completedTasks` array (post-orchestrator) MUST
    // exclude superseded parents to match the main graph invariant
    // where checkTaskStatus only pushes a parent's id on the success
    // path (never on batchSplit Path B). Inflating the string array
    // would shift downstream count consumers (resume logs, decompose
    // context, kanban tooltip's "X / Y" badge) toward double-counting.
    const orch = buildOrchestrator();
    // Real completion via reportCompletion.
    const realTask: CodeTask = {
      id: 'real-feature',
      name: 'feature x',
      type: 'feature',
      priority: 200,
      timing: { startedAt: new Date().toISOString(), totalPausedDuration: 0 },
    };
    await orch.reportCompletion(0, realTask);
    // Path B superseded parent via reportBatchSplit.
    const fv: CodeTask = { id: 'fv', name: 'fv', type: 'verification', priority: 1000 };
    await orch.reportBatchSplit(0, fv, [supersededFixture()]);

    const all = orch.getCompletedTasks();
    expect(all).toHaveLength(2);
    const ids = orch.getRealCompletedTaskIds();
    expect(ids).toEqual(['real-feature']);
    // Defence-in-depth: the superseded id MUST NOT leak through.
    expect(ids).not.toContain('parent-error-task');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. TaskOrchestrator.assignTask — pausedAt carry vs restart dispatch
// ════════════════════════════════════════════════════════════════════════════

describe('TaskOrchestrator.assignTask — pausedAt carry guard', () => {
  function buildOrchestrator(initialTasks: CodeTask[] = []) {
    const queue = new TaskQueue<CodeTask>();
    for (const t of initialTasks) queue.push(t);
    return new TaskOrchestrator<CodeTask>(
      queue,
      (() => ({})) as any,
      {} as any,
      {},
      { maxWorkers: 1, checkpointInterval: 0 },
    );
  }

  it('paused requeued task: startTask path preserves startedAt + accumulates pause window', async () => {
    const now = Date.now();
    // Task started 60s ago, then paused 10s ago by batchSplit Path A.
    const startedAt = new Date(now - 60_000).toISOString();
    const pausedAt = new Date(now - 10_000).toISOString();
    const requeued: CodeTask = {
      id: 'requeued-verification',
      name: 'Final Verification',
      type: 'verification',
      priority: 1000,
      timing: { startedAt, pausedAt, totalPausedDuration: 0 },
    };
    const orch = buildOrchestrator([requeued]);
    const assigned = await orch.requestTask(0);
    expect(assigned).toBeDefined();
    // startedAt MUST survive (pre-fix: restartTask wiped it).
    expect(assigned!.timing?.startedAt).toBe(startedAt);
    // pausedAt cleared, totalPausedDuration accumulated (~10s).
    expect(assigned!.timing?.pausedAt).toBeUndefined();
    expect(assigned!.timing?.totalPausedDuration ?? 0).toBeGreaterThanOrEqual(9_000);
    // resumedAt populated by startTask.
    expect(assigned!.timing?.resumedAt).toBeTruthy();
  });

  it('regular task without pausedAt: restartTask path resets timing (cumulative-elapsed regression guard)', async () => {
    const now = Date.now();
    // Stale startedAt from a prior failed attempt. restartTask is the
    // SSOT that resets it so re-assignments do not inflate elapsedTime.
    const stale = new Date(now - 600_000).toISOString();
    const fresh: CodeTask = {
      id: 'fresh-error-task',
      name: 'fix',
      type: 'error',
      priority: 50,
      timing: { startedAt: stale, totalPausedDuration: 0 },
    };
    const orch = buildOrchestrator([fresh]);
    const assigned = await orch.requestTask(0);
    expect(assigned).toBeDefined();
    // startedAt MUST be reset — accepting `stale` would attribute the
    // 10-minute idle gap as runtime at the eventual completeTask.
    expect(assigned!.timing?.startedAt).not.toBe(stale);
    expect(assigned!.timing?.totalPausedDuration).toBe(0);
    expect(new Date(assigned!.timing!.startedAt!).getTime()).toBeGreaterThanOrEqual(now);
  });

  it('first-time task without timing: restartTask path seeds fresh timing', async () => {
    const fresh: CodeTask = {
      id: 'first-task',
      name: 'setup',
      type: 'setup',
      priority: 200,
    };
    const orch = buildOrchestrator([fresh]);
    const assigned = await orch.requestTask(0);
    expect(assigned).toBeDefined();
    expect(assigned!.timing?.startedAt).toBeTruthy();
    expect(assigned!.timing?.totalPausedDuration).toBe(0);
    expect(assigned!.timing?.pausedAt).toBeUndefined();
  });
});
