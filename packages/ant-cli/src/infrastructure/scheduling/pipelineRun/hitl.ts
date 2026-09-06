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
import { appendEvent, isTerminal, mutateRun, publicRun, publish } from './runStore';
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
  };
  await ctx.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.HITL(gateId), JSON.stringify(hitl), REDIS_TTL.PIPE.HITL);
  await ctx.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.CARD(cardId), gateId, REDIS_TTL.PIPE.HITL);

  if (ctx.deps.chatService) {
    try {
      await ctx.deps.chatService.appendChoicePresented(projectId, UNIVERSAL_FEATURE, {
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
      projectId,
      stepId,
      prompt,
      armedAt,
      jobId,
    },
  });
  await publish(ctx.deps, owner, { cause: 'runUpdate', projectId, pipelineId, run: publicRun(result.run) });
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
      projectId,
      stepId,
      prompt: record.question,
      armedAt: askedAt,
      jobId,
    },
  });
  await publish(ctx.deps, owner, { cause: 'runUpdate', projectId, pipelineId, run: publicRun(result.run) });
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
export async function applyClarifyAnswer(ctx: PipelineRunOps, params: {
  jobId: string;
  answer: string;
  answeredBy?: string;
  via: 'in-app' | 'api';
}): Promise<boolean> {
  const raw = await ctx.deps.stateStore.getKey(REDIS_KEYS.PIPE.JOB(params.jobId));
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
  const result = await mutateRun(ctx.deps, owner, runId, async (live) => {
    const step = live.steps.find((s) => s.stepId === stepId);
    if (
      !step ||
      isTerminal(live.status) ||
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
  await publish(ctx.deps, owner, { cause: 'runUpdate', projectId, pipelineId, run: publicRun(result.run) });

  const def = result.run.defSnapshot;
  const stepDef = def?.steps.find((s) => s.id === stepId);
  if (def && stepDef && !isApprovalStep(stepDef)) {
    await ctx.dispatchJobStep(owner, def, result.run, stepDef, 0, params.answer);
  }
  return true;
}
