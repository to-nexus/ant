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

import * as fs from 'fs';
import {
  isApprovalStep,
  parseCustomJobRef,
  parsePipelineDuration,
  DEFAULT_PIPELINE_CAPS,
  DIRECTIVE_MAX_CHARS,
  UNIVERSAL_FEATURE,
  type ApprovalStepDef,
  type ClarifyRecord,
  type GateDecision,
  type JobStepDef,
  type PipelineActivation,
  type PipelineDef,
  type PipelineEventData,
  type PipelinePendingApproval,
  type PipelineRunEvent,
  type RunRecord,
  type StepRecord,
} from '@ant/shared';
import type { StateStorePort } from '../../core/ports/stateStore';
import type {
  ScheduleQueuePort,
  PipelineClarifyEnterJobData,
  PipelineControlJobData,
  PipelineFireJobData,
  PipelineOwner,
} from '../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL, getRealtimeBroadcastChannel, REDIS_CHANNELS } from '../../core/constants/redis';
import { generateHumanId } from '../../utils/humanId';
import { generateTurnId } from '../../composition/recordUserTurn';
import { logger } from '../../utils/logger';
import { buildInitialSteps, planAdvance, applyStepOutcome, deriveRunStatus, effectiveNeeds, type StepDispatch } from '../../core/pipelines/ChainExecutor';
import { getSessionFilePath, readSessionTextBounded } from '../../core/utils/sessionPaths';
import { deriveActivationsRoot, type PipelineTenantContext } from '../../core/pipelines/paths';
import { resolveDefRoot } from '../../core/pipelines/scopeRoots';
import {
  appendRunEvent,
  appendRunIndex,
  listAccountActivations,
  loadActivationByProject,
  loadAvailability,
  loadPipeline,
  readRunEvents,
} from '../../core/pipelines/store';
import {
  resolveUniversalExecuteContext,
  validateUniversalTurnMeta,
  findDuplicateActiveJob,
  checkStartCredits,
} from '../../core/scheduling/UniversalDispatchGate';
import { UniversalDispatchService } from '../../core/scheduling/UniversalDispatchService';
import { createSelfApiTokenMinter } from '../auth/selfApiToken';

const COMPONENT = 'PipelineCoordinator';
/** A cron fire older than this is "missed" (worker downtime) — `onMissed` decides. */
const STALE_FIRE_MS = 10 * 60 * 1000;
const MAX_OVERLAP_REQUEUES = 60; // 60 × 60s = 1h of queueing before giving up
const MAX_DUPLICATE_RETRIES = 60;
const MAX_OUTCOME_RETRIES = 5; // × 30s — lock-starved outcome re-applies
const OUTCOME_RETRY_DELAY_MS = 30_000;
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
    appendUserTurn(
      projectId: string,
      featureName: string,
      text: string,
      turnId: string,
      jobId?: string,
      userContext?: any,
      actionMetadata?: any,
      jobType?: any,
      pipeline?: { pipelineId: string; runId: string; stepId: string; firedBy: 'cron' | 'manual' },
    ): Promise<void>;
    appendAssistantMessage(
      projectId: string,
      featureName: string,
      text: string,
      args: { jobId: string; turnId?: string | null; jobType?: any; userContext?: any; kind?: string },
    ): Promise<void>;
  };
  /** In-memory kanban cache (API server) — parity with the HTTP dispatch path. */
  stateTracker?: {
    initializeJob(jobId: string, projectId: string, featureName: string, jobType: any, userContext?: any): void;
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
  projectId: string;
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
        return this.handleStepRetry(data.owner, data.runId, data.stepId, data.retries, data.directiveOverride);
      case 'outcome-retry':
        return this.handleOutcomeRetry(data);
      case 'clarify-enter':
        return this.enterAwaitingClarify(data);
      default:
        logger.warn(`[Pipeline] unknown control job kind: ${(data as any).kind}`, { component: COMPONENT });
    }
  }

  private tenantCtx(owner: PipelineOwner): PipelineTenantContext {
    return { workspacesPath: this.deps.workspacesPath, ...owner };
  }

  private async handleFire(data: PipelineFireJobData, intendedFireAt: number): Promise<void> {
    const { owner, pipelineId, projectId } = data;
    const actRoot = deriveActivationsRoot(this.tenantCtx(owner));

    // Activation is the fire authority: no activation ⇒ orphan scheduler —
    // skip; the reconciler removes the cron entry. A pipelineId mismatch means
    // the project switched pipelines after this fire was armed — stale, skip.
    let activation: PipelineActivation | null;
    try {
      activation = loadActivationByProject(actRoot, projectId);
    } catch (e) {
      logger.warn(`[Pipeline] fire skipped — activation invalid: ${projectId}`, { component: COMPONENT }, e);
      return;
    }
    if (!activation) {
      logger.info(`[Pipeline] fire skipped — not activated: ${projectId}`, { component: COMPONENT });
      return;
    }
    if (activation.pipelineId !== pipelineId) {
      logger.info(
        `[Pipeline] fire skipped — project ${projectId} now runs ${activation.pipelineId}, not ${pipelineId}`,
        { component: COMPONENT },
      );
      return;
    }

    // Definition resolves ONLY at the activation's pinned scope.
    const defRoot = resolveDefRoot(this.tenantCtx(owner), activation.pipelineScope);
    let def: PipelineDef;
    try {
      def = loadPipeline(defRoot, pipelineId);
    } catch (e) {
      logger.warn(`[Pipeline] fire skipped — definition invalid: ${pipelineId}`, { component: COMPONENT }, e);
      return;
    }
    // Defensive: the availability machine forbids disabling while activated,
    // but a hand-edited sidecar must not fire.
    try {
      if (!loadAvailability(defRoot, pipelineId).enabled) {
        logger.warn(`[Pipeline] fire skipped — pipeline disabled: ${pipelineId}`, { component: COMPONENT });
        return;
      }
    } catch (e) {
      logger.warn(`[Pipeline] fire skipped — availability unreadable: ${pipelineId}`, { component: COMPONENT }, e);
      return;
    }

    // Caps: bound the activator's simultaneously-live runs across all their
    // activations (enforce-at-fire = skip + log, caps doctrine).
    const liveRuns = await this.countLiveRuns(owner, actRoot);
    if (liveRuns >= DEFAULT_PIPELINE_CAPS.maxConcurrentRuns) {
      logger.warn(
        `[Pipeline] fire skipped — maxConcurrentRuns reached (${liveRuns}/${DEFAULT_PIPELINE_CAPS.maxConcurrentRuns}): ${pipelineId}`,
        { component: COMPONENT },
      );
      return;
    }

    const fireEpoch = data.fireEpoch ?? Math.floor(intendedFireAt / 60_000) * 60_000;

    // Missed-fire policy (cron only; manual fires are always "now").
    if (data.firedBy === 'cron' && Date.now() - intendedFireAt > STALE_FIRE_MS) {
      if ((def.on.schedule.onMissed ?? 'skip') === 'skip') {
        logger.info(`[Pipeline] missed fire skipped: ${pipelineId} @ ${new Date(fireEpoch).toISOString()}`, { component: COMPONENT });
        return;
      }
    }

    // Fire idempotency (attempts:3 on the control queue + multi-replica).
    const firedKey = REDIS_KEYS.PIPE.FIRED(owner.organizationId, owner.userId, projectId, fireEpoch);
    if (!(await this.deps.stateStore.acquireLock(firedKey, REDIS_TTL.PIPE.FIRED))) return;

    // Overlap guard — one live run per ACTIVATION (the same pipeline may run
    // concurrently on other projects).
    const runId = generateHumanId();
    const activeKey = REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, projectId);
    const acquired = await this.deps.stateStore.tryAcquireLock(activeKey, runId, REDIS_TTL.PIPE.ACTIVE);
    if (!acquired) {
      const overlap = def.on.schedule.overlap ?? 'skip';
      // Release the fire NX so a queued re-arm (same fireEpoch) can pass it.
      await this.deps.stateStore.releaseLock(firedKey).catch(() => {});
      if (overlap === 'queue' && (data.requeues ?? 0) < MAX_OVERLAP_REQUEUES) {
        await this.deps.scheduleQueue.armDelayed(
          `fire-requeue-${owner.organizationId}-${owner.userId}-${projectId}-${fireEpoch}`,
          60_000,
          { ...data, fireEpoch, requeues: (data.requeues ?? 0) + 1 },
        );
      } else {
        logger.info(`[Pipeline] overlap skip: ${pipelineId} on ${projectId}`, { component: COMPONENT });
      }
      return;
    }

    const run: RunRecord = {
      runId,
      pipelineId,
      projectId,
      firedBy: data.firedBy === 'cron' ? 'cron' : 'manual',
      fireEpoch,
      status: 'running',
      steps: buildInitialSteps(def),
      startedAt: new Date().toISOString(),
      defSnapshot: def,
      activationSnapshot: activation,
    };

    await this.appendEvent(owner, projectId, { ts: run.startedAt, event: 'fired', runId, detail: { firedBy: run.firedBy, fireEpoch, projectId } });
    const plan = planAdvance(def, run);
    await this.saveRun(plan.run);
    await this.publish(owner, { cause: 'runUpdate', projectId: run.projectId, pipelineId, run: this.publicRun(plan.run) });
    await this.executeDispatches(owner, def, plan.run, plan.dispatches);
  }

  /** Live-run count across the activator's activations (≤ maxPipelines GETs). */
  private async countLiveRuns(owner: PipelineOwner, actRoot: string): Promise<number> {
    let count = 0;
    for (const { projectId } of listAccountActivations(actRoot)) {
      const runId = await this.getActiveRunId(owner, projectId);
      if (runId) count += 1;
    }
    return count;
  }

  // ============================================
  // Step dispatch
  // ============================================

  private async executeDispatches(
    owner: PipelineOwner,
    def: PipelineDef,
    run: RunRecord,
    dispatches: StepDispatch[],
  ): Promise<void> {
    for (const dispatch of dispatches) {
      if (dispatch.kind === 'gate') {
        await this.armGate(owner, def, run, dispatch.def as ApprovalStepDef);
      } else {
        await this.dispatchJobStep(owner, def, run, dispatch.def as JobStepDef, 0);
      }
    }
    // Terminal without any dispatch (e.g. everything skipped immediately).
    if (this.isTerminal(run.status) && dispatches.length === 0) {
      await this.finalizeRun(owner, run);
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
    def: PipelineDef,
    run: RunRecord,
    step: JobStepDef,
    retries: number,
    directiveOverride?: string,
  ): Promise<void> {
    const pipelineId = run.pipelineId;
    const fail = (reason: string) =>
      this.applyOutcome(owner, run.runId, step.id, 'failed', { error: reason });

    // Owner-standing gates — re-judged at EVERY step dispatch, never once at
    // registration (revocation/credit-drain take effect mid-chain).
    if (await this.deps.checkApproval(owner)) return void (await fail('account-not-approved'));
    if (!(await this.deps.checkTeamMembership(owner))) return void (await fail('membership-revoked'));
    const lowCredits = await checkStartCredits(owner, this.deps.getCreditLedger);
    if (lowCredits) return void (await fail('insufficient-credits'));

    // Definition + turn-meta accept gates (same owners as the HTTP route).
    const resolved = await resolveUniversalExecuteContext(this.deps.workspaceResolver, owner, run.projectId, step.customJobRef);
    if (!resolved.ok) return void (await fail(`${resolved.code}: ${resolved.error}`));
    const meta = await validateUniversalTurnMeta(
      resolved.containerPath,
      resolved.intentIds,
      step.intent ? [step.intent] : [],
      step.context ?? [],
    );
    if (!meta.ok) return void (await fail(`${meta.code}: ${meta.error}`));

    // Project-level duplicate gate — with the pipeline-owned project gate on
    // the interactive side, the only expected collision left is the seal race
    // between a finishing step's job and this dispatch: re-arm absorbs it.
    const duplicate = await findDuplicateActiveJob(this.deps.stateStore as any, owner, run.projectId, UNIVERSAL_FEATURE, 'universal');
    if (duplicate) {
      if (retries >= MAX_DUPLICATE_RETRIES) return void (await fail('duplicate-job-timeout'));
      await this.deps.scheduleQueue.armDelayed(
        `step-retry-${run.runId}-${step.id}`,
        60_000,
        { kind: 'step-retry', owner, pipelineId, projectId: run.projectId, runId: run.runId, stepId: step.id, retries: retries + 1, directiveOverride },
      );
      return;
    }

    // Chat parity with the interactive execute path: the step's directive is
    // a durable, live-broadcast user_turn (pipeline-attributed), and the run's
    // FIRST step also carries a run-started notice on the same turn.
    const directive = directiveOverride ?? this.renderDirective(step.directive, run);
    // Last common point before BOTH durable sinks (chat.jsonl append + universal
    // enqueue). The ingress caps are where the author/answerer sees the error;
    // this is where the axis is actually closed, because template expansion,
    // clarify resume and step-retry replay all arrive here with a value no
    // ingress inspected (M-NEW-029). A cap after the append protects nothing.
    if (directive.length > DIRECTIVE_MAX_CHARS) {
      return void (await fail(`directive-too-large: ${directive.length} > ${DIRECTIVE_MAX_CHARS} characters`));
    }
    const turnId = generateTurnId();
    const isFirstTurn = !run.steps.some((s) => s.turnId);
    if (this.deps.chatService) {
      try {
        await this.deps.chatService.appendUserTurn(
          run.projectId,
          UNIVERSAL_FEATURE,
          directive,
          turnId,
          undefined,
          owner,
          undefined,
          'universal',
          { pipelineId, runId: run.runId, stepId: step.id, firedBy: run.firedBy },
        );
      } catch (e) {
        logger.warn(`[Pipeline] failed to append step user_turn: ${run.runId}/${step.id}`, { component: COMPONENT }, e);
      }
    }

    const dispatcher = new UniversalDispatchService(
      { jobQueue: this.deps.getJobQueue() as any, stateStore: this.deps.stateStore as any },
      {
        workspaceService: this.deps.workspaceService,
        workspaceResolver: this.deps.workspaceResolver,
        stateTracker: this.deps.stateTracker,
        selfApiTokenMinter: createSelfApiTokenMinter(),
      },
    );

    let jobId: string;
    try {
      const result = await dispatcher.enqueue({
        jobType: 'universal',
        agent: 'universal',
        project: run.projectId,
        feature: UNIVERSAL_FEATURE,
        userContext: owner,
        overrideDirective: directive,
        customJobRef: step.customJobRef,
        declaresSelfApi: resolved.declaresSelfApi,
        universalTurnMeta: meta.meta ?? undefined,
        firedBy: 'schedule',
        pipelineRunId: run.runId,
        pipelineStepId: step.id,
        seedTurnId: turnId,
      });
      jobId = result.jobId;
    } catch (e) {
      return void (await fail(`enqueue-failed: ${e instanceof Error ? e.message : String(e)}`));
    }

    if (isFirstTurn && this.deps.chatService) {
      const startedText = run.firedBy === 'cron'
        ? `🔁 파이프라인 "${def.name}" 실행이 시작되었습니다. (run: ${run.runId})`
        : `🔁 파이프라인 "${def.name}" 실행이 수동으로 시작되었습니다. (run: ${run.runId})`;
      this.deps.chatService
        .appendAssistantMessage(run.projectId, UNIVERSAL_FEATURE, startedText, {
          jobId,
          turnId,
          jobType: 'universal',
          userContext: owner,
          kind: 'system_notice',
        })
        .catch((e) => logger.warn('[Pipeline] run-started notice failed', { component: COMPONENT }, e));
    }

    await this.deps.stateStore.setKeyWithTTL(
      REDIS_KEYS.PIPE.JOB(jobId),
      JSON.stringify({ runId: run.runId, stepId: step.id, pipelineId, projectId: run.projectId, owner }),
      REDIS_TTL.PIPE.JOB,
    );
    await this.mutateRun(owner, run.runId, async (live) => {
      const steps = live.steps.map((s): StepRecord =>
        s.stepId === step.id ? { ...s, status: 'running', jobId, turnId, startedAt: new Date().toISOString() } : s,
      );
      return { run: { ...live, steps }, dispatches: [] };
    });
    await this.appendEvent(owner, run.projectId, {
      ts: new Date().toISOString(),
      event: 'step_dispatched',
      runId: run.runId,
      stepId: step.id,
      jobId,
      detail: { turnId },
    });
  }

  private async handleStepRetry(
    owner: PipelineOwner,
    runId: string,
    stepId: string,
    retries: number,
    directiveOverride?: string,
  ): Promise<void> {
    const run = await this.getRun(runId);
    if (!run || this.isTerminal(run.status)) return;
    const record = run.steps.find((s) => s.stepId === stepId);
    if (!record || record.status !== 'dispatched') return;
    const def = run.defSnapshot;
    const stepDef = def?.steps.find((s) => s.id === stepId);
    if (!def || !stepDef || isApprovalStep(stepDef)) return;
    await this.dispatchJobStep(owner, def, run, stepDef, retries, directiveOverride);
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

    await this.mutateRun(owner, run.runId, async (live) => {
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

    await this.appendEvent(owner, run.projectId, {
      ts: new Date().toISOString(),
      event: 'awaiting_human',
      runId: run.runId,
      stepId: step.id,
      gateId,
    });
    await this.publish(owner, {
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
    const applied = await this.applyOutcome(hitl.owner, hitl.runId, hitl.stepId, approved ? 'succeeded' : 'failed', undefined, (record) => ({
      ...record,
      gate: record.gate ? { ...record.gate, decision, decidedBy, decidedAt, via } : record.gate,
    }));
    // Keys are deleted only AFTER the outcome landed — a crash/lock-starved
    // apply keeps the HITL record recoverable (the timeout arm re-funnels).
    if (!applied) return false;
    await this.deps.scheduleQueue.cancelDelayed(`gto-${gateId}`);
    await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(gateId));
    await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(cardId));

    await this.appendEvent(hitl.owner, hitl.projectId, {
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
      await this.appendEvent(hitl.owner, hitl.projectId, {
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
    const { runId, stepId, pipelineId, projectId, owner } = JSON.parse(raw) as {
      runId: string;
      stepId: string;
      pipelineId: string;
      projectId: string;
      owner: PipelineOwner;
    };

    const interruption = data.interruption || data.result?.output?.interruption || data.result?.interruption;
    let outcome: 'succeeded' | 'failed' = data.status === 'failed' ? 'failed' : 'succeeded';
    let error: string | undefined;
    if (interruption) {
      outcome = 'failed';
      error = `interrupted: ${interruption.reason ?? 'unknown'}`;
    }

    // Clarify seal: the job ended awaiting a human answer (universal
    // end-and-resume). Not an outcome — the step parks `awaiting_clarify`
    // until the answer funnels through `applyClarifyAnswer`.
    if (outcome === 'succeeded') {
      const clarify = await this.detectClarifySeal(owner, runId, stepId, data.jobId);
      if (clarify) {
        await this.enterAwaitingClarify({
          kind: 'clarify-enter',
          owner,
          pipelineId,
          projectId,
          runId,
          stepId,
          jobId: data.jobId,
          question: clarify.question,
          toolUseId: clarify.toolUseId,
          retries: 0,
        });
        return;
      }
    }

    await this.appendEvent(owner, projectId, {
      ts: new Date().toISOString(),
      event: 'step_completed',
      runId,
      stepId,
      jobId: data.jobId,
      detail: { outcome, ...(error && { error }) },
    });
    const applied = await this.applyOutcome(owner, runId, stepId, outcome, error ? { error } : undefined);
    if (!applied) {
      // Lock starvation would otherwise DROP the outcome and hang the run
      // `running` until the overlap TTL — re-arm a bounded re-apply instead.
      await this.deps.scheduleQueue.armDelayed(`outcome-retry-${runId}-${stepId}`, OUTCOME_RETRY_DELAY_MS, {
        kind: 'outcome-retry',
        owner,
        pipelineId,
        projectId,
        runId,
        stepId,
        outcome,
        ...(error && { error }),
        retries: 0,
      });
    }
  }

  private async handleOutcomeRetry(data: {
    owner: PipelineOwner;
    pipelineId: string;
    projectId: string;
    runId: string;
    stepId: string;
    outcome: 'succeeded' | 'failed';
    error?: string;
    retries: number;
  }): Promise<void> {
    const applied = await this.applyOutcome(
      data.owner, data.runId, data.stepId, data.outcome,
      data.error ? { error: data.error } : undefined,
    );
    if (!applied && data.retries < MAX_OUTCOME_RETRIES) {
      await this.deps.scheduleQueue.armDelayed(
        `outcome-retry-${data.runId}-${data.stepId}`,
        OUTCOME_RETRY_DELAY_MS,
        { ...data, kind: 'outcome-retry', retries: data.retries + 1 },
      );
    } else if (!applied) {
      logger.warn(`[Pipeline] outcome dropped after retries: ${data.runId}/${data.stepId}`, { component: COMPONENT });
    }
  }

  private async detectClarifySeal(
    owner: PipelineOwner,
    runId: string,
    stepId: string,
    jobId: string,
  ): Promise<{ question: string; toolUseId?: string } | null> {
    try {
      const run = await this.getRun(runId);
      const stepDef = run?.defSnapshot?.steps.find((s) => s.id === stepId);
      if (!run || !stepDef || isApprovalStep(stepDef)) return null;
      const ref = parseCustomJobRef(stepDef.customJobRef);
      if (!ref) return null;
      const containerPath = this.deps.workspaceResolver.getUniversalContainerPath(owner, run.projectId);
      const sessionPath = getSessionFilePath(containerPath, ref.agentId, ref.jobId);
      // Bound the read on its own descriptor (M-NEW-029): the scheduler hot path
      // must not sync-read and JSON-parse an unbounded session. Oversize throws
      // and is swallowed by the catch below (treated as "no clarify seal").
      const raw = readSessionTextBounded(sessionPath);
      if (raw === null) return null;
      const session = JSON.parse(raw);
      const state = session?.state ?? session;
      if (state?.awaitingClarify !== true || state?.jobId !== jobId) return null;
      return {
        question: typeof state.clarifyQuestion === 'string' ? state.clarifyQuestion : '',
        ...(typeof state.clarifyToolUseId === 'string' && { toolUseId: state.clarifyToolUseId }),
      };
    } catch {
      return null;
    }
  }

  // ============================================
  // Clarify HITL (open-ended wait; funnel key = ant:pipe:job:{jobId})
  // ============================================

  /**
   * Park a step whose job sealed awaiting a clarify answer. Guarded on
   * (`running`, same jobId) so duplicate/stale status events no-op. The wait
   * is open-ended — no timeout arm; run cancel / deactivation are the escape
   * hatches. `ant:pipe:job:{jobId}` is NOT deleted: it is the answer funnel.
   */
  private async enterAwaitingClarify(data: PipelineClarifyEnterJobData): Promise<void> {
    const { owner, pipelineId, projectId, runId, stepId, jobId } = data;
    const askedAt = new Date().toISOString();
    let record: ClarifyRecord | undefined;
    const result = await this.mutateRun(owner, runId, async (live) => {
      const step = live.steps.find((s) => s.stepId === stepId);
      if (!step || this.isTerminal(live.status) || step.status !== 'running' || step.jobId !== jobId) {
        return { run: live, dispatches: [] };
      }
      const round = (step.clarify?.round ?? 0) + 1;
      record = {
        clarifyId: `clr-${runId}-${stepId}-${round}`,
        jobId,
        question: data.question,
        ...(data.toolUseId && { toolUseId: data.toolUseId }),
        round,
        askedAt,
      };
      const steps = live.steps.map((s): StepRecord =>
        s.stepId === stepId ? { ...s, status: 'awaiting_clarify', clarify: record } : s,
      );
      const policy = live.defSnapshot?.defaults?.onStepFailure ?? 'abort';
      return { run: { ...live, steps, status: deriveRunStatus(steps, policy) }, dispatches: [] };
    });
    if (!result) {
      // Lock starvation would leave the step `running` forever — bounded
      // re-arm, parity with outcome-retry.
      if (data.retries < MAX_OUTCOME_RETRIES) {
        await this.deps.scheduleQueue.armDelayed(`clarify-enter-${runId}-${stepId}`, OUTCOME_RETRY_DELAY_MS, {
          ...data,
          retries: data.retries + 1,
        });
      } else {
        logger.warn(`[Pipeline] clarify-enter dropped after retries: ${runId}/${stepId}`, { component: COMPONENT });
      }
      return;
    }
    if (!record) return; // guard rejected — stale/duplicate event

    // The funnel key must outlive the open-ended wait (PIPE.JOB is 7d) —
    // align with the ACTIVE overlap bound.
    await this.deps.stateStore.setKeyWithTTL(
      REDIS_KEYS.PIPE.JOB(jobId),
      JSON.stringify({ runId, stepId, pipelineId, projectId, owner }),
      REDIS_TTL.PIPE.ACTIVE,
    );

    await this.appendEvent(owner, projectId, {
      ts: askedAt,
      event: 'awaiting_human',
      runId,
      stepId,
      jobId,
      detail: { kind: 'clarify', clarifyId: record.clarifyId, question: record.question, round: record.round },
    });
    await this.publish(owner, {
      cause: 'clarifyRequested',
      projectId,
      clarify: {
        kind: 'clarify',
        gateId: record.clarifyId,
        cardId: record.clarifyId,
        runId,
        pipelineId,
        pipelineName: result.run.defSnapshot?.name ?? pipelineId,
        projectId,
        stepId,
        prompt: record.question,
        armedAt: askedAt,
        jobId,
      },
    });
    await this.publish(owner, { cause: 'runUpdate', projectId, pipelineId, run: this.publicRun(result.run) });
  }

  /**
   * Clarify answer funnel — called by the chat choice-resolved branch
   * (in-app card) and the pipelines clarify route (inbox/API). Returns false
   * when the jobId maps to no pipeline step (interactive clarify cards hit
   * this as a safe no-op) or the step is no longer awaiting this clarify
   * (already answered / cancelled / deactivated). On success the SAME step is
   * re-dispatched through the single dispatch owner with the answer as its
   * directive — the universal runner's dangling-tool_use detection makes the
   * new job a structural resume (jobId re-pointing).
   */
  async applyClarifyAnswer(params: {
    jobId: string;
    answer: string;
    answeredBy?: string;
    via: 'in-app' | 'api';
  }): Promise<boolean> {
    const raw = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.JOB(params.jobId));
    if (!raw) return false;
    const { runId, stepId, pipelineId, projectId, owner } = JSON.parse(raw) as {
      runId: string;
      stepId: string;
      pipelineId: string;
      projectId: string;
      owner: PipelineOwner;
    };

    const answeredAt = new Date().toISOString();
    let resolved: ClarifyRecord | undefined;
    const result = await this.mutateRun(owner, runId, async (live) => {
      const step = live.steps.find((s) => s.stepId === stepId);
      if (
        !step ||
        this.isTerminal(live.status) ||
        step.status !== 'awaiting_clarify' ||
        step.clarify?.jobId !== params.jobId
      ) {
        return { run: live, dispatches: [] };
      }
      resolved = {
        ...step.clarify,
        answeredBy: params.answeredBy,
        answeredAt,
        answer: params.answer.slice(0, 500),
        via: params.via,
      };
      const steps = live.steps.map((s): StepRecord =>
        s.stepId === stepId ? { ...s, status: 'dispatched', clarify: resolved } : s,
      );
      const policy = live.defSnapshot?.defaults?.onStepFailure ?? 'abort';
      return { run: { ...live, steps, status: deriveRunStatus(steps, policy) }, dispatches: [] };
    });
    if (!result || !resolved) return false;

    // Post-apply ordering (gate precedent): the funnel key dies only after
    // the flip landed, so a crash mid-apply keeps the answer recoverable.
    await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.JOB(params.jobId)).catch(() => {});
    await this.appendEvent(owner, projectId, {
      ts: answeredAt,
      event: 'human_resolved',
      runId,
      stepId,
      jobId: params.jobId,
      detail: {
        kind: 'clarify',
        clarifyId: resolved.clarifyId,
        round: resolved.round,
        answer: resolved.answer,
        answeredBy: params.answeredBy,
        via: params.via,
      },
    });
    await this.publish(owner, {
      cause: 'clarifyAnswered',
      projectId,
      pipelineId,
      runId,
      stepId,
      clarifyId: resolved.clarifyId,
      answeredBy: params.answeredBy,
    });
    await this.publish(owner, { cause: 'runUpdate', projectId, pipelineId, run: this.publicRun(result.run) });

    const def = result.run.defSnapshot;
    const stepDef = def?.steps.find((s) => s.id === stepId);
    if (def && stepDef && !isApprovalStep(stepDef)) {
      await this.dispatchJobStep(owner, def, result.run, stepDef, 0, params.answer);
    }
    return true;
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
  ): Promise<boolean> {
    const result = await this.mutateRun(owner, runId, async (live, def) => {
      if (!def) return { run: live, dispatches: [] };
      const already = live.steps.find((s) => s.stepId === stepId);
      // `awaiting_clarify` refuses outcomes too: a stale outcome-retry must
      // never clobber a step parked on a human answer.
      if (!already || this.isTerminal(live.status) || ['succeeded', 'failed', 'skipped', 'cancelled', 'awaiting_clarify'].includes(already.status)) {
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

    if (result.dispatches.length > 0) {
      const def = result.run.defSnapshot!;
      await this.executeDispatches(owner, def, result.run, result.dispatches);
    } else if (this.isTerminal(result.run.status)) {
      await this.finalizeRun(owner, result.run);
    }
    await this.publish(owner, { cause: 'runUpdate', projectId: result.run.projectId, pipelineId: result.run.pipelineId, run: this.publicRun(result.run) });
    return true;
  }

  async cancelRun(owner: PipelineOwner, runId: string): Promise<boolean> {
    const result = await this.mutateRun(owner, runId, async (live) => {
      if (this.isTerminal(live.status)) return { run: live, dispatches: [] };
      const steps = live.steps.map((s): StepRecord =>
        s.status === 'pending' || s.status === 'awaiting_gate' || s.status === 'awaiting_clarify' || s.status === 'dispatched'
          ? { ...s, status: 'cancelled', endedAt: new Date().toISOString() }
          : s,
      );
      return { run: { ...live, steps, status: 'cancelled' as const }, dispatches: [] };
    });
    if (!result) return false;
    // Disarm any gates and clarify funnel keys the cancel just swept.
    for (const s of result.run.steps) {
      if (s.gate && !s.gate.decision) {
        await this.deps.scheduleQueue.cancelDelayed(`gto-${s.gate.gateId}`);
        await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(s.gate.gateId)).catch(() => {});
        await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(s.gate.cardId)).catch(() => {});
      }
      if (s.clarify && !s.clarify.answeredAt) {
        await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.JOB(s.clarify.jobId)).catch(() => {});
      }
    }
    await this.finalizeRun(owner, result.run);
    await this.publish(owner, { cause: 'runUpdate', projectId: result.run.projectId, pipelineId: result.run.pipelineId, run: this.publicRun(result.run) });
    return true;
  }

  /**
   * Deactivation side effects owned by the coordinator: cancel the live run
   * (gates disarmed inside cancelRun) and KILL any step job still running —
   * mirrors the `/jobs/:jobId/stop` legs (mark-user-stopped + poison + STOP
   * pub/sub; the seal arrives via the normal worker-exit path and no-ops
   * against the already-terminal run). The activation file/keys/cron are the
   * ROUTE's responsibility — this method never touches activation state.
   */
  async deactivate(owner: PipelineOwner, projectId: string): Promise<void> {
    const runId = await this.getActiveRunId(owner, projectId);
    if (!runId) return;
    const run = await this.getRun(runId);
    if (run && !this.isTerminal(run.status)) {
      for (const step of run.steps) {
        if (step.status !== 'running' || !step.jobId) continue;
        try {
          await this.deps.stateStore.markUserStopped(step.jobId);
          await this.deps.stateStore.acquireLock(`ant:job-poisoned:${step.jobId}`, 600).catch(() => false);
          await this.deps.stateStore.publish(REDIS_CHANNELS.JOB_WORKER.STOP, {
            jobId: step.jobId,
            projectId: run.projectId,
            featureName: UNIVERSAL_FEATURE,
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          logger.warn(`[Pipeline] failed to stop step job ${step.jobId}`, { component: COMPONENT }, e);
        }
      }
      await this.cancelRun(owner, runId);
    }
  }

  private async finalizeRun(owner: PipelineOwner, run: RunRecord): Promise<void> {
    const endedAt = run.endedAt ?? new Date().toISOString();
    const sealed: RunRecord = { ...run, endedAt };
    await this.saveRun(sealed);
    await this.appendEvent(owner, run.projectId, {
      ts: endedAt,
      event: 'run_finished',
      runId: run.runId,
      detail: { status: run.status, run: this.publicRun(sealed) },
    });
    await appendRunIndex(deriveActivationsRoot(this.tenantCtx(owner)), run.projectId, {
      runId: run.runId,
      pipelineId: run.pipelineId,
      projectId: run.projectId,
      status: run.status,
      firedBy: run.firedBy,
      fireEpoch: run.fireEpoch,
      startedAt: run.startedAt,
      endedAt,
      ...(run.error && { error: run.error }),
    });
    const activeKey = REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, run.projectId);
    const holder = await this.deps.stateStore.getKey(activeKey);
    if (holder === run.runId) {
      await this.deps.stateStore.deleteKey(activeKey).catch(() => {});
    }
    await this.emitRunFinishedNotice(owner, sealed);
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
    const text =
      run.status === 'completed'
        ? `✅ 파이프라인 "${name}" 실행이 완료되었습니다. (run: ${run.runId})`
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
  // Run projection (Redis JSON doc, single writer under per-run lock)
  // ============================================

  async getRun(runId: string): Promise<RunRecord | null> {
    const raw = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.RUN(runId));
    return raw ? (JSON.parse(raw) as RunRecord) : null;
  }

  /** Disk fallback for terminal runs whose projection has expired. */
  readRunFromDisk(owner: PipelineOwner, projectId: string, runId: string): RunRecord | null {
    const events = readRunEvents(deriveActivationsRoot(this.tenantCtx(owner)), projectId, runId);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const detail = events[i]?.detail as { run?: RunRecord } | undefined;
      if (events[i].event === 'run_finished' && detail?.run) return detail.run;
    }
    return null;
  }

  private async saveRun(run: RunRecord): Promise<void> {
    // Open-ended human waits (gate without timeout, clarify) must outlive the
    // 7d projection TTL — align with the ACTIVE overlap bound while awaiting.
    const awaiting = run.steps.some((s) => s.status === 'awaiting_gate' || s.status === 'awaiting_clarify');
    const ttl = awaiting ? REDIS_TTL.PIPE.ACTIVE : REDIS_TTL.PIPE.RUN;
    await this.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.RUN(run.runId), JSON.stringify(run), ttl);
  }

  private async mutateRun(
    owner: PipelineOwner,
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

  /** Overlap-guard holder for one ACTIVATION (projectId-keyed). */
  async getActiveRunId(owner: PipelineOwner, projectId: string): Promise<string | null> {
    return this.deps.stateStore.getKey(REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, projectId));
  }

  /** Pending gates across the caller's own activations (disk-derived scan). */
  async listPendingApprovals(owner: PipelineOwner): Promise<PipelinePendingApproval[]> {
    const out: PipelinePendingApproval[] = [];
    for (const { projectId } of listAccountActivations(deriveActivationsRoot(this.tenantCtx(owner)))) {
      const runId = await this.getActiveRunId(owner, projectId);
      if (!runId) continue;
      const run = await this.getRun(runId);
      if (!run) continue;
      for (const s of run.steps) {
        if (s.status === 'awaiting_gate' && s.gate) {
          out.push({
            gateId: s.gate.gateId,
            cardId: s.gate.cardId,
            runId,
            pipelineId: run.pipelineId,
            pipelineName: run.defSnapshot?.name ?? run.pipelineId,
            projectId: run.projectId,
            stepId: s.stepId,
            prompt: s.gate.prompt,
            armedAt: s.gate.armedAt,
            timeoutAt: s.gate.timeoutAt,
          });
        } else if (s.status === 'awaiting_clarify' && s.clarify) {
          out.push({
            kind: 'clarify',
            gateId: s.clarify.clarifyId,
            cardId: s.clarify.clarifyId,
            runId,
            pipelineId: run.pipelineId,
            pipelineName: run.defSnapshot?.name ?? run.pipelineId,
            projectId: run.projectId,
            stepId: s.stepId,
            prompt: s.clarify.question,
            armedAt: s.clarify.askedAt,
            jobId: s.clarify.jobId,
          });
        }
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

  private async appendEvent(owner: PipelineOwner, projectId: string, event: PipelineRunEvent): Promise<void> {
    try {
      await appendRunEvent(deriveActivationsRoot(this.tenantCtx(owner)), projectId, event);
    } catch (err) {
      logger.warn(`[Pipeline] run-event append failed: ${projectId}/${event.runId}`, { component: COMPONENT }, err);
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
