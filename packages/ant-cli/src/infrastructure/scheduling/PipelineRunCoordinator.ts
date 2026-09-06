/**
 * PipelineRunCoordinator — owns every pipeline-run side effect: fire → run
 * creation, step dispatch (through the SAME UniversalDispatchService +
 * UniversalDispatchGate the HTTP route uses — gate bypass is structurally
 * impossible), gate arming (durable choice card + delayed timeout arm, no
 * polling sweeps), chain advance on `job:status:updates`, run JSONL append,
 * Redis projections, and SSE fan-out.
 *
 * Concurrency: every run mutation happens under `ant:lock:pipe-run:{runId}`
 * (all replicas receive pub/sub events; the lock serializes them). The pure
 * DAG math lives in `core/pipelines/ChainExecutor` — this class is I/O glue.
 *
 * Approval funnel: every channel resolves through ChatService's
 * choice-resolved path (NX idempotency, one audit line); the chat route and
 * the pipelines approval route then call `applyResolvedGate`. The timeout arm
 * funnels through the same `appendChoiceResolved` so a racing human click and
 * a timeout can never both win.
 *
 * Clarify funnel: a step job that seals `awaitingClarify` parks the step
 * `awaiting_clarify` (open-ended — no timeout arm). The answer arrives via
 * `applyClarifyAnswer` (chat clarify-card branch or the pipelines clarify
 * route), which re-dispatches the SAME step with the answer as its directive;
 * the universal runner's dangling-tool_use detection makes the new job a
 * structural resume (jobId re-pointing, `ant:pipe:job:{jobId}` re-keyed).
 */

import type { GateDecision, PipelinePendingApproval, RunRecord } from '@ant/shared';
import type { PipelineControlJobData, PipelineOwner } from '../../core/ports/scheduler';
import { REDIS_CHANNELS } from '../../core/constants/redis';
import { logger } from '../../utils/logger';
import { COMPONENT, type PipelineCoordinatorDeps, type PipelineRunOps } from './pipelineRun/types';
import { handleFire } from './pipelineRun/fire';
import { dispatchJobStep, executeDispatches, handleStepRetry } from './pipelineRun/dispatch';
import { failStepOrRetry, handleJobStatusUpdate, handleOutcomeRetry, handleStepTimeout } from './pipelineRun/outcome';
import { applyClarifyAnswer, enterAwaitingClarify, enterAwaitingToolApproval } from './pipelineRun/hitl';
import { applyResolvedGate, armGate, handleGateRemind, handleGateTimeout } from './pipelineRun/gates';
import { applyOutcome, cancelRun, deactivate, finalizeRun, killStepJob } from './pipelineRun/lifecycle';
import {
  getActiveRunId,
  getHitlByGateId,
  getRun,
  listPendingApprovals,
  readRunFromDisk,
} from './pipelineRun/runStore';

export type { PipelineCoordinatorDeps } from './pipelineRun/types';

export class PipelineRunCoordinator {
  private readonly ctx: PipelineRunOps;

  constructor(private readonly deps: PipelineCoordinatorDeps) {
    this.ctx = {
      deps,
      executeDispatches: (owner, def, run, dispatches) => executeDispatches(this.ctx, owner, def, run, dispatches),
      dispatchJobStep: (owner, def, run, step, retries, directiveOverride, approvalGrantTool) =>
        dispatchJobStep(this.ctx, owner, def, run, step, retries, directiveOverride, approvalGrantTool),
      armGate: (owner, def, run, step) => armGate(this.ctx, owner, def, run, step),
      applyOutcome: (owner, runId, stepId, outcome, patch, decorate, expectedJobId, onOutcomeLanded) =>
        applyOutcome(this.ctx, owner, runId, stepId, outcome, patch, decorate, expectedJobId, onOutcomeLanded),
      failStepOrRetry: (owner, runId, stepId, error, expectedJobId, opts) =>
        failStepOrRetry(this.ctx, owner, runId, stepId, error, expectedJobId, opts),
      finalizeRun: (owner, run) => finalizeRun(this.ctx, owner, run),
      killStepJob: (jobId, projectId) => killStepJob(this.ctx, jobId, projectId),
      enterAwaitingClarify: (data) => enterAwaitingClarify(this.ctx, data),
      enterAwaitingToolApproval: (data) => enterAwaitingToolApproval(this.ctx, data),
    };
  }

  /** Subscribe the status-update consumer. Call once per process. */
  async start(): Promise<void> {
    await this.deps.stateStore.subscribe(
      REDIS_CHANNELS.API_SERVER.JOB_STATUS_UPDATES,
      async (message: unknown) => {
        try {
          await handleJobStatusUpdate(this.ctx, message as any);
        } catch (err) {
          logger.warn('[Pipeline] status-update handling failed', { component: COMPONENT }, err);
        }
      },
    );
  }

  // ============================================
  // Control-job entry (fire / gate-timeout / step-retry)
  // ============================================

  async handleControlJob(data: PipelineControlJobData, intendedFireAt: number): Promise<void> {
    switch (data.kind) {
      case 'fire':
        return handleFire(this.ctx, data, intendedFireAt);
      case 'gate-timeout':
        return handleGateTimeout(this.ctx, data.gateId);
      case 'gate-remind':
        return handleGateRemind(this.ctx, data);
      case 'step-retry':
        return handleStepRetry(this.ctx, data.owner, data.runId, data.stepId, data.retries, data.directiveOverride);
      case 'step-timeout':
        return handleStepTimeout(this.ctx, data);
      case 'outcome-retry':
        return handleOutcomeRetry(this.ctx, data);
      case 'clarify-enter':
        return enterAwaitingClarify(this.ctx, data);
      case 'approval-enter':
        return enterAwaitingToolApproval(this.ctx, data);
      default:
        logger.warn(`[Pipeline] unknown control job kind: ${(data as any).kind}`, { component: COMPONENT });
    }
  }

  // ============================================
  // HITL resolution funnels + run control (delegators — mechanics live in
  // pipelineRun/{gates,hitl,lifecycle}.ts)
  // ============================================

  /**
   * Gate resolution — called AFTER ChatService's NX-guarded choice-resolved
   * succeeded (chat route branch, approvals route, or the timeout arm).
   */
  async applyResolvedGate(cardId: string, decision: GateDecision, decidedBy: string | undefined, via: 'in-app' | 'api'): Promise<boolean> {
    return applyResolvedGate(this.ctx, cardId, decision, decidedBy, via);
  }

  /**
   * Clarify answer funnel — chat clarify-card branch (in-app) and the
   * pipelines clarify route (inbox/API).
   */
  async applyClarifyAnswer(params: { jobId: string; answer: string; answeredBy?: string; via: 'in-app' | 'api' }): Promise<boolean> {
    return applyClarifyAnswer(this.ctx, params);
  }

  /** Cancel a live run — the ONE kill/stop authority for its step jobs. */
  async cancelRun(owner: PipelineOwner, runId: string): Promise<boolean> {
    return cancelRun(this.ctx, owner, runId);
  }

  /** Deactivation side effect owned by the coordinator: cancel the live run. */
  async deactivate(owner: PipelineOwner, projectId: string): Promise<void> {
    return deactivate(this.ctx, owner, projectId);
  }

  // ============================================
  // Run queries for the HTTP surface (delegators — the persistence/locking
  // kernel lives in pipelineRun/runStore.ts)
  // ============================================

  async getRun(runId: string): Promise<RunRecord | null> {
    return getRun(this.deps, runId);
  }

  /** Disk fallback for terminal runs whose projection has expired. */
  readRunFromDisk(owner: PipelineOwner, projectId: string, runId: string): RunRecord | null {
    return readRunFromDisk(this.deps, owner, projectId, runId);
  }

  /** Overlap-guard holder for one ACTIVATION (projectId-keyed). */
  async getActiveRunId(owner: PipelineOwner, projectId: string): Promise<string | null> {
    return getActiveRunId(this.deps, owner, projectId);
  }

  /** Pending gates across the caller's own activations (disk-derived scan). */
  async listPendingApprovals(owner: PipelineOwner): Promise<PipelinePendingApproval[]> {
    return listPendingApprovals(this.deps, owner);
  }

  async getHitlByGateId(gateId: string): Promise<{ cardId: string; anchorJobId: string; owner: PipelineOwner; runId: string } | null> {
    return getHitlByGateId(this.deps, gateId);
  }
}
