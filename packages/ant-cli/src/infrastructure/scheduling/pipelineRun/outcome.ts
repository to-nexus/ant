/**
 * Job-outcome landing and the retry ladder — status-update consumption, the
 * ONE retryable-failure funnel (failStepOrRetry), step timeouts, and the
 * lock-starvation re-apply arms.
 */

import {
  defaultStepDirective,
  isApprovalStep,
  parsePipelineDuration,
  MAX_STEP_RETRY,
  type StepOutputRecord,
  type StepRecord,
} from '@ant/shared';
import type { PipelineOwner, PipelineStepTimeoutJobData } from '../../../core/ports/scheduler';
import { REDIS_KEYS } from '../../../core/constants/redis';
import { logger } from '../../../utils/logger';
import { deriveRunStatus } from '../../../core/pipelines/ChainExecutor';
import { renderDirective } from './render';
import { captureStepOutput, detectApprovalSeal, detectClarifySeal } from './seals';
import { appendEvent, getRun, isTerminal, mutateRun, publicRun, publish } from './runStore';
import {
  COMPONENT,
  MAX_OUTCOME_RETRIES,
  OUTCOME_RETRY_DELAY_MS,
  type PipelineRunOps,
  type StepRetryOpts,
} from './types';

/** Interruption reasons that are infrastructure's fault — retry-eligible. A human stop/pause is not. */
const INFRA_INTERRUPTION_REASONS: ReadonlySet<string> = new Set(['worker_stalled', 'server_shutdown']);
/** One free nudged round for a step that ended with its stop hooks unmet (no declared `retry` needed). */
const HOOK_UNMET_RETRY: StepRetryOpts = {
  budgetFloor: 1,
  delayMsDefault: 5_000,
  nudge:
    'It ended without writing its required artifact. If input is missing, ask through the clarify tool — never end the turn on a prose question; otherwise finish the work and save the artifact.',
};

export async function handleJobStatusUpdate(ctx: PipelineRunOps, data: {
  type?: string;
  jobId?: string;
  status?: string;
  interruption?: any;
  result?: any;
}): Promise<void> {
  if (!data?.jobId) return;
  if (data.type !== 'completed' && data.type !== 'failed') return;
  const raw = await ctx.deps.stateStore.getKey(REDIS_KEYS.PIPE.JOB(data.jobId));
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
    // An interrupted job parks itself paused/resumable, but nobody resumes a
    // pipeline step — and a paused job blocks the project's next dispatch
    // (the S7 signature). The run treats the interruption as the step's
    // outcome, so the job must not outlive that verdict.
    await ctx.killStepJob(data.jobId, projectId);
  }
  // Clarify seal: the job ended awaiting a human answer (universal
  // end-and-resume). Not an outcome — the step parks `awaiting_clarify`
  // until the answer funnels through `applyClarifyAnswer`.
  let output: StepOutputRecord | undefined;
  let verdict: string | undefined;
  if (outcome === 'succeeded') {
    const clarify = await detectClarifySeal(ctx.deps, owner, runId, stepId, data.jobId);
    if (clarify) {
      await ctx.enterAwaitingClarify({
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
    const approvalSeal = await detectApprovalSeal(ctx.deps, owner, runId, stepId, data.jobId);
    if (approvalSeal) {
      await ctx.enterAwaitingToolApproval({
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
    const captured = await captureStepOutput(ctx.deps, owner, runId, stepId, data.jobId);
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
  // redo what they stopped). Unmet stop hooks get one nudged round even
  // without a declared retry: the model asked in prose instead of calling
  // clarify (or stopped short of the artifact), and a fresh round with the
  // hook named recovers it — interactive chat's "Resume to continue",
  // automated once, because a pipeline has no human to resume it.
  const hookUnmet = interruption != null && String(interruption.reason ?? '') === 'universal_stop_hook_unmet';
  const retryable =
    outcome === 'failed' &&
    (!interruption || hookUnmet || INFRA_INTERRUPTION_REASONS.has(String(interruption.reason ?? '')));

  // A retryable failure consumes a retry round when the step declares one
  // (step_retry event + re-dispatch arm); otherwise it falls through to the
  // normal failed outcome inside the funnel.
  if (retryable) {
    const handled = await failStepOrRetry(ctx, owner, runId, stepId, error ?? 'job-failed', data.jobId, hookUnmet ? HOOK_UNMET_RETRY : undefined);
    if (handled) {
      await ctx.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);
      return;
    }
    // Lock starvation — re-arm; the retry judgment re-runs on the re-apply.
    await ctx.deps.scheduleQueue.armDelayed(`outcome-retry-${runId}-${stepId}`, OUTCOME_RETRY_DELAY_MS, {
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

  await appendEvent(ctx.deps, owner, projectId, {
    ts: new Date().toISOString(),
    event: 'step_completed',
    runId,
    stepId,
    jobId: data.jobId,
    detail: { outcome, ...(error && { error }), ...(output && { outputCaptured: true }) },
  });
  const patch = { ...(error && { error }), ...(output && { output }), ...(verdict && { verdict }) };
  const applied = await ctx.applyOutcome(owner, runId, stepId, outcome, Object.keys(patch).length > 0 ? patch : undefined, undefined, data.jobId);
  if (applied) {
    await ctx.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);
  } else {
    // Lock starvation would otherwise DROP the outcome and hang the run
    // `running` until the overlap TTL — re-arm a bounded re-apply instead.
    await ctx.deps.scheduleQueue.armDelayed(`outcome-retry-${runId}-${stepId}`, OUTCOME_RETRY_DELAY_MS, {
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

export async function handleOutcomeRetry(ctx: PipelineRunOps, data: {
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
      ? await failStepOrRetry(ctx, 
          data.owner, data.runId, data.stepId, data.error ?? 'job-failed', data.jobId,
          // The replay path re-derives the hook-unmet floor from the error —
          // the arm payload does not carry opts, and losing the floor on a
          // lock-starved re-apply would fail a step the live path nudges.
          data.error?.includes('universal_stop_hook_unmet') ? HOOK_UNMET_RETRY : undefined,
        )
      : await ctx.applyOutcome(
          data.owner, data.runId, data.stepId, data.outcome,
          Object.keys(patch).length > 0 ? patch : undefined,
          undefined,
          data.jobId,
        );
  if (applied) {
    await ctx.deps.scheduleQueue.cancelDelayed(`sto-${data.runId}-${data.stepId}`);
  }
  if (!applied && data.retries < MAX_OUTCOME_RETRIES) {
    await ctx.deps.scheduleQueue.armDelayed(
      `outcome-retry-${data.runId}-${data.stepId}`,
      OUTCOME_RETRY_DELAY_MS,
      { ...data, kind: 'outcome-retry', retries: data.retries + 1 },
    );
  } else if (!applied) {
    logger.warn(`[Pipeline] outcome dropped after retries: ${data.runId}/${data.stepId}`, { component: COMPONENT });
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
export async function failStepOrRetry(
  ctx: PipelineRunOps,
  owner: PipelineOwner,
  runId: string,
  stepId: string,
  error: string,
  expectedJobId?: string,
  opts?: StepRetryOpts,
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
  const result = await mutateRun(ctx.deps, owner, runId, async (live, def) => {
    if (!def) return { run: live, dispatches: [] };
    const record = live.steps.find((s) => s.stepId === stepId);
    const stepDef = def.steps.find((s) => s.id === stepId);
    if (!record || !stepDef || isApprovalStep(stepDef) || isTerminal(live.status)) {
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
    const max = Math.min(Math.max(stepDef.retry?.max ?? 0, opts?.budgetFloor ?? 0), MAX_STEP_RETRY);
    if (used >= max) return { run: live, dispatches: [] }; // no budget — fall through below
    const round = used + 1;
    const attempts = [
      ...(record.attempts ?? []),
      { ...(record.jobId && { jobId: record.jobId }), error, endedAt: new Date().toISOString() },
    ].slice(-MAX_STEP_RETRY);
    const template = stepDef.directive?.trim() ? stepDef.directive : defaultStepDirective(stepDef.intent);
    const directiveOverride =
      `[Retry ${round}/${max}] The previous attempt failed: "${error}". ` +
      (opts?.nudge ?? `Before doing anything else, check which side effects the failed attempt already completed, then perform ONLY the remaining work.`) +
      `\n\n` +
      renderDirective(template, live);
    armed = {
      delayMs: parsePipelineDuration(stepDef.retry?.backoff) ?? opts?.delayMsDefault ?? 60_000,
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
    await appendEvent(ctx.deps, owner, result.run.projectId, {
      ts: new Date().toISOString(),
      event: 'step_completed',
      runId,
      stepId,
      detail: { outcome: 'failed', error },
    });
    return ctx.applyOutcome(owner, runId, stepId, 'failed', { error }, undefined, expectedJobId);
  }
  if (held.oldJobId) {
    await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.JOB(held.oldJobId)).catch(() => {});
  }
  await ctx.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);
  await appendEvent(ctx.deps, owner, held.projectId, {
    ts: new Date().toISOString(),
    event: 'step_retry',
    runId,
    stepId,
    detail: { round: held.round, max: held.max, error, delayMs: held.delayMs },
  });
  await ctx.deps.scheduleQueue.armDelayed(`step-retry-${runId}-${stepId}`, held.delayMs, {
    kind: 'step-retry',
    owner,
    pipelineId: held.pipelineId,
    projectId: held.projectId,
    runId,
    stepId,
    retries: 0,
    directiveOverride: held.directiveOverride,
  });
  await publish(ctx.deps, owner, { cause: 'runUpdate', projectId: held.projectId, pipelineId: held.pipelineId, run: publicRun(result.run) });
  return true;
}

/**
 * Step-timeout expiry: kill the round's job (stop legs) and fail the step —
 * retryable, so `timeout` and `retry` compose. Stale arms (a newer round's
 * jobId, a parked/terminal step) no-op.
 */
export async function handleStepTimeout(ctx: PipelineRunOps, data: PipelineStepTimeoutJobData): Promise<void> {
  const run = await getRun(ctx.deps, data.runId);
  if (!run || isTerminal(run.status)) return;
  const record = run.steps.find((s) => s.stepId === data.stepId);
  if (!record || record.status !== 'running' || record.jobId !== data.jobId) return;
  const stepDef = run.defSnapshot?.steps.find((s) => s.id === data.stepId);
  const after = stepDef && !isApprovalStep(stepDef) ? stepDef.timeout?.after : undefined;
  await ctx.killStepJob(data.jobId, run.projectId);
  await failStepOrRetry(ctx, data.owner, data.runId, data.stepId, `step-timeout: exceeded ${after ?? 'the configured bound'}`, data.jobId);
}
