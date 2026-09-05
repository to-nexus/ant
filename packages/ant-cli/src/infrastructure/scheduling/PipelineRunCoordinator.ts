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
  defaultStepDirective,
  isApprovalStep,
  parseCustomJobRef,
  parsePipelineDuration,
  DEFAULT_PIPELINE_CAPS,
  DIRECTIVE_MAX_CHARS,
  MAX_CHAIN_DEPTH,
  MAX_GATE_REMINDERS,
  MAX_STEP_RETRY,
  PIPELINE_STEP_OUTPUT_MAX_CHARS,
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
  type StepOutputRecord,
  type StepRecord,
} from '@ant/shared';
import type { StateStorePort } from '../../core/ports/stateStore';
import type {
  ScheduleQueuePort,
  PipelineApprovalEnterJobData,
  PipelineClarifyEnterJobData,
  PipelineControlJobData,
  PipelineFireJobData,
  PipelineGateRemindJobData,
  PipelineOwner,
  PipelineStepTimeoutJobData,
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
  readRunIndex,
} from '../../core/pipelines/store';
import {
  resolveUniversalExecuteContext,
  validateUniversalTurnMeta,
  findDuplicateActiveJob,
  checkStartCredits,
  expandArtifactGlobsBounded,
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
/** Interruption reasons that are infrastructure's fault — retry-eligible. A human stop/pause is not. */
const INFRA_INTERRUPTION_REASONS: ReadonlySet<string> = new Set(['worker_stalled', 'server_shutdown']);

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
      pipeline?: { pipelineId: string; runId: string; stepId: string; firedBy: 'cron' | 'manual' | 'event' },
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
  /** Absent/'gate' = an approval STEP; 'tool' = a paused approval-gated tool call. */
  kind?: 'gate' | 'tool';
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
  /** kind:'tool' — the approval-gated tool name (the approve re-dispatch grant). */
  tool?: string;
  /** kind:'tool' — the paused job (stale-arm guard on resume). */
  jobId?: string;
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
      case 'gate-remind':
        return this.handleGateRemind(data);
      case 'step-retry':
        return this.handleStepRetry(data.owner, data.runId, data.stepId, data.retries, data.directiveOverride);
      case 'step-timeout':
        return this.handleStepTimeout(data);
      case 'outcome-retry':
        return this.handleOutcomeRetry(data);
      case 'clarify-enter':
        return this.enterAwaitingClarify(data);
      case 'approval-enter':
        return this.enterAwaitingToolApproval(data);
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

    // Chain-depth loop guard (caps doctrine: enforce at fire, skip + log).
    if ((data.chainDepth ?? 0) > MAX_CHAIN_DEPTH) {
      logger.warn(
        `[Pipeline] chained fire skipped — depth ${data.chainDepth} exceeds ${MAX_CHAIN_DEPTH}: ${pipelineId} on ${projectId}`,
        { component: COMPONENT },
      );
      return;
    }

    const fireEpoch = data.fireEpoch ?? Math.floor(intendedFireAt / 60_000) * 60_000;

    // Missed-fire policy (cron only; manual fires are always "now").
    if (data.firedBy === 'cron' && Date.now() - intendedFireAt > STALE_FIRE_MS) {
      if ((def.on?.schedule?.onMissed ?? 'skip') === 'skip') {
        logger.info(`[Pipeline] missed fire skipped: ${pipelineId} @ ${new Date(fireEpoch).toISOString()}`, { component: COMPONENT });
        return;
      }
    }

    // Fire idempotency (attempts:3 on the control queue + multi-replica).
    const firedKey = REDIS_KEYS.PIPE.FIRED(owner.organizationId, owner.userId, projectId, fireEpoch);
    if (!(await this.deps.stateStore.acquireLock(firedKey, REDIS_TTL.PIPE.FIRED))) return;

    // Cap: bound the activator's simultaneously-live runs across all of their
    // activations. Counted and reserved in ONE step — the previous shape read a
    // count, compared it, and only reserved much later, so two activations
    // firing at once both passed an N-1 cap (L-031). Same primitive, same
    // reasoning as the SSE connection slot (M-005). Member is the projectId, so
    // a retry of the same activation refreshes rather than double-counting.
    const slotKey = REDIS_KEYS.PIPE.RUN_SLOTS(owner.organizationId, owner.userId);
    const reserved = await this.deps.stateStore.reserveSlot(
      slotKey,
      projectId,
      DEFAULT_PIPELINE_CAPS.maxConcurrentRuns,
      REDIS_TTL.PIPE.ACTIVE,
    );
    if (!reserved) {
      logger.warn(
        `[Pipeline] fire skipped — maxConcurrentRuns reached (${DEFAULT_PIPELINE_CAPS.maxConcurrentRuns}): ${pipelineId}`,
        { component: COMPONENT },
      );
      await this.deps.stateStore.releaseLock(firedKey).catch(() => {});
      return;
    }

    // Overlap guard — one live run per ACTIVATION (the same pipeline may run
    // concurrently on other projects).
    const runId = generateHumanId();
    const activeKey = REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, projectId);
    const acquired = await this.deps.stateStore.tryAcquireLock(activeKey, runId, REDIS_TTL.PIPE.ACTIVE);
    if (!acquired) {
      await this.deps.stateStore.releaseSlot(slotKey, projectId).catch(() => {});
      const overlap = def.on?.schedule?.overlap ?? 'skip';
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

    // Cross-run watermark, frozen at fire so every step of this run sees the
    // same value ({{run.prevSuccess.*}}): the newest COMPLETED run of this
    // pipeline on this activation.
    let prevSuccessFireEpoch: number | undefined;
    try {
      prevSuccessFireEpoch = readRunIndex(deriveActivationsRoot(this.tenantCtx(owner)), projectId, 50, pipelineId)
        .find((e) => e.status === 'completed')?.fireEpoch;
    } catch {
      prevSuccessFireEpoch = undefined;
    }

    const run: RunRecord = {
      runId,
      pipelineId,
      projectId,
      firedBy: data.firedBy,
      fireEpoch,
      status: 'running',
      steps: buildInitialSteps(def),
      startedAt: new Date().toISOString(),
      defSnapshot: def,
      activationSnapshot: activation,
      ...(prevSuccessFireEpoch !== undefined && { prevSuccessFireEpoch }),
      ...(data.chainDepth !== undefined && { chainDepth: data.chainDepth }),
    };

    await this.appendEvent(owner, projectId, { ts: run.startedAt, event: 'fired', runId, detail: { firedBy: run.firedBy, fireEpoch, projectId } });
    const plan = planAdvance(def, run);
    await this.saveRun(plan.run);
    await this.publish(owner, { cause: 'runUpdate', projectId: run.projectId, pipelineId, run: this.publicRun(plan.run) });
    await this.executeDispatches(owner, def, plan.run, plan.dispatches);
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

  /** Static whitelist substitution — shared by directives and context pins. */
  private renderStaticVars(template: string, run: RunRecord): string {
    const prev = run.prevSuccessFireEpoch;
    return template
      .replace(/\{\{\s*trigger\.fireDate\s*\}\}/g, new Date(run.fireEpoch).toISOString())
      .replace(/\{\{\s*trigger\.fireEpoch\s*\}\}/g, String(run.fireEpoch))
      .replace(/\{\{\s*run\.id\s*\}\}/g, run.runId)
      // Cross-run watermark — the first run renders empty.
      .replace(/\{\{\s*run\.prevSuccess\.fireDate\s*\}\}/g, prev !== undefined ? new Date(prev).toISOString() : '')
      .replace(/\{\{\s*run\.prevSuccess\.fireEpoch\s*\}\}/g, prev !== undefined ? String(prev) : '');
  }

  private renderDirective(template: string, run: RunRecord): string {
    const outputOf = (stepId: string) => run.steps.find((s) => s.stepId === stepId)?.output;
    return this.renderStaticVars(template, run)
      // Step-output substitution — validated at save time against the needs
      // closure, so the referenced step is terminal here; a skipped/no-output
      // upstream renders empty (recorded as unresolved on the dispatch event).
      .replace(/\{\{\s*steps\.([a-z0-9-]+)\.answer\s*\}\}/g, (_, id: string) => outputOf(id)?.answer ?? '')
      .replace(/\{\{\s*steps\.([a-z0-9-]+)\.artifacts\s*\}\}/g, (_, id: string) => (outputOf(id)?.artifacts ?? []).join('\n'));
  }

  /** Step-output refs in the template that render empty — dispatch-event audit detail. */
  private unresolvedStepRefs(template: string, run: RunRecord): string[] {
    const out: string[] = [];
    const re = /\{\{\s*(steps\.([a-z0-9-]+)\.(answer|artifacts))\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template)) !== null) {
      const output = run.steps.find((s) => s.stepId === m![2])?.output;
      const value = m[3] === 'answer' ? output?.answer : output?.artifacts?.join('');
      if (!value) out.push(m[1]);
    }
    return [...new Set(out)];
  }

  private async dispatchJobStep(
    owner: PipelineOwner,
    def: PipelineDef,
    run: RunRecord,
    step: JobStepDef,
    retries: number,
    directiveOverride?: string,
    approvalGrantTool?: string,
  ): Promise<void> {
    const pipelineId = run.pipelineId;
    // Standing failures (approval/membership/credits/definition/meta) never
    // retry — they are deterministic until a person changes something.
    const fail = (reason: string, retryableFailure = false) =>
      retryableFailure
        ? this.failStepOrRetry(owner, run.runId, step.id, reason)
        : this.applyOutcome(owner, run.runId, step.id, 'failed', { error: reason });

    // Owner-standing gates — re-judged at EVERY step dispatch, never once at
    // registration (revocation/credit-drain take effect mid-chain).
    if (await this.deps.checkApproval(owner)) return void (await fail('account-not-approved'));
    if (!(await this.deps.checkTeamMembership(owner))) return void (await fail('membership-revoked'));
    const lowCredits = await checkStartCredits(owner, this.deps.getCreditLedger);
    if (lowCredits) return void (await fail('insufficient-credits'));

    // Definition + turn-meta accept gates (same owners as the HTTP route).
    const resolved = await resolveUniversalExecuteContext(this.deps.workspaceResolver, owner, run.projectId, step.customJobRef);
    if (!resolved.ok) return void (await fail(`${resolved.code}: ${resolved.error}`));
    // Pins render their STATIC template vars before expansion/existence
    // checks — `reports/{{trigger.fireDate}}/**` addresses exactly this run's
    // partition (run-scoped pin isolation; steps.* refs are validator-refused).
    const renderedContext = (step.context ?? []).map((pin) => this.renderStaticVars(pin, run));
    const meta = await validateUniversalTurnMeta(
      resolved.containerPath,
      resolved.intentIds,
      step.intent ? [step.intent] : [],
      renderedContext,
      undefined,
      resolved.builtinTools,
      resolved.scopeRoots,
      // Glob pins (upstream stop-hook artifact contracts) expand here only —
      // interactive @ctx stays concrete-path-only.
      { expandContextGlobs: true },
    );
    if (!meta.ok) return void (await fail(`${meta.code}: ${meta.error}`));

    // Project-level duplicate gate — with the pipeline-owned project gate on
    // the interactive side AND the executor's one-job-in-flight rule, the only
    // collision left is the seal race between a finishing step's job (status
    // record lagging the pub/sub event) and this dispatch: 1–2 re-arms absorb it.
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
    // An empty/absent step directive dispatches the shared default — the
    // definition (base docs + intent) is the work statement in that case.
    const template = step.directive?.trim() ? step.directive : defaultStepDirective(step.intent);
    const directive = directiveOverride ?? this.renderDirective(template, run);
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
        // Every pipeline dispatch is UNATTENDED: approval-gated tool calls
        // pause for the inbox instead of the interactive fail-closed reject.
        // The grant rides only the approve re-dispatch (one turn, one tool).
        universalTurnMeta: {
          intents: meta.meta?.intents ?? [],
          context: meta.meta?.context ?? [],
          ...(meta.meta?.plan && { plan: true }),
          unattended: true,
          ...(approvalGrantTool && { approvalGrantTool }),
        },
        firedBy: 'schedule',
        pipelineRunId: run.runId,
        pipelineStepId: step.id,
        seedTurnId: turnId,
      });
      jobId = result.jobId;
    } catch (e) {
      return void (await fail(`enqueue-failed: ${e instanceof Error ? e.message : String(e)}`, true));
    }

    if (isFirstTurn && this.deps.chatService) {
      const startedText = run.firedBy === 'cron'
        ? `🔁 파이프라인 "${def.name}" 실행이 시작되었습니다. (run: ${run.runId})`
        : run.firedBy === 'event'
          ? `🔗 선행 파이프라인 완료로 "${def.name}" 실행이 시작되었습니다. (run: ${run.runId})`
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
    // Wall-clock bound for THIS round — re-armed (same id) on every
    // re-dispatch, cancelled on outcome / clarify park / run cancel.
    if (step.timeout) {
      const timeoutMs = parsePipelineDuration(step.timeout.after);
      if (timeoutMs) {
        await this.deps.scheduleQueue.armDelayed(`sto-${run.runId}-${step.id}`, timeoutMs, {
          kind: 'step-timeout',
          owner,
          pipelineId,
          projectId: run.projectId,
          runId: run.runId,
          stepId: step.id,
          jobId,
        });
      }
    }
    const unresolvedTemplates = directiveOverride ? [] : this.unresolvedStepRefs(template, run);
    await this.appendEvent(owner, run.projectId, {
      ts: new Date().toISOString(),
      event: 'step_dispatched',
      runId: run.runId,
      stepId: step.id,
      jobId,
      detail: {
        turnId,
        ...(meta.contextExpanded && { contextExpanded: meta.contextExpanded }),
        ...(unresolvedTemplates.length > 0 && { unresolvedTemplates }),
      },
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

    // Tool-approval APPROVE resumes the step instead of sealing an outcome:
    // the paused job re-dispatches with the decision as the dangling call's
    // tool_result and a one-turn grant for the tool. REJECT falls through to
    // the normal failed outcome below (`on: failure` consumes it).
    if (hitl.kind === 'tool' && approved) {
      let resumed = false;
      const result = await this.mutateRun(hitl.owner, hitl.runId, async (live) => {
        const step = live.steps.find((s) => s.stepId === hitl.stepId);
        if (!step || this.isTerminal(live.status) || step.status !== 'awaiting_gate' || step.gate?.gateId !== gateId) {
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
      await this.appendEvent(hitl.owner, hitl.projectId, {
        ts: decidedAt,
        event: 'human_resolved',
        runId: hitl.runId,
        stepId: hitl.stepId,
        gateId,
        detail: { kind: 'tool', tool: hitl.tool, decision, decidedBy, via },
      });
      await this.publish(hitl.owner, {
        cause: 'approvalResolved',
        projectId: hitl.projectId,
        pipelineId: hitl.pipelineId,
        runId: hitl.runId,
        gateId,
        decision,
        decidedBy,
      });
      await this.publish(hitl.owner, { cause: 'runUpdate', projectId: hitl.projectId, pipelineId: hitl.pipelineId, run: this.publicRun(result.run) });
      const def = result.run.defSnapshot;
      const stepDef = def?.steps.find((s) => s.id === hitl.stepId);
      if (def && stepDef && !isApprovalStep(stepDef) && hitl.tool) {
        await this.dispatchJobStep(
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
    );
    // Keys are deleted only AFTER the outcome landed — a crash/lock-starved
    // apply keeps the HITL record recoverable (the timeout arm re-funnels).
    if (!applied) return false;
    await this.deps.scheduleQueue.cancelDelayed(`gto-${gateId}`);
    await this.deps.scheduleQueue.cancelDelayed(`gre-${gateId}`);
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
    let output: StepOutputRecord | undefined;
    let verdict: string | undefined;
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
      // Tool-approval seal: the job ended awaiting a human decision on an
      // approval-gated call (L3). Not an outcome — the step parks.
      const approvalSeal = await this.detectApprovalSeal(owner, runId, stepId, data.jobId);
      if (approvalSeal) {
        await this.enterAwaitingToolApproval({
          kind: 'approval-enter',
          owner,
          pipelineId,
          projectId,
          runId,
          stepId,
          jobId: data.jobId,
          toolName: approvalSeal.toolName,
          argsSummary: approvalSeal.argsSummary,
          retries: 0,
        });
        return;
      }
      // Step output + verdict capture ({{steps.*}} source, run-report summary,
      // verdict routing) — reads the same seal the clarify check just did.
      const captured = await this.captureStepOutput(owner, runId, stepId, data.jobId);
      output = captured.output;
      verdict = captured.verdict;
      // An outcome-declaring intent that sealed no valid verdict fails loudly
      // (retryable — a re-run can decide) unless onMissingVerdict fell back.
      if (captured.missingVerdict) {
        outcome = 'failed';
        error = 'missing-verdict: the intent declares outcomes but the run sealed no valid verdict';
      }
    }

    // Plain job failures, infra interruptions and missing verdicts are
    // RETRYABLE; a human stop/pause is not (nobody asked the scheduler to
    // redo what they stopped).
    const retryable =
      outcome === 'failed' &&
      (!interruption || INFRA_INTERRUPTION_REASONS.has(String(interruption.reason ?? '')));

    // A retryable failure consumes a retry round when the step declares one
    // (step_retry event + re-dispatch arm); otherwise it falls through to the
    // normal failed outcome inside the funnel.
    if (retryable) {
      const handled = await this.failStepOrRetry(owner, runId, stepId, error ?? 'job-failed', data.jobId);
      if (handled) {
        await this.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);
        return;
      }
      // Lock starvation — re-arm; the retry judgment re-runs on the re-apply.
      await this.deps.scheduleQueue.armDelayed(`outcome-retry-${runId}-${stepId}`, OUTCOME_RETRY_DELAY_MS, {
        kind: 'outcome-retry',
        owner,
        pipelineId,
        projectId,
        runId,
        stepId,
        outcome: 'failed',
        ...(error && { error }),
        jobId: data.jobId,
        retryable: true,
        retries: 0,
      });
      return;
    }

    await this.appendEvent(owner, projectId, {
      ts: new Date().toISOString(),
      event: 'step_completed',
      runId,
      stepId,
      jobId: data.jobId,
      detail: { outcome, ...(error && { error }), ...(output && { outputCaptured: true }) },
    });
    const patch = { ...(error && { error }), ...(output && { output }), ...(verdict && { verdict }) };
    const applied = await this.applyOutcome(owner, runId, stepId, outcome, Object.keys(patch).length > 0 ? patch : undefined, undefined, data.jobId);
    if (applied) {
      await this.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);
    } else {
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
        ...(output && { output }),
        jobId: data.jobId,
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
    output?: StepOutputRecord;
    jobId?: string;
    retryable?: boolean;
    retries: number;
  }): Promise<void> {
    const patch = { ...(data.error && { error: data.error }), ...(data.output && { output: data.output }) };
    const applied =
      data.outcome === 'failed' && data.retryable
        ? await this.failStepOrRetry(data.owner, data.runId, data.stepId, data.error ?? 'job-failed', data.jobId)
        : await this.applyOutcome(
            data.owner, data.runId, data.stepId, data.outcome,
            Object.keys(patch).length > 0 ? patch : undefined,
            undefined,
            data.jobId,
          );
    if (applied) {
      await this.deps.scheduleQueue.cancelDelayed(`sto-${data.runId}-${data.stepId}`);
    }
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

  /**
   * Retryable-failure funnel. When the step declares `retry` and rounds
   * remain, the round is consumed: the step flips back to `dispatched`
   * (attempts audited, jobId cleared, funnel key deleted) and a `step-retry`
   * arm re-dispatches it after the backoff with a retry preamble — a NEW
   * jobId, directive-level idempotency contract (J: the agent checks completed
   * side effects first). No budget → the normal failed outcome (with its
   * step_completed event) applies inside this funnel. Returns false only on
   * lock starvation — the caller re-arms, never drops.
   */
  private async failStepOrRetry(
    owner: PipelineOwner,
    runId: string,
    stepId: string,
    error: string,
    expectedJobId?: string,
  ): Promise<boolean> {
    interface RetryArm {
      delayMs: number;
      round: number;
      max: number;
      directiveOverride: string;
      pipelineId: string;
      projectId: string;
      oldJobId?: string;
    }
    let armed: RetryArm | null = null;
    let stale = false;
    const result = await this.mutateRun(owner, runId, async (live, def) => {
      if (!def) return { run: live, dispatches: [] };
      const record = live.steps.find((s) => s.stepId === stepId);
      const stepDef = def.steps.find((s) => s.id === stepId);
      if (!record || !stepDef || isApprovalStep(stepDef) || this.isTerminal(live.status)) {
        stale = true;
        return { run: live, dispatches: [] };
      }
      if (record.status !== 'running' && record.status !== 'dispatched') {
        stale = true;
        return { run: live, dispatches: [] };
      }
      if (expectedJobId !== undefined && record.jobId !== undefined && record.jobId !== expectedJobId) {
        stale = true;
        return { run: live, dispatches: [] };
      }
      const used = record.retriesUsed ?? 0;
      const max = Math.min(stepDef.retry?.max ?? 0, MAX_STEP_RETRY);
      if (used >= max) return { run: live, dispatches: [] }; // no budget — fall through below
      const round = used + 1;
      const attempts = [
        ...(record.attempts ?? []),
        { ...(record.jobId && { jobId: record.jobId }), error, endedAt: new Date().toISOString() },
      ].slice(-MAX_STEP_RETRY);
      const template = stepDef.directive?.trim() ? stepDef.directive : defaultStepDirective(stepDef.intent);
      const directiveOverride =
        `[Retry ${round}/${max}] The previous attempt failed: "${error}". ` +
        `Before doing anything else, check which side effects the failed attempt already completed, then perform ONLY the remaining work.\n\n` +
        this.renderDirective(template, live);
      armed = {
        delayMs: parsePipelineDuration(stepDef.retry?.backoff) ?? 60_000,
        round,
        max,
        directiveOverride,
        pipelineId: live.pipelineId,
        projectId: live.projectId,
        oldJobId: record.jobId,
      };
      const steps = live.steps.map((s): StepRecord =>
        s.stepId === stepId ? { ...s, status: 'dispatched', retriesUsed: round, attempts, jobId: undefined } : s,
      );
      return { run: { ...live, steps, status: deriveRunStatus(steps, def.defaults?.onStepFailure ?? 'abort') }, dispatches: [] };
    });
    if (!result) return false; // lock starvation — caller re-arms
    if (stale) return true; // superseded round / terminal — drop, never re-arm
    // TS cannot see the closure assignment — re-widen explicitly.
    const held = armed as RetryArm | null;
    if (!held) {
      // Budget exhausted (or no retry declared): the normal failure path,
      // with its step_completed audit line.
      await this.appendEvent(owner, result.run.projectId, {
        ts: new Date().toISOString(),
        event: 'step_completed',
        runId,
        stepId,
        detail: { outcome: 'failed', error },
      });
      return this.applyOutcome(owner, runId, stepId, 'failed', { error }, undefined, expectedJobId);
    }
    if (held.oldJobId) {
      await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.JOB(held.oldJobId)).catch(() => {});
    }
    await this.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);
    await this.appendEvent(owner, held.projectId, {
      ts: new Date().toISOString(),
      event: 'step_retry',
      runId,
      stepId,
      detail: { round: held.round, max: held.max, error, delayMs: held.delayMs },
    });
    await this.deps.scheduleQueue.armDelayed(`step-retry-${runId}-${stepId}`, held.delayMs, {
      kind: 'step-retry',
      owner,
      pipelineId: held.pipelineId,
      projectId: held.projectId,
      runId,
      stepId,
      retries: 0,
      directiveOverride: held.directiveOverride,
    });
    await this.publish(owner, { cause: 'runUpdate', projectId: held.projectId, pipelineId: held.pipelineId, run: this.publicRun(result.run) });
    return true;
  }

  /**
   * Step-timeout expiry: kill the round's job (stop legs) and fail the step —
   * retryable, so `timeout` and `retry` compose. Stale arms (a newer round's
   * jobId, a parked/terminal step) no-op.
   */
  private async handleStepTimeout(data: PipelineStepTimeoutJobData): Promise<void> {
    const run = await this.getRun(data.runId);
    if (!run || this.isTerminal(run.status)) return;
    const record = run.steps.find((s) => s.stepId === data.stepId);
    if (!record || record.status !== 'running' || record.jobId !== data.jobId) return;
    const stepDef = run.defSnapshot?.steps.find((s) => s.id === data.stepId);
    const after = stepDef && !isApprovalStep(stepDef) ? stepDef.timeout?.after : undefined;
    await this.killStepJob(data.jobId, run.projectId);
    await this.failStepOrRetry(data.owner, data.runId, data.stepId, `step-timeout: exceeded ${after ?? 'the configured bound'}`, data.jobId);
  }

  /**
   * Gate reminder: the gate is still unresolved — re-fire the SSE row and drop
   * a reminder notice on the anchor turn, then re-arm (bounded). Resolve and
   * cancel paths remove the arm (`gre-{gateId}`).
   */
  private async handleGateRemind(data: PipelineGateRemindJobData): Promise<void> {
    const raw = await this.deps.stateStore.getKey(REDIS_KEYS.PIPE.HITL(data.gateId));
    if (!raw) return; // resolved or swept
    const run = await this.getRun(data.runId);
    const record = run?.steps.find((s) => s.stepId === data.stepId);
    if (!run || !record || record.status !== 'awaiting_gate' || !record.gate || record.gate.decision) return;
    const stepDef = run.defSnapshot?.steps.find((s) => s.id === data.stepId);
    const remindAfter = stepDef && isApprovalStep(stepDef) ? stepDef.remindAfter : undefined;
    await this.publish(data.owner, {
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
   * Capture a completed step's output and verdict.
   * - `output` — the `{{steps.*}}` substitution source and the run history's
   *   business-readable summary: `.answer` = the final assistant text of the
   *   seal's `session:main` (jobId-guarded, same read channel as the clarify
   *   detection); `.artifacts` = files matching the pinned intent's
   *   `hooks.stop` globs at completion. Best-effort — failure is an absent
   *   record, never a step failure.
   * - `verdict` — the sealed decision, VALIDATED against the pinned intent's
   *   declared outcomes with the step's `onMissingVerdict` fallback applied.
   *   `missingVerdict` = the intent declares outcomes but no valid verdict
   *   resolved — the caller fails the step (retryable: a re-run can decide).
   */
  private async captureStepOutput(
    owner: PipelineOwner,
    runId: string,
    stepId: string,
    jobId: string,
  ): Promise<{ output?: StepOutputRecord; verdict?: string; missingVerdict?: boolean }> {
    const run = await this.getRun(runId).catch(() => null);
    const stepDef = run?.defSnapshot?.steps.find((s) => s.id === stepId);
    if (!run || !stepDef || isApprovalStep(stepDef)) return {};
    const ref = parseCustomJobRef(stepDef.customJobRef);
    if (!ref) return {};
    const containerPath = this.deps.workspaceResolver.getUniversalContainerPath(owner, run.projectId);

    let answer: string | undefined;
    let answerTruncated = false;
    let sealVerdict: string | undefined;
    try {
      const raw = readSessionTextBounded(getSessionFilePath(containerPath, ref.agentId, ref.jobId));
      if (raw !== null) {
        const session = JSON.parse(raw);
        const state = session?.state ?? session;
        // The seal must belong to THIS step's job — the session is shared by
        // every step of the same customJobRef.
        if (state?.jobId === jobId) {
          if (typeof state.verdict === 'string') sealVerdict = state.verdict;
          const main = state?.conversations?.['session:main'];
          if (Array.isArray(main)) {
            for (let i = main.length - 1; i >= 0; i -= 1) {
              const msg = main[i];
              if (msg?.role !== 'assistant') continue;
              const text =
                typeof msg.content === 'string'
                  ? msg.content
                  : Array.isArray(msg.content)
                    ? msg.content.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('')
                    : '';
              if (text.trim().length > 0) {
                answer = text;
                break;
              }
            }
          }
          if (answer && answer.length > PIPELINE_STEP_OUTPUT_MAX_CHARS) {
            answer = answer.slice(0, PIPELINE_STEP_OUTPUT_MAX_CHARS);
            answerTruncated = true;
          }
        }
      }
    } catch {
      /* best-effort seal read */
    }

    let artifacts: string[] | undefined;
    let declaredOutcomes: string[] = [];
    if (stepDef.intent) {
      try {
        const resolved = await resolveUniversalExecuteContext(this.deps.workspaceResolver, owner, run.projectId, stepDef.customJobRef);
        if (resolved.ok) {
          declaredOutcomes = resolved.intentOutcomes[stepDef.intent] ?? [];
          const globs = resolved.intentStopGlobs[stepDef.intent] ?? [];
          const expanded = await expandArtifactGlobsBounded(containerPath, globs);
          if (expanded.length > 0) artifacts = expanded;
        }
      } catch {
        /* best-effort */
      }
    }

    const output =
      !answer && !artifacts
        ? undefined
        : {
            ...(answer && { answer }),
            ...(answerTruncated && { answerTruncated: true }),
            ...(artifacts && { artifacts }),
            capturedAt: new Date().toISOString(),
          };

    // Verdict contract — only when the pinned intent declares a vocabulary.
    if (declaredOutcomes.length === 0) return { ...(output && { output }) };
    let verdict = sealVerdict && declaredOutcomes.includes(sealVerdict) ? sealVerdict : undefined;
    if (!verdict) {
      const fallback = stepDef.onMissingVerdict;
      if (fallback && fallback !== 'fail' && declaredOutcomes.includes(fallback)) verdict = fallback;
    }
    return { ...(output && { output }), ...(verdict ? { verdict } : { missingVerdict: true }) };
  }

  /** Same read channel as the clarify seal — the tool-approval pause markers. */
  private async detectApprovalSeal(
    owner: PipelineOwner,
    runId: string,
    stepId: string,
    jobId: string,
  ): Promise<{ toolName: string; argsSummary: string } | null> {
    try {
      const run = await this.getRun(runId);
      const stepDef = run?.defSnapshot?.steps.find((s) => s.id === stepId);
      if (!run || !stepDef || isApprovalStep(stepDef)) return null;
      const ref = parseCustomJobRef(stepDef.customJobRef);
      if (!ref) return null;
      const containerPath = this.deps.workspaceResolver.getUniversalContainerPath(owner, run.projectId);
      const raw = readSessionTextBounded(getSessionFilePath(containerPath, ref.agentId, ref.jobId));
      if (raw === null) return null;
      const session = JSON.parse(raw);
      const state = session?.state ?? session;
      if (state?.awaitingApproval !== true || state?.jobId !== jobId) return null;
      if (typeof state.approvalTool !== 'string' || state.approvalTool.length === 0) return null;
      return {
        toolName: state.approvalTool,
        argsSummary: typeof state.approvalArgsSummary === 'string' ? state.approvalArgsSummary : '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Park a step whose job sealed awaiting a TOOL APPROVAL (L3 — the third
   * HITL layer, unattended runs). The step parks `awaiting_gate` with a
   * kind:'tool' HITL record; every resolve channel is the SAME NX
   * choice-resolved funnel as an approval step. APPROVE re-dispatches the
   * step with the decision text as the dangling call's tool_result plus a
   * one-turn grant for the tool; REJECT fails the step (`on: failure`
   * consumes it). Open-ended wait — no timeout arm; run cancel and
   * deactivation are the escape hatches.
   */
  private async enterAwaitingToolApproval(data: PipelineApprovalEnterJobData): Promise<void> {
    const { owner, pipelineId, projectId, runId, stepId, jobId, toolName, argsSummary } = data;
    const gateId = `tga-${runId}-${stepId}-${jobId}`;
    const cardId = `pipe-${gateId}`;
    const armedAt = new Date().toISOString();
    const prompt = `Tool approval: ${toolName}${argsSummary ? ` ${argsSummary}` : ''}`;
    let parked = false;
    const result = await this.mutateRun(owner, runId, async (live) => {
      const step = live.steps.find((s) => s.stepId === stepId);
      if (!step || this.isTerminal(live.status) || step.status !== 'running' || step.jobId !== jobId) {
        return { run: live, dispatches: [] };
      }
      parked = true;
      const steps = live.steps.map((s): StepRecord =>
        s.stepId === stepId
          ? { ...s, status: 'awaiting_gate', gate: { gateId, cardId, prompt, armedAt } }
          : s,
      );
      const policy = live.defSnapshot?.defaults?.onStepFailure ?? 'abort';
      return { run: { ...live, steps, status: deriveRunStatus(steps, policy) }, dispatches: [] };
    });
    if (!result) {
      // Lock starvation — bounded re-arm, clarify-enter parity.
      if (data.retries < MAX_OUTCOME_RETRIES) {
        await this.deps.scheduleQueue.armDelayed(`approval-enter-${runId}-${stepId}`, OUTCOME_RETRY_DELAY_MS, {
          ...data,
          retries: data.retries + 1,
        });
      } else {
        logger.warn(`[Pipeline] approval-enter dropped after retries: ${runId}/${stepId}`, { component: COMPONENT });
      }
      return;
    }
    if (!parked) return; // stale/duplicate event

    // The paused round's wall-clock bound stands down (human wait is open-ended).
    await this.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);
    const hitl: HitlRecord = {
      kind: 'tool',
      gateId,
      cardId,
      runId,
      stepId,
      pipelineId,
      projectId,
      owner,
      onTimeout: 'reject',
      anchorJobId: jobId,
      prompt,
      tool: toolName,
      jobId,
    };
    await this.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.HITL(gateId), JSON.stringify(hitl), REDIS_TTL.PIPE.HITL);
    await this.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.CARD(cardId), gateId, REDIS_TTL.PIPE.HITL);

    if (this.deps.chatService) {
      try {
        await this.deps.chatService.appendChoicePresented(projectId, UNIVERSAL_FEATURE, {
          jobId,
          cardId,
          cardType: 'pipeline_approval',
          prompt,
          payload: {
            gateId,
            runId,
            stepId,
            pipelineId,
            pipelineName: result.run.defSnapshot?.name ?? pipelineId,
            kind: 'tool',
            tool: toolName,
          },
          userContext: owner,
        });
      } catch (e) {
        logger.warn(`[Pipeline] failed to present tool-approval card ${cardId}`, { component: COMPONENT }, e);
      }
    }

    await this.appendEvent(owner, projectId, {
      ts: armedAt,
      event: 'awaiting_human',
      runId,
      stepId,
      jobId,
      gateId,
      detail: { kind: 'tool', tool: toolName, argsSummary },
    });
    await this.publish(owner, {
      cause: 'approvalRequested',
      projectId,
      approval: {
        kind: 'tool',
        gateId,
        cardId,
        runId,
        pipelineId,
        pipelineName: result.run.defSnapshot?.name ?? pipelineId,
        projectId,
        stepId,
        prompt,
        armedAt,
        jobId,
      },
    });
    await this.publish(owner, { cause: 'runUpdate', projectId, pipelineId, run: this.publicRun(result.run) });
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

    // A human wait is open-ended by doctrine — the round's wall-clock bound
    // stands down; the answer re-dispatch re-arms it.
    await this.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);

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
    expectedJobId?: string,
  ): Promise<boolean> {
    const result = await this.mutateRun(owner, runId, async (live, def) => {
      if (!def) return { run: live, dispatches: [] };
      const already = live.steps.find((s) => s.stepId === stepId);
      // `awaiting_clarify` refuses outcomes too: a stale outcome-retry must
      // never clobber a step parked on a human answer.
      if (!already || this.isTerminal(live.status) || ['succeeded', 'failed', 'skipped', 'cancelled', 'awaiting_clarify'].includes(already.status)) {
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
    // Kill targets are captured under the per-run lock so a step sealing
    // concurrently cannot slip past both the sweep and the kill.
    const killTargets: Array<{ jobId: string; projectId: string }> = [];
    let mutated = false;
    const result = await this.mutateRun(owner, runId, async (live) => {
      if (this.isTerminal(live.status)) return { run: live, dispatches: [] };
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
    await this.publish(owner, { cause: 'runUpdate', projectId: result.run.projectId, pipelineId: result.run.pipelineId, run: this.publicRun(result.run) });
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
    const runId = await this.getActiveRunId(owner, projectId);
    if (!runId) return;
    const run = await this.getRun(runId);
    if (run && !this.isTerminal(run.status)) {
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
      activations = listAccountActivations(deriveActivationsRoot(this.tenantCtx(owner)));
    } catch {
      return;
    }
    for (const { projectId } of activations) {
      // A pipeline never chains onto its own project — that run just finished.
      if (projectId === run.projectId) continue;
      try {
        const activation = loadActivationByProject(deriveActivationsRoot(this.tenantCtx(owner)), projectId);
        if (!activation) continue;
        const defRoot = resolveDefRoot(this.tenantCtx(owner), activation.pipelineScope);
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

  /**
   * Take down one armed-but-orphaned gate: timeout/remind arms, HITL record,
   * card key, and a run-log line so the audit trail says why the card
   * vanished. Idempotent — every key delete tolerates absence.
   */
  private async disarmGate(owner: PipelineOwner, run: RunRecord, step: StepRecord): Promise<void> {
    const gate = step.gate;
    if (!gate) return;
    await this.deps.scheduleQueue.cancelDelayed(`gto-${gate.gateId}`);
    await this.deps.scheduleQueue.cancelDelayed(`gre-${gate.gateId}`);
    await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(gate.gateId)).catch(() => {});
    await this.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(gate.cardId)).catch(() => {});
    await this.appendEvent(owner, run.projectId, {
      ts: new Date().toISOString(),
      event: 'step_completed',
      runId: run.runId,
      stepId: step.stepId,
      gateId: gate.gateId,
      detail: { outcome: 'cancelled', reason: 'gate-orphaned-by-abort' },
    });
  }

  private async mutateRun(
    owner: PipelineOwner,
    runId: string,
    fn: (run: RunRecord, def: PipelineDef | undefined) => Promise<{ run: RunRecord; dispatches: StepDispatch[] }>,
  ): Promise<{ run: RunRecord; dispatches: StepDispatch[] } | null> {
    const lockKey = REDIS_KEYS.PIPE.RUN_LOCK(runId);
    for (let attempt = 0; attempt < RUN_LOCK_RETRIES; attempt += 1) {
      if (await this.deps.stateStore.acquireLock(lockKey, REDIS_TTL.PIPE.RUN_LOCK)) {
        let result: { run: RunRecord; dispatches: StepDispatch[] } | null = null;
        let orphanedGates: StepRecord[] = [];
        try {
          const live = await this.getRun(runId);
          if (!live) return null;
          result = await fn(live, live.defSnapshot);
          await this.saveRun(result.run);
          // Any step this mutation turned `cancelled` while it still held an
          // undecided gate is an orphaned human wait (the abort cascade's
          // armed gate, §5). The executor owns the state change; the arms,
          // the HITL record and the card are ours to take down — otherwise
          // the inbox keeps a decision nobody can act on.
          const wasWaiting = new Set(
            live.steps.filter((s) => s.status === 'awaiting_gate').map((s) => s.stepId),
          );
          orphanedGates = result.run.steps.filter(
            (s) => s.status === 'cancelled' && wasWaiting.has(s.stepId) && s.gate && !s.gate.decision,
          );
        } finally {
          await this.deps.stateStore.releaseLock(lockKey).catch(() => {});
        }
        for (const step of orphanedGates) await this.disarmGate(owner, result!.run, step);
        return result;
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
          // A JOB step parked awaiting_gate is a paused tool call (L3), never
          // an authored approval step — the SSE payload already says so; the
          // disk-derived inbox row must not lose the kind. Snapshot-less runs
          // fall back to the tool-gate id prefix.
          const stepDef = run.defSnapshot?.steps.find((d) => d.id === s.stepId);
          const isTool = stepDef ? !isApprovalStep(stepDef) : s.gate.gateId.startsWith('tga-');
          out.push({
            ...(isTool && { kind: 'tool' as const }),
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
            ...(isTool && s.jobId && { jobId: s.jobId }),
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
    return status === 'completed' || status === 'failed' || status === 'partial' || status === 'cancelled';
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
      // The wire stays lean: captured step answers (≤16k each) ride the run
      // JSONL and the runs API, never the SSE fan-out.
      const payload: PipelineEventData =
        data.cause === 'runUpdate'
          ? {
              ...data,
              run: {
                ...data.run,
                steps: data.run.steps.map((s) =>
                  s.output?.answer ? { ...s, output: { ...s.output, answer: undefined, answerTruncated: undefined } } : s,
                ),
              },
            }
          : data;
      // No projectId on the envelope — user-scoped delivery reaches the
      // approvals inbox even when another project is open.
      await this.deps.stateStore.publish(getRealtimeBroadcastChannel(owner.organizationId, owner.userId), {
        type: 'pipeline',
        data: payload,
        userContext: { userId: owner.userId, organizationId: owner.organizationId },
      });
    } catch (err) {
      logger.warn('[Pipeline] SSE publish failed', { component: COMPONENT }, err);
    }
  }
}
