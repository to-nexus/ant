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
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  isApprovalStep,
  parseCustomJobRef,
  parsePipelineDuration,
  UNIVERSAL_FEATURE,
  type ApprovalStepDef,
  type GateDecision,
  type JobStepDef,
  type PipelineDef,
  type PipelineEventData,
  type PipelinePendingApproval,
  type PipelineRunEvent,
  type RunRecord,
  type StepRecord,
} from '@ant/shared';
import type { StateStorePort } from '../../core/ports/stateStore';
import type { ScheduleQueuePort, PipelineControlJobData, PipelineFireJobData, PipelineOwner } from '../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL, getRealtimeBroadcastChannel, REDIS_CHANNELS } from '../../core/constants/redis';
import { generateHumanId } from '../../utils/humanId';
import { logger } from '../../utils/logger';
import { buildInitialSteps, planAdvance, applyStepOutcome, effectiveNeeds, type StepDispatch } from '../../core/pipelines/ChainExecutor';
import { derivePipelinesRoot, type PipelineTenantContext } from '../../core/pipelines/paths';
import { appendRunEvent, appendRunIndex, loadPipeline, readRunEvents } from '../../core/pipelines/store';
import {
  resolveUniversalExecuteContext,
  validateUniversalTurnMeta,
  findDuplicateActiveJob,
  checkStartCredits,
} from '../../core/scheduling/UniversalDispatchGate';
import { UniversalDispatchService } from '../../core/scheduling/UniversalDispatchService';

const COMPONENT = 'PipelineCoordinator';
/** A cron fire older than this is "missed" (worker downtime) — `onMissed` decides. */
const STALE_FIRE_MS = 10 * 60 * 1000;
const MAX_OVERLAP_REQUEUES = 60; // 60 × 60s = 1h of queueing before giving up
const MAX_DUPLICATE_RETRIES = 60;
const RUN_LOCK_RETRIES = 20;
const RUN_LOCK_RETRY_DELAY_MS = 250;

export interface PipelineCoordinatorDeps {
  stateStore: StateStorePort;
  scheduleQueue: ScheduleQueuePort;
  workspacesPath: string;
  workspaceResolver: {
    getPhysicalWorkspacesPath(): string;
    getProjectPath(userContext: any, projectId: string): string;
    getUniversalContainerPath(userContext: any, projectId: string): string;
  };
  workspaceService: { createWorkspace(tenantId: string, projectId: string): Promise<unknown> };
  chatService?: {
    appendChoicePresented(projectId: string, featureName: string, args: any): Promise<void>;
    appendChoiceResolved(projectId: string, featureName: string, args: any): Promise<{ resolved: boolean }>;
  };
  getJobQueue(): { enqueue(payload: any): Promise<string> };
  getCreditLedger(): { getBalance(orgId: string, userId: string): Promise<{ credits: number }> };
  /** Injected from the periphery helpers so the rule owners stay single. */
  checkApproval(userContext: { userId: string; organizationId: string }): Promise<{ status: string } | null>;
  checkTeamMembership(userContext: { userId: string; organizationId: string; organizationKind?: any }): Promise<boolean>;
}

interface HitlRecord {
  gateId: string;
  cardId: string;
  runId: string;
  stepId: string;
  pipelineId: string;
  owner: PipelineOwner;
  onTimeout: 'reject' | 'approve';
  timeoutAt?: string;
  anchorJobId: string;
  prompt: string;
}

export class PipelineRunCoordinator {
  constructor(private readonly deps: PipelineCoordinatorDeps) {}

  /** Subscribe the status-update consumer. Call once per process. */
  async start(): Promise<void> {
    await this.deps.stateStore.subscribe(
      REDIS_CHANNELS.API_SERVER.JOB_STATUS_UPDATES,
      async (message: unknown) => {
        try {
          await this.handleJobStatusUpdate(message as any);
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
        return this.handleFire(data, intendedFireAt);
      case 'gate-timeout':
        return this.handleGateTimeout(data.gateId);
      case 'step-retry':
        return this.handleStepRetry(data.owner, data.pipelineId, data.runId, data.stepId, data.retries);
      default:
        logger.warn(`[Pipeline] unknown control job kind: ${(data as any).kind}`, { component: COMPONENT });
    }
  }

  private tenantCtx(owner: PipelineOwner): PipelineTenantContext {
    return { workspacesPath: this.deps.workspacesPath, ...owner };
  }

  private async handleFire(data: PipelineFireJobData, intendedFireAt: number): Promise<void> {
    const { owner, pipelineId } = data;
    const root = derivePipelinesRoot(this.tenantCtx(owner));

    let def: PipelineDef;
    try {
      def = loadPipeline(root, pipelineId);
    } catch (e) {
      logger.warn(`[Pipeline] fire skipped — definition invalid: ${pipelineId}`, { component: COMPONENT }, e);
      return;
    }
    if (!def.enabled && data.firedBy === 'cron') return;

    const fireEpoch = data.fireEpoch ?? Math.floor(intendedFireAt / 60_000) * 60_000;

    // Missed-fire policy (cron only; manual fires are always "now").
    if (data.firedBy === 'cron' && Date.now() - intendedFireAt > STALE_FIRE_MS) {
      if ((def.on.schedule.onMissed ?? 'skip') === 'skip') {
        logger.info(`[Pipeline] missed fire skipped: ${pipelineId} @ ${new Date(fireEpoch).toISOString()}`, { component: COMPONENT });
        return;
      }
    }

    // Fire idempotency (attempts:3 on the control queue + multi-replica).
    const firedKey = REDIS_KEYS.PIPE.FIRED(owner.organizationId, owner.userId, pipelineId, fireEpoch);
    if (!(await this.deps.stateStore.acquireLock(firedKey, REDIS_TTL.PIPE.FIRED))) return;

    // Overlap guard — one live run per pipeline (v1).
    const runId = generateHumanId();
    const activeKey = REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, pipelineId);
    const acquired = await this.deps.stateStore.tryAcquireLock(activeKey, runId, REDIS_TTL.PIPE.ACTIVE);
    if (!acquired) {
      const overlap = def.on.schedule.overlap ?? 'skip';
      // Release the fire NX so a queued re-arm (same fireEpoch) can pass it.
      await this.deps.stateStore.releaseLock(firedKey).catch(() => {});
      if (overlap === 'queue' && (data.requeues ?? 0) < MAX_OVERLAP_REQUEUES) {
        await this.deps.scheduleQueue.armDelayed(
          `fire-requeue-${owner.organizationId}-${owner.userId}-${pipelineId}-${fireEpoch}`,
          60_000,
          { ...data, fireEpoch, requeues: (data.requeues ?? 0) + 1 },
        );
      } else {
        logger.info(`[Pipeline] overlap skip: ${pipelineId}`, { component: COMPONENT });
      }
      return;
    }

    const run: RunRecord = {
      runId,
      pipelineId,
      projectId: def.projectId,
      firedBy: data.firedBy === 'cron' ? 'cron' : 'manual',
      fireEpoch,
      status: 'running',
      steps: buildInitialSteps(def),
      startedAt: new Date().toISOString(),
      defSnapshot: def,
    };

    await this.appendEvent(owner, pipelineId, { ts: run.startedAt, event: 'fired', runId, detail: { firedBy: run.firedBy, fireEpoch } });
    const plan = planAdvance(def, run);
    await this.saveRun(plan.run);
    await this.publish(owner, { cause: 'runUpdate', projectId: def.projectId, pipelineId, run: this.publicRun(plan.run) });
    await this.executeDispatches(owner, pipelineId, def, plan.run, plan.dispatches);
  }

  // ============================================
  // Step dispatch
  // ============================================

  private async executeDispatches(
    owner: PipelineOwner,
    pipelineId: string,
    def: PipelineDef,
    run: RunRecord,
    dispatches: StepDispatch[],
  ): Promise<void> {
    for (const dispatch of dispatches) {
      if (dispatch.kind === 'gate') {
        await this.armGate(owner, pipelineId, def, run, dispatch.def as ApprovalStepDef);
      } else {
        await this.dispatchJobStep(owner, pipelineId, def, run, dispatch.def as JobStepDef, 0);
      }
    }
    // Terminal without any dispatch (e.g. everything skipped immediately).
    if (this.isTerminal(run.status) && dispatches.length === 0) {
      await this.finalizeRun(owner, pipelineId, run);
    }
  }

  private renderDirective(template: string, run: RunRecord): string {
    return template
      .replace(/\{\{\s*trigger\.fireDate\s*\}\}/g, new Date(run.fireEpoch).toISOString())
      .replace(/\{\{\s*trigger\.fireEpoch\s*\}\}/g, String(run.fireEpoch))
      .replace(/\{\{\s*run\.id\s*\}\}/g, run.runId);
  }

  private async dispatchJobStep(
    owner: PipelineOwner,
    pipelineId: string,
    def: PipelineDef,
    run: RunRecord,
    step: JobStepDef,
    retries: number,
  ): Promise<void> {
    const fail = (reason: string) =>
      this.applyOutcome(owner, pipelineId, run.runId, step.id, 'failed', { error: reason });

    // Owner-standing gates — re-judged at EVERY step dispatch, never once at
    // registration (revocation/credit-drain take effect mid-chain).
    if (await this.deps.checkApproval(owner)) return void (await fail('account-not-approved'));
    if (!(await this.deps.checkTeamMembership(owner))) return void (await fail('membership-revoked'));
    const lowCredits = await checkStartCredits(owner, this.deps.getCreditLedger);
    if (lowCredits) return void (await fail('insufficient-credits'));

    // Definition + turn-meta accept gates (same owners as the HTTP route).
    const resolved = await resolveUniversalExecuteContext(this.deps.workspaceResolver, owner, def.projectId, step.customJobRef);
    if (!resolved.ok) return void (await fail(`${resolved.code}: ${resolved.error}`));
    const meta = await validateUniversalTurnMeta(
      resolved.containerPath,
      resolved.intentIds,
      step.intent ? [step.intent] : [],
      step.context ?? [],
    );
    if (!meta.ok) return void (await fail(`${meta.code}: ${meta.error}`));

    // Project-level duplicate gate: re-arm instead of failing — chained runs
    // legitimately queue behind an interactive run.
    const duplicate = await findDuplicateActiveJob(this.deps.stateStore as any, owner, def.projectId, UNIVERSAL_FEATURE, 'universal');
    if (duplicate) {
      if (retries >= MAX_DUPLICATE_RETRIES) return void (await fail('duplicate-job-timeout'));
      await this.deps.scheduleQueue.armDelayed(
        `step-retry-${run.runId}-${step.id}`,
        60_000,
        { kind: 'step-retry', owner, pipelineId, runId: run.runId, stepId: step.id, retries: retries + 1 },
      );
      return;
    }

    const dispatcher = new UniversalDispatchService(
      { jobQueue: this.deps.getJobQueue() as any, stateStore: this.deps.stateStore as any },
      { workspaceService: this.deps.workspaceService, workspaceResolver: this.deps.workspaceResolver },
    );

    let jobId: string;
    try {
      const result = await dispatcher.enqueue({
        jobType: 'universal',
        agent: 'universal',
        project: def.projectId,
        feature: UNIVERSAL_FEATURE,
        userContext: owner,
        overrideDirective: this.renderDirective(step.directive, run),
        customJobRef: step.customJobRef,
        universalTurnMeta: meta.meta ?? undefined,
        firedBy: 'schedule',
        pipelineRunId: run.runId,
        pipelineStepId: step.id,
      });
      jobId = result.jobId;
    } catch (e) {
      return void (await fail(`enqueue-failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    await this.deps.stateStore.setKeyWithTTL(
      REDIS_KEYS.PIPE.JOB(jobId),
      JSON.stringify({ runId: run.runId, stepId: step.id, pipelineId, owner }),
      REDIS_TTL.PIPE.JOB,
    );
    await this.mutateRun(owner, pipelineId, run.runId, async (live, liveDef) => {
      const steps = live.steps.map((s): StepRecord =>
        s.stepId === step.id ? { ...s, status: 'running', jobId, startedAt: new Date().toISOString() } : s,
      );
      return { run: { ...live, steps }, dispatches: [] };
    });
    await this.appendEvent(owner, pipelineId, {
      ts: new Date().toISOString(),
      event: 'step_dispatched',
      runId: run.runId,
      stepId: step.id,
      jobId,
    });
  }

  private async handleStepRetry(owner: PipelineOwner, pipelineId: string, runId: string, stepId: string, retries: number): Promise<void> {
    const run = await this.getRun(runId);
    if (!run || this.isTerminal(run.status)) return;
    const record = run.steps.find((s) => s.stepId === stepId);
    if (!record || record.status !== 'dispatched') return;
    const def = run.defSnapshot;
    const stepDef = def?.steps.find((s) => s.id === stepId);
    if (!def || !stepDef || isApprovalStep(stepDef)) return;
    await this.dispatchJobStep(owner, pipelineId, def, run, stepDef, retries);
  }

  // ============================================
  // Gates (HITL)
  // ============================================

  private async armGate(
    owner: PipelineOwner,
    pipelineId: string,
    def: PipelineDef,
    run: RunRecord,
    step: ApprovalStepDef,
  ): Promise<void> {
    const gateId = `gate-${run.runId}-${step.id}`;
    const cardId = `pipe-${gateId}`;
    const anchorJobId = this.findAnchorJobId(def, run, step.id);
    const timeoutMs = step.timeout ? parsePipelineDuration(step.timeout.after) : null;
    const timeoutAt = timeoutMs ? new Date(Date.now() + timeoutMs).toISOString() : undefined;

    if (!anchorJobId) {
      await this.applyOutcome(owner, pipelineId, run.runId, step.id, 'failed', { error: 'gate-has-no-anchor-job' });
      return;
    }

    const hitl: HitlRecord = {
      gateId,
      cardId,
      runId: run.runId,
      stepId: step.id,
      pipelineId,
      owner,
      onTimeout: step.timeout?.onTimeout ?? 'reject',
      timeoutAt,
      anchorJobId,
      prompt: step.prompt,
    };
    await this.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.HITL(gateId), JSON.stringify(hitl), REDIS_TTL.PIPE.HITL);
    await this.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.CARD(cardId), gateId, REDIS_TTL.PIPE.HITL);

    await this.mutateRun(owner, pipelineId, run.runId, async (live) => {
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
        await this.deps.chatService.appendChoicePresented(def.projectId, UNIVERSAL_FEATURE, {
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
        runId: run.runId,
        stepId: step.id,
        gateId,
      });
    }

    await this.appendEvent(owner, pipelineId, {
      ts: new Date().toISOString(),
      event: 'awaiting_human',
      runId: run.runId,
      stepId: step.id,
      gateId,
    });
    await this.publish(owner, {
      cause: 'approvalRequested',
      projectId: def.projectId,
      approval: {
        gateId,
        cardId,
        runId: run.runId,
        pipelineId,
        pipelineName: def.name,
        projectId: def.projectId,
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

    await this.deps.scheduleQueue.cancelDelayed(`gto-${gateId}`);
    await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(gateId));
    await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(cardId));

    const approved = decision === 'approved' || decision === 'expired_approve';
    const decidedAt = new Date().toISOString();
    await this.applyOutcome(hitl.owner, hitl.pipelineId, hitl.runId, hitl.stepId, approved ? 'succeeded' : 'failed', undefined, (record) => ({
      ...record,
      gate: record.gate ? { ...record.gate, decision, decidedBy, decidedAt, via } : record.gate,
    }));

    await this.appendEvent(hitl.owner, hitl.pipelineId, {
      ts: decidedAt,
      event: 'human_resolved',
      runId: hitl.runId,
      stepId: hitl.stepId,
      gateId,
      detail: { decision, decidedBy, via },
    });
    const run = await this.getRun(hitl.runId);
    if (run) {
      await this.publish(hitl.owner, {
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
    const run = await this.getRun(hitl.runId);
    if (!run || this.isTerminal(run.status)) return;

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
      await this.appendEvent(hitl.owner, hitl.pipelineId, {
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

  private async handleJobStatusUpdate(data: {
    type?: string;
    jobId?: string;
    status?: string;
    interruption?: any;
    result?: any;
  }): Promise<void> {
    if (!data?.jobId) return;
    if (data.type !== 'completed' && data.type !== 'failed') return;
    const raw = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.JOB(data.jobId));
    if (!raw) return;
    const { runId, stepId, pipelineId, owner } = JSON.parse(raw) as {
      runId: string;
      stepId: string;
      pipelineId: string;
      owner: PipelineOwner;
    };

    const interruption = data.interruption || data.result?.output?.interruption || data.result?.interruption;
    let outcome: 'succeeded' | 'failed' = data.status === 'failed' ? 'failed' : 'succeeded';
    let error: string | undefined;
    if (interruption) {
      outcome = 'failed';
      error = `interrupted: ${interruption.reason ?? 'unknown'}`;
    }

    // Clarify seal detection (v1): a job that ended awaiting a clarify answer
    // did not do the work — unattended chains cannot answer it (Phase 2 axis).
    if (outcome === 'succeeded') {
      const clarify = await this.detectClarifySeal(owner, runId, stepId, data.jobId);
      if (clarify) {
        outcome = 'failed';
        error = 'awaiting_clarify_unsupported';
      }
    }

    await this.appendEvent(owner, pipelineId, {
      ts: new Date().toISOString(),
      event: 'step_completed',
      runId,
      stepId,
      jobId: data.jobId,
      detail: { outcome, ...(error && { error }) },
    });
    await this.applyOutcome(owner, pipelineId, runId, stepId, outcome, error ? { error } : undefined);
  }

  private async detectClarifySeal(owner: PipelineOwner, runId: string, stepId: string, jobId: string): Promise<boolean> {
    try {
      const run = await this.getRun(runId);
      const stepDef = run?.defSnapshot?.steps.find((s) => s.id === stepId);
      if (!run || !stepDef || isApprovalStep(stepDef)) return false;
      const ref = parseCustomJobRef(stepDef.customJobRef);
      if (!ref) return false;
      const containerPath = this.deps.workspaceResolver.getUniversalContainerPath(owner, run.projectId);
      const sessionPath = path.join(containerPath, 'sessions', ref.agentId, `${ref.jobId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      const state = session?.state ?? session;
      return state?.awaitingClarify === true && state?.jobId === jobId;
    } catch {
      return false;
    }
  }

  /** Apply one step outcome under the run lock, dispatch what unblocks, finalize when terminal. */
  private async applyOutcome(
    owner: PipelineOwner,
    pipelineId: string,
    runId: string,
    stepId: string,
    outcome: 'succeeded' | 'failed',
    patch?: Partial<StepRecord>,
    decorate?: (record: StepRecord) => StepRecord,
  ): Promise<void> {
    const result = await this.mutateRun(owner, pipelineId, runId, async (live, def) => {
      if (!def) return { run: live, dispatches: [] };
      const already = live.steps.find((s) => s.stepId === stepId);
      if (!already || this.isTerminal(live.status) || ['succeeded', 'failed', 'skipped', 'cancelled'].includes(already.status)) {
        return { run: live, dispatches: [] };
      }
      const endedPatch = { ...patch, endedAt: new Date().toISOString() };
      const plan = applyStepOutcome(def, live, stepId, outcome, endedPatch);
      if (decorate) {
        plan.run.steps = plan.run.steps.map((s) => (s.stepId === stepId ? decorate(s) : s));
      }
      return plan;
    });
    if (!result) return;

    if (result.dispatches.length > 0) {
      const def = result.run.defSnapshot!;
      await this.executeDispatches(owner, pipelineId, def, result.run, result.dispatches);
    } else if (this.isTerminal(result.run.status)) {
      await this.finalizeRun(owner, pipelineId, result.run);
    }
    await this.publish(owner, { cause: 'runUpdate', projectId: result.run.projectId, pipelineId, run: this.publicRun(result.run) });
  }

  async cancelRun(owner: PipelineOwner, pipelineId: string, runId: string): Promise<boolean> {
    const result = await this.mutateRun(owner, pipelineId, runId, async (live) => {
      if (this.isTerminal(live.status)) return { run: live, dispatches: [] };
      const steps = live.steps.map((s): StepRecord =>
        s.status === 'pending' || s.status === 'awaiting_gate' || s.status === 'dispatched'
          ? { ...s, status: 'cancelled', endedAt: new Date().toISOString() }
          : s,
      );
      return { run: { ...live, steps, status: 'cancelled' as const }, dispatches: [] };
    });
    if (!result) return false;
    // Disarm any gates the cancel just swept.
    for (const s of result.run.steps) {
      if (s.gate && !s.gate.decision) {
        await this.deps.scheduleQueue.cancelDelayed(`gto-${s.gate.gateId}`);
        await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(s.gate.gateId)).catch(() => {});
        await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(s.gate.cardId)).catch(() => {});
      }
    }
    await this.finalizeRun(owner, pipelineId, result.run);
    await this.publish(owner, { cause: 'runUpdate', projectId: result.run.projectId, pipelineId, run: this.publicRun(result.run) });
    return true;
  }

  private async finalizeRun(owner: PipelineOwner, pipelineId: string, run: RunRecord): Promise<void> {
    const endedAt = run.endedAt ?? new Date().toISOString();
    const sealed: RunRecord = { ...run, endedAt };
    await this.saveRun(sealed);
    await this.appendEvent(owner, pipelineId, {
      ts: endedAt,
      event: 'run_finished',
      runId: run.runId,
      detail: { status: run.status, run: this.publicRun(sealed) },
    });
    await appendRunIndex(derivePipelinesRoot(this.tenantCtx(owner)), pipelineId, {
      runId: run.runId,
      pipelineId,
      status: run.status,
      firedBy: run.firedBy,
      fireEpoch: run.fireEpoch,
      startedAt: run.startedAt,
      endedAt,
      ...(run.error && { error: run.error }),
    });
    const activeKey = REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, pipelineId);
    const holder = await this.deps.stateStore.getKey(activeKey);
    if (holder === run.runId) {
      await this.deps.stateStore.deleteKey(activeKey).catch(() => {});
    }
  }

  // ============================================
  // Run projection (Redis JSON doc, single writer under per-run lock)
  // ============================================

  async getRun(runId: string): Promise<RunRecord | null> {
    const raw = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.RUN(runId));
    return raw ? (JSON.parse(raw) as RunRecord) : null;
  }

  /** Disk fallback for terminal runs whose projection has expired. */
  readRunFromDisk(owner: PipelineOwner, pipelineId: string, runId: string): RunRecord | null {
    const events = readRunEvents(derivePipelinesRoot(this.tenantCtx(owner)), pipelineId, runId);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const detail = events[i]?.detail as { run?: RunRecord } | undefined;
      if (events[i].event === 'run_finished' && detail?.run) return detail.run;
    }
    return null;
  }

  private async saveRun(run: RunRecord): Promise<void> {
    await this.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.RUN(run.runId), JSON.stringify(run), REDIS_TTL.PIPE.RUN);
  }

  private async mutateRun(
    owner: PipelineOwner,
    pipelineId: string,
    runId: string,
    fn: (run: RunRecord, def: PipelineDef | undefined) => Promise<{ run: RunRecord; dispatches: StepDispatch[] }>,
  ): Promise<{ run: RunRecord; dispatches: StepDispatch[] } | null> {
    const lockKey = REDIS_KEYS.PIPE.RUN_LOCK(runId);
    for (let attempt = 0; attempt < RUN_LOCK_RETRIES; attempt += 1) {
      if (await this.deps.stateStore.acquireLock(lockKey, REDIS_TTL.PIPE.RUN_LOCK)) {
        try {
          const live = await this.getRun(runId);
          if (!live) return null;
          const result = await fn(live, live.defSnapshot);
          await this.saveRun(result.run);
          return result;
        } finally {
          await this.deps.stateStore.releaseLock(lockKey).catch(() => {});
        }
      }
      await new Promise((r) => setTimeout(r, RUN_LOCK_RETRY_DELAY_MS));
    }
    logger.warn(`[Pipeline] run lock starvation: ${runId}`, { component: COMPONENT });
    return null;
  }

  // ============================================
  // Queries for the HTTP surface
  // ============================================

  async getActiveRunId(owner: PipelineOwner, pipelineId: string): Promise<string | null> {
    return this.deps.stateStore.getKey(REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, pipelineId));
  }

  async listPendingApprovals(owner: PipelineOwner, pipelineIds: string[]): Promise<PipelinePendingApproval[]> {
    const out: PipelinePendingApproval[] = [];
    for (const pipelineId of pipelineIds) {
      const runId = await this.getActiveRunId(owner, pipelineId);
      if (!runId) continue;
      const run = await this.getRun(runId);
      if (!run) continue;
      for (const s of run.steps) {
        if (s.status !== 'awaiting_gate' || !s.gate) continue;
        out.push({
          gateId: s.gate.gateId,
          cardId: s.gate.cardId,
          runId,
          pipelineId,
          pipelineName: run.defSnapshot?.name ?? pipelineId,
          projectId: run.projectId,
          stepId: s.stepId,
          prompt: s.gate.prompt,
          armedAt: s.gate.armedAt,
          timeoutAt: s.gate.timeoutAt,
        });
      }
    }
    return out;
  }

  async getHitlByGateId(gateId: string): Promise<{ cardId: string; anchorJobId: string; owner: PipelineOwner; runId: string } | null> {
    const raw = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.HITL(gateId));
    if (!raw) return null;
    const hitl = JSON.parse(raw) as HitlRecord;
    return { cardId: hitl.cardId, anchorJobId: hitl.anchorJobId, owner: hitl.owner, runId: hitl.runId };
  }

  // ============================================
  // Shared plumbing
  // ============================================

  private isTerminal(status: RunRecord['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'partial' || status === 'cancelled' || status === 'expired';
  }

  /** SSE payload copy — the frozen def never rides the wire. */
  private publicRun(run: RunRecord): Omit<RunRecord, 'defSnapshot'> {
    const { defSnapshot: _snapshot, ...rest } = run;
    return rest;
  }

  private async appendEvent(owner: PipelineOwner, pipelineId: string, event: PipelineRunEvent): Promise<void> {
    try {
      await appendRunEvent(derivePipelinesRoot(this.tenantCtx(owner)), pipelineId, event);
    } catch (err) {
      logger.warn(`[Pipeline] run-event append failed: ${pipelineId}/${event.runId}`, { component: COMPONENT }, err);
    }
  }

  private async publish(owner: PipelineOwner, data: PipelineEventData): Promise<void> {
    try {
      // No projectId on the envelope — user-scoped delivery reaches the
      // approvals inbox even when another project is open.
      await this.deps.stateStore.publish(getRealtimeBroadcastChannel(owner.organizationId, owner.userId), {
        type: 'pipeline',
        data,
        userContext: { userId: owner.userId, organizationId: owner.organizationId },
      });
    } catch (err) {
      logger.warn('[Pipeline] SSE publish failed', { component: COMPONENT }, err);
    }
  }
}
