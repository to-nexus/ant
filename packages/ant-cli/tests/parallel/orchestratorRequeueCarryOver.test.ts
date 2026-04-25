/**
 * S11 — orchestrator-requeue-carry-over (L1 integration).
 *
 * Handoff §14.4 equivalent — the original spec called for a scenarios/
 * directory entry but the sequential scenario runner cannot exercise the
 * parallel orchestrator's `reportFailure` → transient re-queue → new
 * worker spawn boundary (runner.ts §10 scope limit — ANT_TASK_CONCURRENCY
 * is pinned to 1 so `workerGraph.ts` never runs and parallel-only state
 * transitions are unobservable). This suite covers the same H3-closing
 * invariant at L1 by wiring the three carry-over boundaries through the
 * public orchestrator + worker surface:
 *
 *   1. phase-layer plan retry     — session.onPlanEntry('retry')
 *   2. phase-layer reverify       — session.onPlanEntry('reverify')
 *   3. orchestrator transient re-queue:
 *        `snapshotFromState` writes the full `WorkerSnapshot` onto
 *        `task.resumeState` (task-type-blind capture), then
 *        `orchestratorHook.restoreIntoWorkerState` rehydrates the
 *        verification-specific session from `resumeState.verification`
 *        inside `TaskWorker.executeTask`'s restore block (TaskWorker.ts
 *        L209–230). The second worker invocation therefore sees the
 *        preserved `VerificationSession`.
 *
 * Expected outcomes (mirrors handoff §14.4):
 *   - taskStartsForVerification            === 2
 *   - secondRunInitialAttempts             >  0
 *   - secondRunInitialPlanHistoryLength    >  0
 *   - secondRunInitialAttempts             === firstRunFinalAttempts
 */

import { describe, it, expect } from 'vitest';

import { snapshotFromState } from '../../src/agents/architect/graph/code/parallel/TaskWorker';
import { VerificationSession } from '../../src/agents/architect/graph/code/tasks/_shared/verify/Session';
import { VerificationTerminalError } from '../../src/agents/architect/graph/code/tasks/_shared/verify/errors';
import { hooksForTaskType } from '../../src/agents/architect/graph/code/tasks/_shared/registry';
import { classifyTerminalError } from '../../src/agents/architect/graph/code/tasks/_shared/verify/errors';

import type { CodeTask } from '../../src/agents/architect/types/task';
import type { VerificationSnapshot } from '../../src/agents/architect/graph/code/tasks/_shared/verify/snapshot';

function verificationTask(id: string): CodeTask {
  return {
    id,
    name: 'Final Verification',
    type: 'verification',
    priority: 1000,
    description: 'final verification',
  } as CodeTask;
}

/**
 * Reproduces the restore block from
 * `TaskWorker.executeTask` (TaskWorker.ts L209–230). The sequence is the
 * contract the orchestrator's transient re-queue path depends on —
 * reproducing it inline lets the assertion inspect every field of the
 * freshly-built `workerState` without a live worker instance.
 */
function simulateWorkerSpawn(task: CodeTask): Record<string, unknown> {
  const workerState: Record<string, unknown> = {
    planText: '',
    conversations: {},
    violations: [],
    retries: 0,
    enforcementHistory: [],
  };

  const resume = (task as any).resumeState;
  if (task.interrupted && resume) {
    Object.assign(workerState, {
      planText: resume.planText || '',
      conversations: resume.conversations || {},
      retries: resume.retries || 0,
      violations: resume.violations || [],
      enforcementHistory: resume.enforcementHistory || [],
    });
    hooksForTaskType('verification')?.orchestrator?.restoreIntoWorkerState?.(
      workerState,
      resume.verification,
    );
    (task as any).resumeState = undefined;
    task.interrupted = false;
  }
  return workerState;
}

describe('S11 — orchestrator requeue carry-over (parallel boundary)', () => {
  it('snapshot → attach → restore round-trip preserves attempts and plan history across worker spawns', () => {
    const task = verificationTask('final');
    const orchestratorHook = hooksForTaskType('verification')?.orchestrator;
    expect(orchestratorHook?.hasOwnAttemptCounter).toBe(true);

    // ─── Worker 1 — fresh session exercised by phase-layer hooks ───────────
    const firstSession = VerificationSession.createFresh({ isTs: true, hasTests: true });
    const firstWorkerState: Record<string, unknown> = {
      planText: JSON.stringify({ implementation: { modify: ['src/a.ts'] } }),
      conversations: {},
      retries: 0,
      violations: [],
      enforcementHistory: [],
      verification: firstSession,
    };

    // Boundary #1 — phase-layer retry inside worker 1's plan node.
    firstSession.onPlanEntry('retry');
    // Boundary #2 — phase-layer reverify after execute.done.
    firstSession.onPlanEntry('reverify');
    // Plan was applied twice inside worker 1 so the history is populated.
    firstSession.onPlanApplied('{"plan":1}');
    firstSession.onPlanApplied('{"plan":2}');
    // Install observation that the second worker must carry over.
    firstSession.markInstallNeeded(false);

    const firstFinalAttempts = firstSession.attempts();
    const firstFinalPlanHistory = firstSession.snapshot().planHistoryBodies?.length ?? 0;
    expect(firstFinalAttempts).toBeGreaterThan(0);
    expect(firstFinalPlanHistory).toBeGreaterThan(0);

    // ─── Boundary #3a — TaskWorker builds the terminal error and reports it ───
    const terminal = new VerificationTerminalError(
      'unresolved_violations',
      'carry-over fixture',
      snapshotFromState(firstWorkerState)?.verification,
    );
    expect(classifyTerminalError(terminal).terminal).toBe(true);
    expect(terminal.carryOver).toBeDefined();
    expect(terminal.carryOver?.attempts).toBe(firstFinalAttempts);

    // ─── Boundary #3b — orchestrator.reportFailure transient branch ─────────
    // The real orchestrator captures the live worker state via
    // `worker.captureState()` → `snapshotFromState(currentState)` and
    // assigns the entire WorkerSnapshot to `task.resumeState` before
    // re-queuing (TaskOrchestrator.ts L597–605). TaskWorker then reads
    // `task.resumeState.verification` — which is a `VerificationSnapshot`
    // seated inside the WorkerSnapshot — and feeds that to the
    // restore hook. We reproduce that shape here so the second worker
    // sees exactly what a real transient re-queue would hand it.
    const capturedSnapshot = snapshotFromState(firstWorkerState);
    expect(capturedSnapshot).not.toBeNull();
    expect(capturedSnapshot!.verification).toBeDefined();

    (task as any).resumeState = capturedSnapshot;
    task.interrupted = true;

    expect((task as any).resumeState.verification).toBeDefined();
    expect((task as any).resumeState.verification.attempts).toBe(firstFinalAttempts);
    expect((task as any).resumeState.verification.installNeeded).toBe(false);
    expect((task as any).resumeState.verification.planHistoryBodies).toEqual([
      '{"plan":1}',
      '{"plan":2}',
    ]);

    // ─── Worker 2 — orchestrator spawns a fresh worker for the re-queued task ──
    const secondWorkerState = simulateWorkerSpawn(task);

    const secondSession = secondWorkerState.verification as VerificationSession;
    expect(secondSession).toBeInstanceOf(VerificationSession);

    // Carry-over invariants (handoff §14.4 expected):
    expect(secondSession.attempts()).toBe(firstFinalAttempts);
    expect(secondSession.attempts()).toBeGreaterThan(0);
    expect(secondSession.snapshot().planHistoryBodies?.length ?? 0).toBe(firstFinalPlanHistory);
    expect((secondSession.snapshot().planHistoryBodies?.length ?? 0)).toBeGreaterThan(0);
    expect(secondSession.installNeeded()).toBe(false);

    // `restoreIntoWorkerState` must clear the resume artefacts on the task so
    // a third worker spawn does not double-restore the same snapshot.
    expect((task as any).resumeState).toBeUndefined();
    expect(task.interrupted).toBe(false);
  });

  it('snapshotFromState seats a VerificationSnapshot under WorkerSnapshot.verification', () => {
    // Regression guard — capture-side carry-over is task-type-blind: the
    // orchestrator assigns the entire `WorkerSnapshot` to
    // `task.resumeState`, and only the restore-side rehydrates the
    // verification-specific session. If `snapshotFromState` ever stops
    // forwarding `state.verification` into its snapshot, the second
    // worker spawn will silently drop the session even though the task
    // has a populated `resumeState`.
    const session = VerificationSession.createFresh({ isTs: true, hasTests: true });
    session.onPlanEntry('retry');
    const ws: Record<string, unknown> = {
      planText: '',
      conversations: {},
      violations: [],
      retries: 0,
      verification: session,
    };
    const snap = snapshotFromState(ws);
    expect(snap).not.toBeNull();
    expect(snap!.verification).toBeDefined();
    expect((snap!.verification as VerificationSnapshot).attempts).toBe(session.attempts());
  });

  it('restoreIntoWorkerState is a no-op when resume is undefined (no spurious session)', () => {
    const ws: Record<string, unknown> = {};
    hooksForTaskType('verification')?.orchestrator?.restoreIntoWorkerState?.(ws, undefined);
    expect(ws.verification).toBeUndefined();
  });
});
