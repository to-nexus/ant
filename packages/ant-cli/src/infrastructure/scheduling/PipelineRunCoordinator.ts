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

import {
  isApprovalStep,
  parsePipelineDuration,
  MAX_GATE_REMINDERS,
  UNIVERSAL_FEATURE,
  type ApprovalStepDef,
  type GateDecision,
  type PipelineDef,
  type PipelinePendingApproval,
  type RunRecord,
  type StepRecord,
} from '@ant/shared';
import type {
  PipelineControlJobData,
  PipelineGateRemindJobData,
  PipelineOwner,
} from '../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL, REDIS_CHANNELS } from '../../core/constants/redis';
import { logger } from '../../utils/logger';
import { applyStepOutcome, deriveRunStatus, effectiveNeeds } from '../../core/pipelines/ChainExecutor';
import { deriveActivationsRoot } from '../../core/pipelines/paths';
import { resolveDefRoot } from '../../core/pipelines/scopeRoots';
import {
  appendRunIndex,
  listAccountActivations,
  loadActivationByProject,
  loadAvailability,
  loadPipeline,
} from '../../core/pipelines/store';
import {
  COMPONENT,
  type HitlRecord,
  type PipelineCoordinatorDeps,
  type PipelineRunOps,
} from './pipelineRun/types';
import { handleFire } from './pipelineRun/fire';
import { dispatchJobStep, executeDispatches, handleStepRetry } from './pipelineRun/dispatch';
import { failStepOrRetry, handleJobStatusUpdate, handleOutcomeRetry, handleStepTimeout } from './pipelineRun/outcome';
import { applyClarifyAnswer, enterAwaitingClarify, enterAwaitingToolApproval } from './pipelineRun/hitl';
import {
  appendEvent,
  getActiveRunId,
  getHitlByGateId,
  getRun,
  isTerminal,
  listPendingApprovals,
  mutateRun,
  publicRun,
  publish,
  readRunFromDisk,
  saveRun,
  tenantCtx,
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
      armGate: (owner, def, run, step) => this.armGate(owner, def, run, step),
      applyOutcome: (owner, runId, stepId, outcome, patch, decorate, expectedJobId, onOutcomeLanded) =>
        this.applyOutcome(owner, runId, stepId, outcome, patch, decorate, expectedJobId, onOutcomeLanded),
      failStepOrRetry: (owner, runId, stepId, error, expectedJobId, opts) =>
        failStepOrRetry(this.ctx, owner, runId, stepId, error, expectedJobId, opts),
      finalizeRun: (owner, run) => this.finalizeRun(owner, run),
      killStepJob: (jobId, projectId) => this.killStepJob(jobId, projectId),
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
        return this.handleGateTimeout(data.gateId);
      case 'gate-remind':
        return this.handleGateRemind(data);
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
  // Gates (HITL)
  // ============================================

  private async armGate(
    owner: PipelineOwner,
    def: PipelineDef,
    run: RunRecord,
    step: ApprovalStepDef,
  ): Promise<void> {
    const pipelineId = run.pipelineId;
    const gateId = `gate-${run.runId}-${step.id}`;
    const cardId = `pipe-${gateId}`;
    const anchorJobId = this.findAnchorJobId(def, run, step.id);
    const timeoutMs = step.timeout ? parsePipelineDuration(step.timeout.after) : null;
    const timeoutAt = timeoutMs ? new Date(Date.now() + timeoutMs).toISOString() : undefined;

    if (!anchorJobId) {
      await this.applyOutcome(owner, run.runId, step.id, 'failed', { error: 'gate-has-no-anchor-job' });
      return;
    }

    const hitl: HitlRecord = {
      gateId,
      cardId,
      runId: run.runId,
      stepId: step.id,
      pipelineId,
      projectId: run.projectId,
      owner,
      onTimeout: step.timeout?.onTimeout ?? 'reject',
      timeoutAt,
      anchorJobId,
      prompt: step.prompt,
    };
    await this.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.HITL(gateId), JSON.stringify(hitl), REDIS_TTL.PIPE.HITL);
    await this.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.CARD(cardId), gateId, REDIS_TTL.PIPE.HITL);

    await mutateRun(this.deps, owner, run.runId, async (live) => {
      const steps = live.steps.map((s): StepRecord =>
        s.stepId === step.id
          ? {
              ...s,
              status: 'awaiting_gate',
              startedAt: new Date().toISOString(),
              gate: { gateId, cardId, prompt: step.prompt, armedAt: new Date().toISOString(), timeoutAt, onTimeout: hitl.onTimeout },
            }
          : s,
      );
      return { run: { ...live, steps }, dispatches: [] };
    });

    // Durable in-app card on the universal session (server-side writer —
    // resume_confirm precedent; ChatAPIClient is job-runner-child-only).
    if (this.deps.chatService) {
      try {
        await this.deps.chatService.appendChoicePresented(run.projectId, UNIVERSAL_FEATURE, {
          jobId: anchorJobId,
          cardId,
          cardType: 'pipeline_approval',
          prompt: step.prompt,
          payload: {
            gateId,
            runId: run.runId,
            stepId: step.id,
            pipelineId,
            pipelineName: def.name,
            ...(timeoutAt && { timeoutAt, onTimeout: hitl.onTimeout }),
          },
          userContext: owner,
        });
      } catch (e) {
        logger.warn(`[Pipeline] failed to present gate card ${cardId}`, { component: COMPONENT }, e);
      }
    }

    if (timeoutMs) {
      await this.deps.scheduleQueue.armDelayed(`gto-${gateId}`, timeoutMs, {
        kind: 'gate-timeout',
        owner,
        pipelineId,
        projectId: run.projectId,
        runId: run.runId,
        stepId: step.id,
        gateId,
      });
    }
    const remindMs = parsePipelineDuration(step.remindAfter);
    if (remindMs) {
      await this.deps.scheduleQueue.armDelayed(`gre-${gateId}`, remindMs, {
        kind: 'gate-remind',
        owner,
        pipelineId,
        projectId: run.projectId,
        runId: run.runId,
        stepId: step.id,
        gateId,
        reminders: 0,
      });
    }

    await appendEvent(this.deps, owner, run.projectId, {
      ts: new Date().toISOString(),
      event: 'awaiting_human',
      runId: run.runId,
      stepId: step.id,
      gateId,
    });
    await publish(this.deps, owner, {
      cause: 'approvalRequested',
      projectId: run.projectId,
      approval: {
        gateId,
        cardId,
        runId: run.runId,
        pipelineId,
        pipelineName: def.name,
        projectId: run.projectId,
        stepId: step.id,
        prompt: step.prompt,
        armedAt: new Date().toISOString(),
        timeoutAt,
      },
    });
  }

  /** Nearest upstream job step that actually ran — the gate card's turn anchor. */
  private findAnchorJobId(def: PipelineDef, run: RunRecord, gateStepId: string): string | undefined {
    const byId = new Map(run.steps.map((s) => [s.stepId, s]));
    const indexOf = new Map(def.steps.map((s, i) => [s.id, i]));
    const queue = [gateStepId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const idx = indexOf.get(id);
      if (idx === undefined) continue;
      for (const dep of effectiveNeeds(def, idx)) {
        const record = byId.get(dep);
        if (record?.jobId) return record.jobId;
        queue.push(dep);
      }
    }
    return run.steps.filter((s) => s.jobId).map((s) => s.jobId!).pop();
  }

  /**
   * Gate resolution — called AFTER ChatService's NX-guarded choice-resolved
   * succeeded (chat route branch, approvals route, or the timeout arm).
   * Idempotent: a missing HITL record means the gate was already applied.
   */
  async applyResolvedGate(cardId: string, decision: GateDecision, decidedBy: string | undefined, via: 'in-app' | 'api'): Promise<boolean> {
    const gateId = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.CARD(cardId));
    if (!gateId) return false;
    const raw = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.HITL(gateId));
    if (!raw) return false;
    const hitl = JSON.parse(raw) as HitlRecord;

    const approved = decision === 'approved' || decision === 'expired_approve';
    const decidedAt = new Date().toISOString();

    // Tool-approval APPROVE resumes the step instead of sealing an outcome:
    // the paused job re-dispatches with the decision as the dangling call's
    // tool_result and a one-turn grant for the tool. REJECT falls through to
    // the normal failed outcome below (`on: failure` consumes it).
    if (hitl.kind === 'tool' && approved) {
      let resumed = false;
      const result = await mutateRun(this.deps, hitl.owner, hitl.runId, async (live) => {
        const step = live.steps.find((s) => s.stepId === hitl.stepId);
        if (!step || isTerminal(live.status) || step.status !== 'awaiting_gate' || step.gate?.gateId !== gateId) {
          return { run: live, dispatches: [] };
        }
        resumed = true;
        const steps = live.steps.map((s): StepRecord =>
          s.stepId === hitl.stepId
            ? { ...s, status: 'dispatched', gate: s.gate ? { ...s.gate, decision, decidedBy, decidedAt, via } : s.gate }
            : s,
        );
        const policy = live.defSnapshot?.defaults?.onStepFailure ?? 'abort';
        return { run: { ...live, steps, status: deriveRunStatus(steps, policy) }, dispatches: [] };
      });
      if (!result || !resumed) return false;
      await this.deps.scheduleQueue.cancelDelayed(`gre-${gateId}`);
      await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(gateId));
      await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(cardId));
      if (hitl.jobId) await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.JOB(hitl.jobId)).catch(() => {});
      await appendEvent(this.deps, hitl.owner, hitl.projectId, {
        ts: decidedAt,
        event: 'human_resolved',
        runId: hitl.runId,
        stepId: hitl.stepId,
        gateId,
        detail: { kind: 'tool', tool: hitl.tool, decision, decidedBy, via },
      });
      await publish(this.deps, hitl.owner, {
        cause: 'approvalResolved',
        projectId: hitl.projectId,
        pipelineId: hitl.pipelineId,
        runId: hitl.runId,
        gateId,
        decision,
        decidedBy,
      });
      await publish(this.deps, hitl.owner, { cause: 'runUpdate', projectId: hitl.projectId, pipelineId: hitl.pipelineId, run: publicRun(result.run) });
      const def = result.run.defSnapshot;
      const stepDef = def?.steps.find((s) => s.id === hitl.stepId);
      if (def && stepDef && !isApprovalStep(stepDef) && hitl.tool) {
        await dispatchJobStep(this.ctx, 
          hitl.owner,
          def,
          result.run,
          stepDef,
          0,
          `APPROVED by a human reviewer — the "${hitl.tool}" call is authorized. Re-issue the exact same tool call now and continue the work.`,
          hitl.tool,
        );
      }
      return true;
    }

    const applied = await this.applyOutcome(
      hitl.owner,
      hitl.runId,
      hitl.stepId,
      approved ? 'succeeded' : 'failed',
      hitl.kind === 'tool' && !approved ? { error: `tool-approval-rejected: ${hitl.tool ?? 'unknown-tool'}` } : undefined,
      (record) => ({
        ...record,
        gate: record.gate ? { ...record.gate, decision, decidedBy, decidedAt, via } : record.gate,
      }),
      undefined,
      () =>
        appendEvent(this.deps, hitl.owner, hitl.projectId, {
          ts: decidedAt,
          event: 'human_resolved',
          runId: hitl.runId,
          stepId: hitl.stepId,
          gateId,
          detail: { decision, decidedBy, via },
        }),
    );
    // Keys are deleted only AFTER the outcome landed — a crash/lock-starved
    // apply keeps the HITL record recoverable (the timeout arm re-funnels).
    if (!applied) return false;
    await this.deps.scheduleQueue.cancelDelayed(`gto-${gateId}`);
    await this.deps.scheduleQueue.cancelDelayed(`gre-${gateId}`);
    await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(gateId));
    await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(cardId));
    const run = await getRun(this.deps, hitl.runId);
    if (run) {
      await publish(this.deps, hitl.owner, {
        cause: 'approvalResolved',
        projectId: run.projectId,
        pipelineId: hitl.pipelineId,
        runId: hitl.runId,
        gateId,
        decision,
        decidedBy,
      });
    }
    return true;
  }

  private async handleGateTimeout(gateId: string): Promise<void> {
    const raw = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.HITL(gateId));
    if (!raw) return; // already resolved
    const hitl = JSON.parse(raw) as HitlRecord;
    const run = await getRun(this.deps, hitl.runId);
    if (!run || isTerminal(run.status)) return;

    const approve = hitl.onTimeout === 'approve';
    // Funnel through the SAME choice-resolved path a human click uses — the
    // NX key guarantees exactly one winner if a click races the timeout.
    let resolved = true;
    if (this.deps.chatService) {
      const result = await this.deps.chatService.appendChoiceResolved(run.projectId, UNIVERSAL_FEATURE, {
        jobId: hitl.anchorJobId,
        cardId: hitl.cardId,
        choiceSelected: approve ? 'approve' : 'reject',
        resolvedLabel: 'Timed out',
        userContext: hitl.owner,
      });
      resolved = result.resolved;
    }
    if (resolved) {
      await appendEvent(this.deps, hitl.owner, hitl.projectId, {
        ts: new Date().toISOString(),
        event: 'gate_expired',
        runId: hitl.runId,
        stepId: hitl.stepId,
        gateId,
      });
      await this.applyResolvedGate(hitl.cardId, approve ? 'expired_approve' : 'expired_reject', undefined, 'api');
    }
    // NX already taken by a human click whose applyResolvedGate crashed
    // mid-flight: the HITL record still exists — apply the human decision.
    else {
      await this.applyResolvedGate(hitl.cardId, approve ? 'expired_approve' : 'expired_reject', undefined, 'api');
    }
  }

  // ============================================
  // Job status consumption + chain advance
  // ============================================

  /**
   * Gate reminder: the gate is still unresolved — re-fire the SSE row and drop
   * a reminder notice on the anchor turn, then re-arm (bounded). Resolve and
   * cancel paths remove the arm (`gre-{gateId}`).
   */
  private async handleGateRemind(data: PipelineGateRemindJobData): Promise<void> {
    const raw = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.HITL(data.gateId));
    if (!raw) return; // resolved or swept
    const run = await getRun(this.deps, data.runId);
    const record = run?.steps.find((s) => s.stepId === data.stepId);
    if (!run || !record || record.status !== 'awaiting_gate' || !record.gate || record.gate.decision) return;
    const stepDef = run.defSnapshot?.steps.find((s) => s.id === data.stepId);
    const remindAfter = stepDef && isApprovalStep(stepDef) ? stepDef.remindAfter : undefined;
    await publish(this.deps, data.owner, {
      cause: 'approvalRequested',
      projectId: run.projectId,
      approval: {
        gateId: record.gate.gateId,
        cardId: record.gate.cardId,
        runId: run.runId,
        pipelineId: run.pipelineId,
        pipelineName: run.defSnapshot?.name ?? run.pipelineId,
        projectId: run.projectId,
        stepId: data.stepId,
        prompt: record.gate.prompt,
        armedAt: record.gate.armedAt,
        ...(record.gate.timeoutAt && { timeoutAt: record.gate.timeoutAt }),
      },
    });
    const anchor = [...run.steps].reverse().find((s) => s.turnId && s.jobId);
    if (this.deps.chatService && anchor) {
      this.deps.chatService
        .appendAssistantMessage(run.projectId, UNIVERSAL_FEATURE, `⏰ 승인 대기 중입니다: "${record.gate.prompt}" (run: ${run.runId})`, {
          jobId: anchor.jobId!,
          turnId: anchor.turnId,
          jobType: 'universal',
          userContext: data.owner,
          kind: 'system_notice',
        })
        .catch((e) => logger.warn('[Pipeline] gate reminder notice failed', { component: COMPONENT }, e));
    }
    const ms = parsePipelineDuration(remindAfter);
    if (ms && data.reminders + 1 < MAX_GATE_REMINDERS) {
      await this.deps.scheduleQueue.armDelayed(`gre-${data.gateId}`, ms, { ...data, reminders: data.reminders + 1 });
    }
  }

  /**
   * Clarify answer funnel — chat clarify-card branch (in-app) and the
   * pipelines clarify route (inbox/API). The mechanics live in
   * pipelineRun/hitl.ts.
   */
  async applyClarifyAnswer(params: { jobId: string; answer: string; answeredBy?: string; via: 'in-app' | 'api' }): Promise<boolean> {
    return applyClarifyAnswer(this.ctx, params);
  }

  /**
   * Apply one step outcome under the run lock, dispatch what unblocks,
   * finalize when terminal. Returns false when the mutation could NOT be
   * applied (lock starvation / missing run) — callers re-arm, never drop.
   */
  private async applyOutcome(
    owner: PipelineOwner,
    runId: string,
    stepId: string,
    outcome: 'succeeded' | 'failed',
    patch?: Partial<StepRecord>,
    decorate?: (record: StepRecord) => StepRecord,
    expectedJobId?: string,
    onOutcomeLanded?: () => Promise<void>,
  ): Promise<boolean> {
    const result = await mutateRun(this.deps, owner, runId, async (live, def) => {
      if (!def) return { run: live, dispatches: [] };
      const already = live.steps.find((s) => s.stepId === stepId);
      // `awaiting_clarify` refuses outcomes too: a stale outcome-retry must
      // never clobber a step parked on a human answer.
      if (!already || isTerminal(live.status) || ['succeeded', 'failed', 'skipped', 'cancelled', 'awaiting_clarify'].includes(already.status)) {
        return { run: live, dispatches: [] };
      }
      // A step can hold several sequential jobIds (clarify resume, retry
      // rounds) — an outcome for a SUPERSEDED jobId must not clobber the
      // current round. Gate resolutions carry no jobId and skip the guard.
      if (expectedJobId !== undefined && already.jobId !== expectedJobId) {
        return { run: live, dispatches: [] };
      }
      const endedPatch = { ...patch, endedAt: new Date().toISOString() };
      const plan = applyStepOutcome(def, live, stepId, outcome, endedPatch);
      if (decorate) {
        plan.run.steps = plan.run.steps.map((s) => (s.stepId === stepId ? decorate(s) : s));
      }
      return plan;
    });
    if (!result) return false;
    // The resolver's audit line (human_resolved) must precede the
    // step_dispatched/run_finished fan-out below — and must not be written
    // when the apply starved (the timeout arm re-funnels the whole resolve).
    if (onOutcomeLanded) await onOutcomeLanded();

    if (result.dispatches.length > 0) {
      const def = result.run.defSnapshot!;
      await executeDispatches(this.ctx, owner, def, result.run, result.dispatches);
    } else if (isTerminal(result.run.status)) {
      await this.finalizeRun(owner, result.run);
    }
    await publish(this.deps, owner, { cause: 'runUpdate', projectId: result.run.projectId, pipelineId: result.run.pipelineId, run: publicRun(result.run) });
    return true;
  }

  async cancelRun(owner: PipelineOwner, runId: string): Promise<boolean> {
    // Kill targets are captured under the per-run lock so a step sealing
    // concurrently cannot slip past both the sweep and the kill.
    const killTargets: Array<{ jobId: string; projectId: string }> = [];
    let mutated = false;
    const result = await mutateRun(this.deps, owner, runId, async (live) => {
      if (isTerminal(live.status)) return { run: live, dispatches: [] };
      mutated = true;
      const endedAt = new Date().toISOString();
      const steps = live.steps.map((s): StepRecord => {
        if ((s.status === 'running' || s.status === 'dispatched') && s.jobId) {
          killTargets.push({ jobId: s.jobId, projectId: live.projectId });
          // A human cancel is not a step failure — 'cancelled' keeps it out of
          // the abort-policy/history failure surfaces; the error names why.
          return { ...s, status: 'cancelled', error: 'run-cancelled', endedAt };
        }
        return s.status === 'pending' || s.status === 'awaiting_gate' || s.status === 'awaiting_clarify' || s.status === 'dispatched'
          ? { ...s, status: 'cancelled', endedAt }
          : s;
      });
      return { run: { ...live, steps, status: 'cancelled' as const }, dispatches: [] };
    });
    // Already-terminal runs must not re-run the disarm/finalize block — a
    // second cancel used to append a duplicate run_finished + index line.
    if (!result || !mutated) return false;
    // Kill legs for live step jobs — the `/jobs/:jobId/stop` mirror.
    // markUserStopped doubles as the pre-spawn guard, so 'dispatched'
    // (enqueued, not yet picked up) jobs are cancelled at dequeue instead of
    // running as unbilled-for ghosts. The killed job's late seal no-ops
    // against the terminal run (applyOutcome).
    for (const target of killTargets) {
      await this.killStepJob(target.jobId, target.projectId);
    }
    // Disarm any gates, timeout/remind arms and clarify funnel keys swept.
    for (const s of result.run.steps) {
      if (s.gate && !s.gate.decision) {
        await this.deps.scheduleQueue.cancelDelayed(`gto-${s.gate.gateId}`);
        await this.deps.scheduleQueue.cancelDelayed(`gre-${s.gate.gateId}`);
        await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(s.gate.gateId)).catch(() => {});
        await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(s.gate.cardId)).catch(() => {});
      }
      if (s.clarify && !s.clarify.answeredAt) {
        await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.JOB(s.clarify.jobId)).catch(() => {});
      }
      await this.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${s.stepId}`);
    }
    await this.finalizeRun(owner, result.run);
    await publish(this.deps, owner, { cause: 'runUpdate', projectId: result.run.projectId, pipelineId: result.run.pipelineId, run: publicRun(result.run) });
    return true;
  }

  /**
   * The `/jobs/:jobId/stop` mirror (mark-user-stopped + poison + STOP
   * pub/sub) — ONE kill authority, shared by run cancel and step timeout.
   */
  private async killStepJob(jobId: string, projectId: string): Promise<void> {
    try {
      await this.deps.stateStore.markUserStopped(jobId);
      await this.deps.stateStore.acquireLock(`ant:job-poisoned:${jobId}`, 600).catch(() => false);
      await this.deps.stateStore.publish(REDIS_CHANNELS.JOB_WORKER.STOP, {
        jobId,
        projectId,
        featureName: UNIVERSAL_FEATURE,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn(`[Pipeline] failed to stop step job ${jobId}`, { component: COMPONENT }, e);
    }
  }

  /**
   * Deactivation side effect owned by the coordinator: cancel the live run.
   * The kill legs live in cancelRun — ONE cancel authority, so the FE stop
   * button and the run-cancel route stop the running job exactly like
   * deactivation does. The activation file/keys/cron are the ROUTE's
   * responsibility — this method never touches activation state.
   */
  async deactivate(owner: PipelineOwner, projectId: string): Promise<void> {
    const runId = await getActiveRunId(this.deps, owner, projectId);
    if (!runId) return;
    const run = await getRun(this.deps, runId);
    if (run && !isTerminal(run.status)) {
      await this.cancelRun(owner, runId);
    }
  }

  private async finalizeRun(owner: PipelineOwner, run: RunRecord): Promise<void> {
    const endedAt = run.endedAt ?? new Date().toISOString();
    // A failed/partial run names its cause: the first failed step's error.
    // (No other producer writes run.error — without this the field is dead.)
    const firstFailed = run.error
      ? undefined
      : run.steps.find((s) => s.status === 'failed' && s.error);
    const error =
      run.error ?? ((run.status === 'failed' || run.status === 'partial') && firstFailed ? `${firstFailed.stepId}: ${firstFailed.error}` : undefined);
    const sealed: RunRecord = { ...run, endedAt, ...(error && { error }) };
    await saveRun(this.deps, sealed);
    await appendEvent(this.deps, owner, run.projectId, {
      ts: endedAt,
      event: 'run_finished',
      runId: run.runId,
      detail: { status: run.status, run: publicRun(sealed) },
    });
    await appendRunIndex(deriveActivationsRoot(tenantCtx(this.deps, owner)), run.projectId, {
      runId: run.runId,
      pipelineId: run.pipelineId,
      projectId: run.projectId,
      status: run.status,
      firedBy: run.firedBy,
      fireEpoch: run.fireEpoch,
      startedAt: run.startedAt,
      endedAt,
      ...(sealed.error && { error: sealed.error }),
    });
    const activeKey = REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, run.projectId);
    const holder = await this.deps.stateStore.getKey(activeKey);
    if (holder === run.runId) {
      await this.deps.stateStore.deleteKey(activeKey).catch(() => {});
      // The concurrency slot shares the ACTIVE key's lifetime — one reservation
      // per live activation. Releasing only under the same holder check keeps a
      // late seal from freeing a slot a newer run already holds.
      await this.deps.stateStore
        .releaseSlot(REDIS_KEYS.PIPE.RUN_SLOTS(owner.organizationId, owner.userId), run.projectId)
        .catch(() => {});
    }
    await this.emitRunFinishedNotice(owner, sealed);
    await this.fireChainedPipelines(owner, sealed);
  }

  /**
   * runCompleted chaining — scoped to the ACTIVATOR's own activations
   * (identity never crosses users; doc 46 §6). Bounded disk scan per the
   * no-reverse-index doctrine; each chained fire rides the SAME fire path
   * with `firedBy: 'event'` and an incremented chainDepth (fire-side loop
   * guard). Best-effort: a broken candidate never blocks finalize.
   */
  private async fireChainedPipelines(owner: PipelineOwner, run: RunRecord): Promise<void> {
    const depth = (run.chainDepth ?? 0) + 1;
    let activations: Array<{ projectId: string }>;
    try {
      activations = listAccountActivations(deriveActivationsRoot(tenantCtx(this.deps, owner)));
    } catch {
      return;
    }
    for (const { projectId } of activations) {
      // A pipeline never chains onto its own project — that run just finished.
      if (projectId === run.projectId) continue;
      try {
        const activation = loadActivationByProject(deriveActivationsRoot(tenantCtx(this.deps, owner)), projectId);
        if (!activation) continue;
        const defRoot = resolveDefRoot(tenantCtx(this.deps, owner), activation.pipelineScope);
        const def = loadPipeline(defRoot, activation.pipelineId);
        const trigger = def.on?.runCompleted;
        if (!trigger || trigger.pipelineId !== run.pipelineId) continue;
        if (!(trigger.statuses ?? ['completed']).includes(run.status)) continue;
        if (!loadAvailability(defRoot, activation.pipelineId).enabled) continue;
        await this.deps.scheduleQueue.addNow({
          kind: 'fire',
          owner,
          pipelineId: activation.pipelineId,
          pipelineScope: activation.pipelineScope,
          projectId,
          firedBy: 'event',
          // Un-rounded: two event fires in the same minute are distinct fires
          // (the overlap guard still bounds concurrency per activation).
          fireEpoch: Date.now(),
          chainDepth: depth,
        });
        logger.info(
          `[Pipeline] chained fire: ${run.pipelineId}(${run.status}) → ${activation.pipelineId} on ${projectId} (depth ${depth})`,
          { component: COMPONENT },
        );
      } catch (e) {
        logger.warn(`[Pipeline] chained-fire candidate failed: ${projectId}`, { component: COMPONENT }, e);
      }
    }
  }

  /**
   * Run-lifecycle chat line, anchored to the LAST step turn the run minted
   * (doc 46 §5: no rootless lines). A run that never dispatched a job step
   * has no turn — log only.
   */
  private async emitRunFinishedNotice(owner: PipelineOwner, run: RunRecord): Promise<void> {
    if (!this.deps.chatService) return;
    const anchor = [...run.steps].reverse().find((s) => s.turnId && s.jobId);
    if (!anchor) return;
    const name = run.defSnapshot?.name ?? run.pipelineId;
    const failedStep = run.steps.find((s) => s.status === 'failed');
    // Business-readable summary: the LAST job step's captured answer, first line.
    const lastAnswer = [...run.steps].reverse().find((s) => s.output?.answer)?.output?.answer;
    const summaryLine = lastAnswer?.split('\n').find((l) => l.trim().length > 0)?.trim().slice(0, 200);
    const summary = summaryLine ? `\n— ${summaryLine}` : '';
    const text =
      run.status === 'completed'
        ? `✅ 파이프라인 "${name}" 실행이 완료되었습니다. (run: ${run.runId})${summary}`
        : run.status === 'failed'
          ? `❌ 파이프라인 "${name}" 실행이 실패했습니다.${failedStep ? ` (step: ${failedStep.stepId}${failedStep.error ? ` — ${failedStep.error}` : ''})` : ''}`
          : run.status === 'partial'
            ? `⚠️ 파이프라인 "${name}" 실행이 일부 실패로 종료되었습니다. (run: ${run.runId})`
            : run.status === 'cancelled'
              ? `⏹️ 파이프라인 "${name}" 실행이 취소되었습니다. (run: ${run.runId})`
              : `⚠️ 파이프라인 "${name}" 실행이 종료되었습니다. (status: ${run.status})`;
    try {
      await this.deps.chatService.appendAssistantMessage(run.projectId, UNIVERSAL_FEATURE, text, {
        jobId: anchor.jobId!,
        turnId: anchor.turnId,
        jobType: 'universal',
        userContext: owner,
        kind: 'system_notice',
      });
    } catch (e) {
      logger.warn(`[Pipeline] run-finished notice failed: ${run.runId}`, { component: COMPONENT }, e);
    }
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
