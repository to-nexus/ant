/**
 * Approval gates (HITL) — durable choice card, timeout/remind arms, and the
 * ONE resolution funnel every channel (chat click, approvals route, timeout
 * arm) lands on after ChatService's NX-guarded choice-resolved.
 */

import {
  isApprovalStep,
  parsePipelineDuration,
  MAX_GATE_REMINDERS,
  UNIVERSAL_FEATURE,
  type ApprovalStepDef,
  type GateDecision,
  type PipelineDef,
  type RunRecord,
  type StepRecord,
} from '@ant/shared';
import type { PipelineGateRemindJobData, PipelineOwner } from '../../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL } from '../../../core/constants/redis';
import { logger } from '../../../utils/logger';
import { deriveRunStatus, effectiveNeeds } from '../../../core/pipelines/ChainExecutor';
import { appendEvent, getRun, isTerminal, mutateRun, publicRun, publish } from './runStore';
import { COMPONENT, type HitlRecord, type PipelineRunOps } from './types';

export async function armGate(
  ctx: PipelineRunOps,
  owner: PipelineOwner,
  def: PipelineDef,
  run: RunRecord,
  step: ApprovalStepDef,
): Promise<void> {
  const pipelineId = run.pipelineId;
  const gateId = `gate-${run.runId}-${step.id}`;
  const cardId = `pipe-${gateId}`;
  const anchorJobId = findAnchorJobId(def, run, step.id);
  const timeoutMs = step.timeout ? parsePipelineDuration(step.timeout.after) : null;
  const timeoutAt = timeoutMs ? new Date(Date.now() + timeoutMs).toISOString() : undefined;

  if (!anchorJobId) {
    await ctx.applyOutcome(owner, run.runId, step.id, 'failed', { error: 'gate-has-no-anchor-job' });
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
  await ctx.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.HITL(gateId), JSON.stringify(hitl), REDIS_TTL.PIPE.HITL);
  await ctx.deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.CARD(cardId), gateId, REDIS_TTL.PIPE.HITL);

  await mutateRun(ctx.deps, owner, run.runId, async (live) => {
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
  if (ctx.deps.chatService) {
    try {
      await ctx.deps.chatService.appendChoicePresented(run.projectId, UNIVERSAL_FEATURE, {
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
    await ctx.deps.scheduleQueue.armDelayed(`gto-${gateId}`, timeoutMs, {
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
    await ctx.deps.scheduleQueue.armDelayed(`gre-${gateId}`, remindMs, {
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

  await appendEvent(ctx.deps, owner, run.projectId, {
    ts: new Date().toISOString(),
    event: 'awaiting_human',
    runId: run.runId,
    stepId: step.id,
    gateId,
  });
  await publish(ctx.deps, owner, {
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
function findAnchorJobId(def: PipelineDef, run: RunRecord, gateStepId: string): string | undefined {
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
export async function applyResolvedGate(ctx: PipelineRunOps, cardId: string, decision: GateDecision, decidedBy: string | undefined, via: 'in-app' | 'api'): Promise<boolean> {
  const gateId = await ctx.deps.stateStore.getKey(REDIS_KEYS.PIPE.CARD(cardId));
  if (!gateId) return false;
  const raw = await ctx.deps.stateStore.getKey(REDIS_KEYS.PIPE.HITL(gateId));
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
    const result = await mutateRun(ctx.deps, hitl.owner, hitl.runId, async (live) => {
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
    await ctx.deps.scheduleQueue.cancelDelayed(`gre-${gateId}`);
    await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(gateId));
    await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(cardId));
    if (hitl.jobId) await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.JOB(hitl.jobId)).catch(() => {});
    await appendEvent(ctx.deps, hitl.owner, hitl.projectId, {
      ts: decidedAt,
      event: 'human_resolved',
      runId: hitl.runId,
      stepId: hitl.stepId,
      gateId,
      detail: { kind: 'tool', tool: hitl.tool, decision, decidedBy, via },
    });
    await publish(ctx.deps, hitl.owner, {
      cause: 'approvalResolved',
      projectId: hitl.projectId,
      pipelineId: hitl.pipelineId,
      runId: hitl.runId,
      gateId,
      decision,
      decidedBy,
    });
    await publish(ctx.deps, hitl.owner, { cause: 'runUpdate', projectId: hitl.projectId, pipelineId: hitl.pipelineId, run: publicRun(result.run) });
    const def = result.run.defSnapshot;
    const stepDef = def?.steps.find((s) => s.id === hitl.stepId);
    if (def && stepDef && !isApprovalStep(stepDef) && hitl.tool) {
      await ctx.dispatchJobStep(
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

  const applied = await ctx.applyOutcome(
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
      appendEvent(ctx.deps, hitl.owner, hitl.projectId, {
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
  await ctx.deps.scheduleQueue.cancelDelayed(`gto-${gateId}`);
  await ctx.deps.scheduleQueue.cancelDelayed(`gre-${gateId}`);
  await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(gateId));
  await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(cardId));
  const run = await getRun(ctx.deps, hitl.runId);
  if (run) {
    await publish(ctx.deps, hitl.owner, {
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

export async function handleGateTimeout(ctx: PipelineRunOps, gateId: string): Promise<void> {
  const raw = await ctx.deps.stateStore.getKey(REDIS_KEYS.PIPE.HITL(gateId));
  if (!raw) return; // already resolved
  const hitl = JSON.parse(raw) as HitlRecord;
  const run = await getRun(ctx.deps, hitl.runId);
  if (!run || isTerminal(run.status)) return;

  const approve = hitl.onTimeout === 'approve';
  // Funnel through the SAME choice-resolved path a human click uses — the
  // NX key guarantees exactly one winner if a click races the timeout.
  let resolved = true;
  if (ctx.deps.chatService) {
    const result = await ctx.deps.chatService.appendChoiceResolved(run.projectId, UNIVERSAL_FEATURE, {
      jobId: hitl.anchorJobId,
      cardId: hitl.cardId,
      choiceSelected: approve ? 'approve' : 'reject',
      resolvedLabel: 'Timed out',
      userContext: hitl.owner,
    });
    resolved = result.resolved;
  }
  if (resolved) {
    await appendEvent(ctx.deps, hitl.owner, hitl.projectId, {
      ts: new Date().toISOString(),
      event: 'gate_expired',
      runId: hitl.runId,
      stepId: hitl.stepId,
      gateId,
    });
    await applyResolvedGate(ctx, hitl.cardId, approve ? 'expired_approve' : 'expired_reject', undefined, 'api');
  }
  // NX already taken by a human click whose applyResolvedGate crashed
  // mid-flight: the HITL record still exists — apply the human decision.
  else {
    await applyResolvedGate(ctx, hitl.cardId, approve ? 'expired_approve' : 'expired_reject', undefined, 'api');
  }
}

/**
 * Gate reminder: the gate is still unresolved — re-fire the SSE row and drop
 * a reminder notice on the anchor turn, then re-arm (bounded). Resolve and
 * cancel paths remove the arm (`gre-{gateId}`).
 */
export async function handleGateRemind(ctx: PipelineRunOps, data: PipelineGateRemindJobData): Promise<void> {
  const raw = await ctx.deps.stateStore.getKey(REDIS_KEYS.PIPE.HITL(data.gateId));
  if (!raw) return; // resolved or swept
  const run = await getRun(ctx.deps, data.runId);
  const record = run?.steps.find((s) => s.stepId === data.stepId);
  if (!run || !record || record.status !== 'awaiting_gate' || !record.gate || record.gate.decision) return;
  const stepDef = run.defSnapshot?.steps.find((s) => s.id === data.stepId);
  const remindAfter = stepDef && isApprovalStep(stepDef) ? stepDef.remindAfter : undefined;
  await publish(ctx.deps, data.owner, {
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
  if (ctx.deps.chatService && anchor) {
    ctx.deps.chatService
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
    await ctx.deps.scheduleQueue.armDelayed(`gre-${data.gateId}`, ms, { ...data, reminders: data.reminders + 1 });
  }
}
