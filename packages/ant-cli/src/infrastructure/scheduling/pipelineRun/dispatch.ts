/**
 * Step dispatch — the owner-standing gates (approval/membership/credits), the
 * shared universal accept gates, chat parity, and the enqueue through the ONE
 * dispatch owner (UniversalDispatchService).
 */

import {
  defaultStepDirective,
  isApprovalStep,
  parsePipelineDuration,
  DIRECTIVE_MAX_CHARS,
  UNIVERSAL_FEATURE,
  type ApprovalStepDef,
  type JobStepDef,
  type PipelineDef,
  type RunRecord,
  type StepRecord,
} from '@ant/shared';
import type { PipelineOwner } from '../../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL } from '../../../core/constants/redis';
import { generateTurnId } from '../../../composition/recordUserTurn';
import { logger } from '../../../utils/logger';
import type { StepDispatch } from '../../../core/pipelines/ChainExecutor';
import {
  resolveUniversalExecuteContext,
  validateUniversalTurnMeta,
  findDuplicateActiveJob,
  checkStartCredits,
} from '../../../core/scheduling/UniversalDispatchGate';
import { UniversalDispatchService } from '../../../core/scheduling/UniversalDispatchService';
import { createSelfApiTokenMinter } from '../../auth/selfApiToken';
import { renderDirective, renderStaticVars, unresolvedStepRefs } from './render';
import { appendEvent, getRun, isTerminal, mutateRun } from './runStore';
import { COMPONENT, type PipelineRunOps } from './types';

const MAX_DUPLICATE_RETRIES = 60;

export async function executeDispatches(
  ctx: PipelineRunOps,
  owner: PipelineOwner,
  def: PipelineDef,
  run: RunRecord,
  dispatches: StepDispatch[],
): Promise<void> {
  for (const dispatch of dispatches) {
    if (dispatch.kind === 'gate') {
      await ctx.armGate(owner, def, run, dispatch.def as ApprovalStepDef);
    } else {
      await dispatchJobStep(ctx, owner, def, run, dispatch.def as JobStepDef, 0);
    }
  }
  // Terminal without any dispatch (e.g. everything skipped immediately).
  if (isTerminal(run.status) && dispatches.length === 0) {
    await ctx.finalizeRun(owner, run);
  }
}

export async function dispatchJobStep(
  ctx: PipelineRunOps,
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
      ? ctx.failStepOrRetry(owner, run.runId, step.id, reason)
      : ctx.applyOutcome(owner, run.runId, step.id, 'failed', { error: reason });

  // Owner-standing gates — re-judged at EVERY step dispatch, never once at
  // registration (revocation/credit-drain take effect mid-chain).
  if (await ctx.deps.checkApproval(owner)) return void (await fail('account-not-approved'));
  if (!(await ctx.deps.checkTeamMembership(owner))) return void (await fail('membership-revoked'));
  const lowCredits = await checkStartCredits(owner, ctx.deps.getCreditLedger);
  if (lowCredits) return void (await fail('insufficient-credits'));

  // Definition + turn-meta accept gates (same owners as the HTTP route).
  const resolved = await resolveUniversalExecuteContext(ctx.deps.workspaceResolver, owner, run.projectId, step.customJobRef);
  if (!resolved.ok) return void (await fail(`${resolved.code}: ${resolved.error}`));
  // Pins render their STATIC template vars before expansion/existence
  // checks — `reports/{{trigger.fireDate}}/**` addresses exactly this run's
  // partition (run-scoped pin isolation; steps.* refs are validator-refused).
  const renderedContext = (step.context ?? []).map((pin) => renderStaticVars(pin, run));
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
    { expandContextGlobs: true, pipelineScopeRoots: resolved.pipelineScopeRoots },
  );
  if (!meta.ok) return void (await fail(`${meta.code}: ${meta.error}`));

  // Project-level duplicate gate — with the pipeline-owned project gate on
  // the interactive side AND the executor's one-job-in-flight rule, the only
  // collision left is the seal race between a finishing step's job (status
  // record lagging the pub/sub event) and this dispatch: 1–2 re-arms absorb it.
  const duplicate = await findDuplicateActiveJob(ctx.deps.stateStore as any, owner, run.projectId, UNIVERSAL_FEATURE, 'universal');
  if (duplicate) {
    if (retries >= MAX_DUPLICATE_RETRIES) return void (await fail('duplicate-job-timeout'));
    await ctx.deps.scheduleQueue.armDelayed(
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
  const directive = directiveOverride ?? renderDirective(template, run);
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
  if (ctx.deps.chatService) {
    try {
      await ctx.deps.chatService.appendUserTurn(
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
    { jobQueue: ctx.deps.getJobQueue() as any, stateStore: ctx.deps.stateStore as any },
    {
      workspaceService: ctx.deps.workspaceService,
      workspaceResolver: ctx.deps.workspaceResolver,
      stateTracker: ctx.deps.stateTracker,
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
        // Memory boundary: this run's steps share a conversation channel,
        // and no other run's.
        runId: run.runId,
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

  if (isFirstTurn && ctx.deps.chatService) {
    const startedText = run.firedBy === 'cron'
      ? `🔁 파이프라인 "${def.name}" 실행이 시작되었습니다. (run: ${run.runId})`
      : run.firedBy === 'event'
        ? `🔗 선행 파이프라인 완료로 "${def.name}" 실행이 시작되었습니다. (run: ${run.runId})`
        : `🔁 파이프라인 "${def.name}" 실행이 수동으로 시작되었습니다. (run: ${run.runId})`;
    ctx.deps.chatService
      .appendAssistantMessage(run.projectId, UNIVERSAL_FEATURE, startedText, {
        jobId,
        turnId,
        jobType: 'universal',
        userContext: owner,
        kind: 'system_notice',
      })
      .catch((e) => logger.warn('[Pipeline] run-started notice failed', { component: COMPONENT }, e));
  }

  await ctx.deps.stateStore.setKeyWithTTL(
    REDIS_KEYS.PIPE.JOB(jobId),
    JSON.stringify({ runId: run.runId, stepId: step.id, pipelineId, projectId: run.projectId, owner }),
    REDIS_TTL.PIPE.JOB,
  );
  // Dispatch audit rides the record too, so the run view can show a step that
  // ran with a `{{steps.*}}` ref unsubstituted or a glob pin expanded to N.
  const unresolvedTemplates = directiveOverride ? [] : unresolvedStepRefs(template, run);
  const dispatchDetail = {
    ...(meta.contextExpanded && { contextExpanded: meta.contextExpanded }),
    ...(unresolvedTemplates.length > 0 && { unresolvedTemplates }),
  };
  await mutateRun(ctx.deps, owner, run.runId, async (live) => {
    const steps = live.steps.map((s): StepRecord =>
      s.stepId === step.id
        ? {
            ...s,
            status: 'running',
            jobId,
            turnId,
            startedAt: new Date().toISOString(),
            ...(Object.keys(dispatchDetail).length > 0 && { dispatch: dispatchDetail }),
          }
        : s,
    );
    return { run: { ...live, steps }, dispatches: [] };
  });
  // Wall-clock bound for THIS round — re-armed (same id) on every
  // re-dispatch, cancelled on outcome / clarify park / run cancel.
  if (step.timeout) {
    const timeoutMs = parsePipelineDuration(step.timeout.after);
    if (timeoutMs) {
      await ctx.deps.scheduleQueue.armDelayed(`sto-${run.runId}-${step.id}`, timeoutMs, {
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
  await appendEvent(ctx.deps, owner, run.projectId, {
    ts: new Date().toISOString(),
    event: 'step_dispatched',
    runId: run.runId,
    stepId: step.id,
    jobId,
    detail: { turnId, ...dispatchDetail },
  });
}

export async function handleStepRetry(
  ctx: PipelineRunOps,
  owner: PipelineOwner,
  runId: string,
  stepId: string,
  retries: number,
  directiveOverride?: string,
): Promise<void> {
  const run = await getRun(ctx.deps, runId);
  if (!run || isTerminal(run.status)) return;
  const record = run.steps.find((s) => s.stepId === stepId);
  if (!record || record.status !== 'dispatched') return;
  const def = run.defSnapshot;
  const stepDef = def?.steps.find((s) => s.id === stepId);
  if (!def || !stepDef || isApprovalStep(stepDef)) return;
  await dispatchJobStep(ctx, owner, def, run, stepDef, retries, directiveOverride);
}
