/**
 * vast-curling-perch RCA — when a code job is paused with `tasks_failed`
 * (or `recursion_limit`) and persisted, the failed tasks'
 * VerificationBudget task-owned axes (`batchSplitCount`,
 * `_failedAttempts`) MUST be reset to 0 in EVERY persisted shape so the
 * next user-resume gets a fresh budget.
 *
 * Initial fix patched only 2 of the 3 writers in the persistence path,
 * which let the third writer (`onCheckpoint` callback) re-leak the stale
 * counter into the Redis checkpoint snapshot. `JobCleanupManager` then
 * read Redis as the parallel-mode SSOT and overwrote the session file
 * with the stale value — see [JobCleanupManager.ts] §"Parallel-mode SSOT"
 * (`Using Redis ${sourceLabel} as parallel-mode SSOT`). Result: 4
 * consecutive resumes all failed at `splitCount: 11`.
 *
 * Definitive fix: a single SSOT helper `buildResumableFailedTask` that
 * every persistence writer routes through. This test:
 *
 *   1. Unit-tests the helper directly (input stale → output reset).
 *   2. Locks the wiring — every `failedAsQueue.map(...)` in graph.ts
 *      must call the helper, never reconstruct the shape inline.
 *   3. Locks the `still-lacing-north` boundary — Path A re-queue inside
 *      `batchSplit/process.ts` MUST NOT use the helper / a bare `: 0`
 *      reset (in-session re-queue intentionally preserves the counter).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { CodeTask } from '../../src/agents/architect/types/task';
import {
  buildResumableFailedTask,
  normalizeResumedQueueBudgets,
} from '../../src/agents/architect/graph/code/parallel/resumeBudgetReset';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GRAPH_PATH = resolve(
  __dirname,
  '../../src/agents/architect/graph/code/graph.ts',
);
const BATCH_SPLIT_PATH = resolve(
  __dirname,
  '../../src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts',
);
const RUNNER_PATH = resolve(
  __dirname,
  '../../src/agents/architect/graph/code/runner.ts',
);
const ORCHESTRATOR_PATH = resolve(
  __dirname,
  '../../src/agents/architect/graph/code/parallel/TaskOrchestrator.ts',
);

const graphSource = readFileSync(GRAPH_PATH, 'utf8');
const batchSplitSource = readFileSync(BATCH_SPLIT_PATH, 'utf8');
const runnerSource = readFileSync(RUNNER_PATH, 'utf8');
const orchestratorSource = readFileSync(ORCHESTRATOR_PATH, 'utf8');

describe('buildResumableFailedTask — unit (vast-curling-perch RCA helper)', () => {
  // Stale input shape — task that has consumed the full verification
  // budget on the previous run. The helper MUST overwrite both axes.
  const staleTask = {
    id: 'verification',
    name: 'Build & Type Verification',
    type: 'verification',
    priority: 1000,
    techTiers: [{ stack: 'frontend', framework: 'nextjs' } as any],
    batchSplitCount: 11,
    _failedAttempts: 2,
    resumeState: {
      planText: 'previous diagnostic plan',
      conversations: { plan: [{ role: 'user', content: 'x' }] },
    },
  } as unknown as CodeTask;

  it('overwrites stale batchSplitCount to 0', () => {
    const out = buildResumableFailedTask(staleTask, 'cycle limit');
    expect((out as any).batchSplitCount).toBe(0);
  });

  it('overwrites stale _failedAttempts to 0', () => {
    const out = buildResumableFailedTask(staleTask, 'cycle limit');
    expect((out as any)._failedAttempts).toBe(0);
  });

  it('attaches the failure markers used by UI + resume path', () => {
    const out = buildResumableFailedTask(staleTask, 'cycle limit msg');
    expect((out as any).interrupted).toBe(true);
    expect((out as any)._failed).toBe(true);
    expect((out as any)._failureReason).toBe('cycle limit msg');
  });

  it('preserves the rest of the task shape (id / name / type / priority / techTiers / resumeState)', () => {
    const out = buildResumableFailedTask(staleTask, 'msg');
    expect(out.id).toBe('verification');
    expect(out.name).toBe('Build & Type Verification');
    expect(out.type).toBe('verification');
    expect(out.priority).toBe(1000);
    expect(out.techTiers).toEqual(staleTask.techTiers);
    expect(out.resumeState).toEqual(staleTask.resumeState);
  });

  it('does not mutate the input task (returns a new object)', () => {
    const out = buildResumableFailedTask(staleTask, 'msg');
    expect(out).not.toBe(staleTask);
    // Stale source untouched — guards against accidental shared mutation
    // through the orchestrator's in-memory failedTasks array.
    expect((staleTask as any).batchSplitCount).toBe(11);
    expect((staleTask as any)._failedAttempts).toBe(2);
  });

  it('handles a fresh task without any budget axes (undefined → 0)', () => {
    const fresh = {
      id: 't1',
      name: 'fresh',
      type: 'feature',
      priority: 100,
    } as unknown as CodeTask;
    const out = buildResumableFailedTask(fresh, 'err');
    expect((out as any).batchSplitCount).toBe(0);
    expect((out as any)._failedAttempts).toBe(0);
  });
});

describe('graph.ts wiring — every failedAsQueue mapping routes through the helper (vast-curling-perch RCA)', () => {
  it('imports buildResumableFailedTask from parallel/resumeBudgetReset', () => {
    expect(graphSource).toMatch(
      /import\s*\{\s*buildResumableFailedTask\s*\}\s*from\s*["']\.\/parallel\/resumeBudgetReset["']/,
    );
  });

  it('every failedAsQueue.map binding calls the helper (no inline reconstruction)', () => {
    // Surface every binding so the count drifts loudly if a future
    // writer is added without routing through the helper.
    const bindings = [
      ...graphSource.matchAll(/const\s+failedAsQueue\s*=\s*[\s\S]*?;\s*\n/g),
    ].map(m => m[0]);
    expect(bindings.length).toBeGreaterThanOrEqual(3);
    for (const block of bindings) {
      expect(block).toMatch(/buildResumableFailedTask\(\s*f\.task[^,]*,\s*f\.error\.message\s*\)/);
    }
  });

  it('no inline batchSplitCount / _failedAttempts reset literals leaked into graph.ts', () => {
    // Helper-bypass guard: a future maintainer who reconstructs the
    // shape inline (e.g. `batchSplitCount: 0` next to a fresh
    // `failedAsQueue.map`) breaks the SSOT contract — every writer must
    // route through `buildResumableFailedTask`.
    expect(graphSource).not.toMatch(/batchSplitCount:\s*0\b/);
    expect(graphSource).not.toMatch(/_failedAttempts:\s*0\b/);
  });
});

describe('normalizeResumedQueueBudgets — load-side safety net unit', () => {
  // Strict trigger: only `_failed === true` resets. `interrupted: true`
  // alone covers mid-run pauses (recursion_limit / user_stopped) where
  // budgets MUST survive the boundary so the orchestrator's retry
  // logic stays sane.
  const failedTask = {
    id: 'verification',
    name: 'Build & Type Verification',
    type: 'verification',
    priority: 1000,
    interrupted: true,
    _failed: true,
    _failureReason: 'Batch split cycle limit (10) exceeded',
    batchSplitCount: 11,
    _failedAttempts: 2,
  } as unknown as CodeTask;

  const interruptedOnlyTask = {
    id: 'feature-a',
    name: 'Feature A',
    type: 'feature',
    priority: 100,
    interrupted: true,
    batchSplitCount: 5,
    _failedAttempts: 1,
  } as unknown as CodeTask;

  const cleanTask = {
    id: 'feature-b',
    name: 'Feature B',
    type: 'feature',
    priority: 100,
  } as unknown as CodeTask;

  it('resets batchSplitCount to 0 on tasks with _failed: true', () => {
    const [out] = normalizeResumedQueueBudgets([failedTask]);
    expect((out as any).batchSplitCount).toBe(0);
  });

  it('resets _failedAttempts to 0 on tasks with _failed: true', () => {
    const [out] = normalizeResumedQueueBudgets([failedTask]);
    expect((out as any)._failedAttempts).toBe(0);
  });

  it('preserves the rest of the failed task shape (markers + identity)', () => {
    const [out] = normalizeResumedQueueBudgets([failedTask]);
    expect(out.id).toBe('verification');
    expect((out as any).interrupted).toBe(true);
    expect((out as any)._failed).toBe(true);
    expect((out as any)._failureReason).toBe('Batch split cycle limit (10) exceeded');
  });

  it('does NOT reset interrupted-only tasks (recursion_limit / user_stopped boundary)', () => {
    // Critical invariant: in-progress pause must preserve the budget so
    // resume can continue from the same retry position. Resetting here
    // would silently re-issue the verification budget mid-run.
    const [out] = normalizeResumedQueueBudgets([interruptedOnlyTask]);
    expect((out as any).batchSplitCount).toBe(5);
    expect((out as any)._failedAttempts).toBe(1);
  });

  it('passes through clean tasks unchanged (no _failed marker, no budget axes)', () => {
    const [out] = normalizeResumedQueueBudgets([cleanTask]);
    expect(out).toEqual(cleanTask);
    expect((out as any).batchSplitCount).toBeUndefined();
    expect((out as any)._failedAttempts).toBeUndefined();
  });

  it('handles mixed queues — only _failed tasks are mutated', () => {
    const out = normalizeResumedQueueBudgets([failedTask, interruptedOnlyTask, cleanTask]);
    expect(out).toHaveLength(3);
    expect((out[0] as any).batchSplitCount).toBe(0);
    expect((out[1] as any).batchSplitCount).toBe(5);
    expect((out[2] as any).batchSplitCount).toBeUndefined();
  });

  it('is idempotent (applying twice is a no-op)', () => {
    const once = normalizeResumedQueueBudgets([failedTask]);
    const twice = normalizeResumedQueueBudgets(once);
    expect(twice[0]).toEqual(once[0]);
  });

  it('does not mutate the input array or task objects', () => {
    const inputs = [failedTask];
    normalizeResumedQueueBudgets(inputs);
    expect((failedTask as any).batchSplitCount).toBe(11);
    expect((failedTask as any)._failedAttempts).toBe(2);
    expect(inputs).toHaveLength(1);
  });

  it('handles empty queue', () => {
    expect(normalizeResumedQueueBudgets([])).toEqual([]);
  });
});

describe('runner.ts wiring — resume-load passes session.taskQueue through normalizeResumedQueueBudgets', () => {
  it('imports normalizeResumedQueueBudgets from parallel/resumeBudgetReset', () => {
    expect(runnerSource).toMatch(
      /import\s*\{\s*normalizeResumedQueueBudgets\s*\}\s*from\s*["']\.\/parallel\/resumeBudgetReset["']/,
    );
  });

  it('every TaskQueue.from(session.state.taskQueue) call routes through the normalizer', () => {
    // Both load sites (primary resume + recursion-error restore) must
    // normalize. Surface every binding so future load sites cannot be
    // added without the safety net (vast-curling-perch RCA).
    const rawLoads = [
      ...runnerSource.matchAll(/TaskQueue\.from<CodeTask>\([^)]*session\.state\.taskQueue[^)]*\)/g),
    ];
    expect(rawLoads.length).toBe(0);
    const normalizedLoads = [
      ...runnerSource.matchAll(
        /TaskQueue\.from<CodeTask>\(\s*normalizeResumedQueueBudgets\(/g,
      ),
    ];
    expect(normalizedLoads.length).toBeGreaterThanOrEqual(2);
  });
});

describe('TaskOrchestrator.broadcastKanban — 6th writer routes through helper (LIVE Redis snapshot)', () => {
  it('imports buildResumableFailedTask from ./resumeBudgetReset', () => {
    expect(orchestratorSource).toMatch(
      /import\s*\{\s*buildResumableFailedTask\s*\}\s*from\s*["']\.\/resumeBudgetReset["']/,
    );
  });

  it('broadcastKanban method body uses the helper instead of inline {...f.task, _failed: true}', () => {
    // Locate the broadcastKanban method DEFINITION (not a call site).
    // The failedAsQueue map inside MUST call buildResumableFailedTask —
    // not reconstruct the shape inline. Inline reconstruction leaks
    // stale VerificationBudget axes into the LIVE Kanban Redis
    // snapshot, which JCM reads as a fallback when the checkpoint key
    // is absent.
    const methodMatch = orchestratorSource.match(
      /private\s+broadcastKanban\s*\(\s*\)\s*:\s*void\s*\{([\s\S]*?)\n  \}/,
    );
    expect(methodMatch).not.toBeNull();
    const body = methodMatch![1];
    expect(body).toMatch(/buildResumableFailedTask\(/);
    // Defensive guard: the inline shape MUST be gone from broadcastKanban.
    expect(body).not.toMatch(/\.\.\.f\.task,\s*\n\s*_failed:\s*true,?\s*\n\s*\}\)\)/);
  });
});

describe('Path A still-lacing-north invariant — in-session re-queue MUST NOT reset (preserved)', () => {
  it('Path A re-queue preserves batchSplitCount via newBatchSplitCount', () => {
    // The Path A branch is identifiable by the `requeue-parent` literal.
    const requeueIdx = batchSplitSource.indexOf("'requeue-parent'");
    expect(requeueIdx).toBeGreaterThan(0);
    // Walk forward to the requeuedTask object; its batchSplitCount must
    // bind to `newBatchSplitCount` (the bumped value), not 0.
    const slice = batchSplitSource.slice(requeueIdx, requeueIdx + 1500);
    expect(slice).toMatch(/batchSplitCount:\s*newBatchSplitCount\b/);
    // Defence: the cross-resume `: 0` reset literal must not have leaked
    // into the in-session re-queue site (still-lacing-north regression
    // signature — full retry budget re-issued every cycle → infinite
    // re-try loop).
    expect(slice).not.toMatch(/batchSplitCount:\s*0\b/);
  });

  it('batchSplit/process.ts does not import the resume helper (boundary stays distinct)', () => {
    // Routing the in-session re-queue through the cross-resume helper
    // would re-introduce still-lacing-north. Lock the import boundary.
    expect(batchSplitSource).not.toMatch(/buildResumableFailedTask/);
    expect(batchSplitSource).not.toMatch(/resumeBudgetReset/);
  });
});
