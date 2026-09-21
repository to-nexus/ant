/**
 * Clarify and tool-approval HITL parks — a step job that seals awaiting a
 * human answer/decision parks its step (open-ended wait, no timeout arm) and
 * the answer funnels back through applyClarifyAnswer / the gate resolve.
 */

import {
  isApprovalStep,
  UNIVERSAL_FEATURE,
  type ClarifyRecord,
  type StepRecord,
} from '@ant/shared';
import type {
  PipelineApprovalEnterJobData,
  PipelineClarifyEnterJobData,
  PipelineOwner,
} from '../../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL } from '../../../core/constants/redis';
import { logger } from '../../../utils/logger';
import { deriveRunStatus } from '../../../core/pipelines/ChainExecutor';
import { appendEvent, isTerminal, mutateRun, publish } from './runStore';
import {
  COMPONENT,
  MAX_OUTCOME_RETRIES,
  OUTCOME_RETRY_DELAY_MS,
  type HitlRecord,
  type PipelineRunOps,
} from './types';

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
export async function enterAwaitingToolApproval(ctx: PipelineRunOps, data: PipelineApprovalEnterJobData): Promise<void> {
  const { owner, pipelineId, projectId, runId, stepId, jobId, toolName, argsSummary } = data;
  const gateId = `tga-${runId}-${stepId}-${jobId}`;
  const cardId = `pipe-${gateId}`;
  const armedAt = new Date().toISOString();
  const prompt = `Tool approval: ${toolName}${argsSummary ? ` ${argsSummary}` : ''}`;
  let parked = false;
  const result = await mutateRun(ctx.deps, owner, runId, async (live) => {
    const step = live.steps.find((s) => s.stepId === stepId);
    if (!step || isTerminal(live.status) || step.status !== 'running' || step.jobId !== jobId) {
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
      await ctx.deps.scheduleQueue.armDelayed(`approval-enter-${runId}-${stepId}`, OUTCOME_RETRY_DELAY_MS, {
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
  await ctx.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);
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
    ...(data.toolUseId && { toolUseId: data.toolUseId }),
  };
  await ctx.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.HITL(gateId), JSON.stringify(hitl), REDIS_TTL.PIPE.HITL);
  await ctx.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.CARD(cardId), gateId, REDIS_TTL.PIPE.HITL);

  if (ctx.deps.chatService) {
    try {
      await ctx.deps.chatService.appendChoicePresented(projectId, UNIVERSAL_FEATURE, {
        jobId,
        jobType: 'universal',
        cardId,
        cardType: 'pipeline_approval',
        prompt,
        payload: {
          gateId,
          runId,
          stepId,
          pipelineId,
          pipelineName: result.run.defSnapshot?.name ?? pipelineId,
          ...(result.run.item && { itemKey: result.run.item.key }),
          kind: 'tool',
          tool: toolName,
        },
        userContext: owner,
      });
    } catch (e) {
      logger.warn(`[Pipeline] failed to present tool-approval card ${cardId}`, { component: COMPONENT }, e);
    }
  }

  await appendEvent(ctx.deps, owner, projectId, {
    ts: armedAt,
    event: 'awaiting_human',
    runId,
    stepId,
    jobId,
    gateId,
    detail: { kind: 'tool', tool: toolName, argsSummary },
  });
  await publish(ctx.deps, owner, {
    cause: 'approvalRequested',
    projectId,
    approval: {
      kind: 'tool',
      gateId,
      cardId,
      runId,
      pipelineId,
      pipelineName: result.run.defSnapshot?.name ?? pipelineId,
      ...(result.run.item && { itemKey: result.run.item.key }),
      projectId,
      stepId,
      prompt,
      armedAt,
      jobId,
    },
  });
}

/**
 * Park a step whose job sealed awaiting a clarify answer. Guarded on
 * (`running`, same jobId) so duplicate/stale status events no-op. The wait
 * is open-ended — no timeout arm; run cancel / deactivation are the escape
 * hatches. `ant:pipe:job:{jobId}` is NOT deleted: it is the answer funnel.
 */
export async function enterAwaitingClarify(ctx: PipelineRunOps, data: PipelineClarifyEnterJobData): Promise<void> {
  const { owner, pipelineId, projectId, runId, stepId, jobId } = data;
  const askedAt = new Date().toISOString();
  let record: ClarifyRecord | undefined;
  const result = await mutateRun(ctx.deps, owner, runId, async (live) => {
    const step = live.steps.find((s) => s.stepId === stepId);
    if (!step || isTerminal(live.status) || step.status !== 'running' || step.jobId !== jobId) {
      return { run: live, dispatches: [] };
    }
    const round = (step.clarify?.round ?? 0) + 1;
    if (step.clarify?.answeredAt && step.clarify.question === data.question) {
      // The resumed job asked the very question that was just answered: it
      // opened a fresh turn instead of closing the sealed call — its node
      // could not see the seal. The runner now waits for it; this stays as
      // the cloud-side tripwire.
      logger.warn(
        `[Pipeline] clarify re-asked verbatim after an answer (round ${round}) — the resumed job did not see its transcript: ${runId}/${stepId}`,
        { component: COMPONENT },
      );
    }
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
      await ctx.deps.scheduleQueue.armDelayed(`clarify-enter-${runId}-${stepId}`, OUTCOME_RETRY_DELAY_MS, {
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
  await ctx.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${stepId}`);

  // The funnel key must outlive the open-ended wait (PIPE.JOB is 7d) —
  // align with the ACTIVE overlap bound.
  await ctx.deps.stateStore.setKeyWithTTL(
    REDIS_KEYS.PIPE.JOB(jobId),
    JSON.stringify({ runId, stepId, pipelineId, projectId, owner }),
    REDIS_TTL.PIPE.ACTIVE,
  );

  await appendEvent(ctx.deps, owner, projectId, {
    ts: askedAt,
    event: 'awaiting_human',
    runId,
    stepId,
    jobId,
    detail: { kind: 'clarify', clarifyId: record.clarifyId, question: record.question, round: record.round },
  });
  await publish(ctx.deps, owner, {
    cause: 'clarifyRequested',
    projectId,
    clarify: {
      kind: 'clarify',
      gateId: record.clarifyId,
      cardId: record.clarifyId,
      runId,
      pipelineId,
      pipelineName: result.run.defSnapshot?.name ?? pipelineId,
      ...(result.run.item && { itemKey: result.run.item.key }),
      projectId,
      stepId,
      prompt: record.question,
      armedAt: askedAt,
      jobId,
    },
  });

  // An answer that arrived before this park (the chat card is child-minted
  // mid-job) was held under the run lock; consume it through the same
  // authority now that the step is parked.
  await consumeHeldClarifyAnswer(ctx, jobId, runId, stepId);
}

/** The answer a human gave while the step had not parked yet — written under the run lock, consumed right after the park. */
interface HeldClarifyAnswer {
  answer: string;
  answeredBy?: string;
  via: 'in-app' | 'api';
  at: string;
}

async function consumeHeldClarifyAnswer(ctx: PipelineRunOps, jobId: string, runId: string, stepId: string): Promise<void> {
  const key = REDIS_KEYS.PIPE.CLARIFY_HELD(jobId);
  let held: HeldClarifyAnswer | null = null;
  try {
    const raw = await ctx.deps.stateStore.getKey(key);
    held = raw ? (JSON.parse(raw) as HeldClarifyAnswer) : null;
  } catch {
    held = null;
  }
  if (!held || typeof held.answer !== 'string') return;
  const outcome = await applyClarifyAnswer(ctx, { jobId, answer: held.answer, answeredBy: held.answeredBy, via: held.via });
  if (outcome === 'lock-starved') {
    // Left in place for a later pass — the TTL bounds it; never silently dropped.
    logger.warn(`[Pipeline] held clarify answer not applied (lock starvation): ${runId}/${stepId}`, { component: COMPONENT });
    return;
  }
  await ctx.deps.stateStore.deleteKey(key).catch(() => {});
  logger.info(`[Pipeline] held clarify answer applied on park: ${runId}/${stepId} → ${outcome}`, { component: COMPONENT });
}

/**
 * What became of a clarify answer. Every value is a decision the caller must
 * surface — a boolean hid four different fates behind one `false`, and the
 * chat route turned all of them into a silent 200 (2026-09-18 report).
 *
 * - `applied`       the step was awaiting this job's clarify; re-dispatched with the answer
 * - `held`          the step is still `running` under this job (card minted, park not landed) — stored, applied on park
 * - `not-pipeline`  the job is not a pipeline step (interactive clarify) — the caller's own path
 * - `not-awaiting`  the step is past this clarify (answered elsewhere, cancelled, deactivated, or a different round)
 * - `lock-starved`  the run lock could not be taken — retryable, nothing changed
 */
export type ClarifyAnswerOutcome = 'applied' | 'held' | 'not-pipeline' | 'not-awaiting' | 'lock-starved';

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
export async function applyClarifyAnswer(ctx: PipelineRunOps, params: {
  jobId: string;
  answer: string;
  answeredBy?: string;
  via: 'in-app' | 'api';
}): Promise<ClarifyAnswerOutcome> {
  const raw = await ctx.deps.stateStore.getKey(REDIS_KEYS.PIPE.JOB(params.jobId));
  if (!raw) return 'not-pipeline';
  const { runId, stepId, pipelineId, projectId, owner } = JSON.parse(raw) as {
    runId: string;
    stepId: string;
    pipelineId: string;
    projectId: string;
    owner: PipelineOwner;
  };

  const answeredAt = new Date().toISOString();
  let resolved: ClarifyRecord | undefined;
  let held = false;
  const result = await mutateRun(ctx.deps, owner, runId, async (live) => {
    const step = live.steps.find((s) => s.stepId === stepId);
    if (!step || isTerminal(live.status)) return { run: live, dispatches: [] };
    if (step.status === 'running' && step.jobId === params.jobId) {
      // The card is on screen but the seal has not been consumed yet. Hold
      // the answer UNDER the run lock: the park takes the same lock next and
      // reads the key right after, so the hand-off cannot fall between them.
      await ctx.deps.stateStore.setKeyWithTTL(
        REDIS_KEYS.PIPE.CLARIFY_HELD(params.jobId),
        JSON.stringify({ answer: params.answer, answeredBy: params.answeredBy, via: params.via, at: answeredAt } satisfies HeldClarifyAnswer),
        REDIS_TTL.PIPE.CLARIFY_HELD,
      );
      held = true;
      return { run: live, dispatches: [] };
    }
    if (step.status !== 'awaiting_clarify' || step.clarify?.jobId !== params.jobId) {
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
  if (!result) return 'lock-starved';
  if (held) {
    logger.info(`[Pipeline] clarify answer held until the step parks: ${runId}/${stepId}`, { component: COMPONENT });
    return 'held';
  }
  if (!resolved) return 'not-awaiting';

  // Post-apply ordering (gate precedent): the funnel key dies only after
  // the flip landed, so a crash mid-apply keeps the answer recoverable.
  await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.JOB(params.jobId)).catch(() => {});
  await appendEvent(ctx.deps, owner, projectId, {
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
  await publish(ctx.deps, owner, {
    cause: 'clarifyAnswered',
    projectId,
    pipelineId,
    runId,
    stepId,
    clarifyId: resolved.clarifyId,
    answeredBy: params.answeredBy,
  });

  const def = result.run.defSnapshot;
  const stepDef = def?.steps.find((s) => s.id === stepId);
  if (def && stepDef && !isApprovalStep(stepDef)) {
    await ctx.dispatchJobStep(owner, def, result.run, stepDef, 0, params.answer, undefined, resolved.toolUseId);
  }
  return 'applied';
}
