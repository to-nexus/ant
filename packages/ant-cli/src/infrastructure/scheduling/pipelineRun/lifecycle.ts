/**
 * Run lifecycle — outcome application under the run lock, cancel (the ONE
 * kill authority), finalize (index append + slot release), runCompleted
 * chaining, and the run-finished chat notice.
 */

import { UNIVERSAL_FEATURE, type RunRecord, type StepRecord } from '@ant/shared';
import type { PipelineOwner } from '../../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_CHANNELS } from '../../../core/constants/redis';
import { logger } from '../../../utils/logger';
import { applyStepOutcome } from '../../../core/pipelines/ChainExecutor';
import { deriveActivationsRoot } from '../../../core/pipelines/paths';
import { resolveDefRoot } from '../../../core/pipelines/scopeRoots';
import {
  appendRunIndex,
  listAccountActivations,
  loadActivationByProject,
  loadAvailability,
  loadPipeline,
} from '../../../core/pipelines/store';
import { appendEvent, getActiveRunId, getRun, isTerminal, mutateRun, publicRun, publish, saveRun, tenantCtx } from './runStore';
import { COMPONENT, type PipelineRunOps } from './types';

/**
 * Apply one step outcome under the run lock, dispatch what unblocks,
 * finalize when terminal. Returns false when the mutation could NOT be
 * applied (lock starvation / missing run) — callers re-arm, never drop.
 */
export async function applyOutcome(
  ctx: PipelineRunOps,
  owner: PipelineOwner,
  runId: string,
  stepId: string,
  outcome: 'succeeded' | 'failed',
  patch?: Partial<StepRecord>,
  decorate?: (record: StepRecord) => StepRecord,
  expectedJobId?: string,
  onOutcomeLanded?: () => Promise<void>,
): Promise<boolean> {
  const result = await mutateRun(ctx.deps, owner, runId, async (live, def) => {
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
    await ctx.executeDispatches(owner, def, result.run, result.dispatches);
  } else if (isTerminal(result.run.status)) {
    await finalizeRun(ctx, owner, result.run);
  }
  await publish(ctx.deps, owner, { cause: 'runUpdate', projectId: result.run.projectId, pipelineId: result.run.pipelineId, run: publicRun(result.run) });
  return true;
}

export async function cancelRun(ctx: PipelineRunOps, owner: PipelineOwner, runId: string): Promise<boolean> {
  // Kill targets are captured under the per-run lock so a step sealing
  // concurrently cannot slip past both the sweep and the kill.
  const killTargets: Array<{ jobId: string; projectId: string }> = [];
  let mutated = false;
  const result = await mutateRun(ctx.deps, owner, runId, async (live) => {
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
    await killStepJob(ctx, target.jobId, target.projectId);
  }
  // Disarm any gates, timeout/remind arms and clarify funnel keys swept.
  for (const s of result.run.steps) {
    if (s.gate && !s.gate.decision) {
      await ctx.deps.scheduleQueue.cancelDelayed(`gto-${s.gate.gateId}`);
      await ctx.deps.scheduleQueue.cancelDelayed(`gre-${s.gate.gateId}`);
      await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(s.gate.gateId)).catch(() => {});
      await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(s.gate.cardId)).catch(() => {});
    }
    if (s.clarify && !s.clarify.answeredAt) {
      await ctx.deps.stateStore.deleteKey(REDIS_KEYS.PIPE.JOB(s.clarify.jobId)).catch(() => {});
    }
    await ctx.deps.scheduleQueue.cancelDelayed(`sto-${runId}-${s.stepId}`);
  }
  await finalizeRun(ctx, owner, result.run);
  await publish(ctx.deps, owner, { cause: 'runUpdate', projectId: result.run.projectId, pipelineId: result.run.pipelineId, run: publicRun(result.run) });
  return true;
}

/**
 * The `/jobs/:jobId/stop` mirror (mark-user-stopped + poison + STOP
 * pub/sub) — ONE kill authority, shared by run cancel and step timeout.
 */
export async function killStepJob(ctx: PipelineRunOps, jobId: string, projectId: string): Promise<void> {
  try {
    await ctx.deps.stateStore.markUserStopped(jobId);
    await ctx.deps.stateStore.acquireLock(`ant:job-poisoned:${jobId}`, 600).catch(() => false);
    await ctx.deps.stateStore.publish(REDIS_CHANNELS.JOB_WORKER.STOP, {
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
export async function deactivate(ctx: PipelineRunOps, owner: PipelineOwner, projectId: string): Promise<void> {
  const runId = await getActiveRunId(ctx.deps, owner, projectId);
  if (!runId) return;
  const run = await getRun(ctx.deps, runId);
  if (run && !isTerminal(run.status)) {
    await cancelRun(ctx, owner, runId);
  }
}

export async function finalizeRun(ctx: PipelineRunOps, owner: PipelineOwner, run: RunRecord): Promise<void> {
  const endedAt = run.endedAt ?? new Date().toISOString();
  // A failed/partial run names its cause: the first failed step's error.
  // (No other producer writes run.error — without this the field is dead.)
  const firstFailed = run.error
    ? undefined
    : run.steps.find((s) => s.status === 'failed' && s.error);
  const error =
    run.error ?? ((run.status === 'failed' || run.status === 'partial') && firstFailed ? `${firstFailed.stepId}: ${firstFailed.error}` : undefined);
  const sealed: RunRecord = { ...run, endedAt, ...(error && { error }) };
  await saveRun(ctx.deps, sealed);
  await appendEvent(ctx.deps, owner, run.projectId, {
    ts: endedAt,
    event: 'run_finished',
    runId: run.runId,
    detail: { status: run.status, run: publicRun(sealed) },
  });
  // Gate decisions ride the summary line — the org observer's "who opened
  // this gate" channel (approval STEPS only; tool gates stay off it).
  const gates = run.steps
    .filter((s) => s.gate?.decision && s.gate.gateId.startsWith('gate-'))
    .map((s) => ({
      stepId: s.stepId,
      decision: s.gate!.decision!,
      ...(s.gate!.decidedBy && { decidedBy: s.gate!.decidedBy }),
    }));
  await appendRunIndex(deriveActivationsRoot(tenantCtx(ctx.deps, owner)), run.projectId, {
    runId: run.runId,
    pipelineId: run.pipelineId,
    projectId: run.projectId,
    status: run.status,
    firedBy: run.firedBy,
    fireEpoch: run.fireEpoch,
    startedAt: run.startedAt,
    endedAt,
    ...(sealed.error && { error: sealed.error }),
    ...(gates.length > 0 && { gates }),
  });
  const activeKey = REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, run.projectId);
  const holder = await ctx.deps.stateStore.getKey(activeKey);
  if (holder === run.runId) {
    await ctx.deps.stateStore.deleteKey(activeKey).catch(() => {});
    // The concurrency slot shares the ACTIVE key's lifetime — one reservation
    // per live activation. Releasing only under the same holder check keeps a
    // late seal from freeing a slot a newer run already holds.
    await ctx.deps.stateStore
      .releaseSlot(REDIS_KEYS.PIPE.RUN_SLOTS(owner.organizationId, owner.userId), run.projectId)
      .catch(() => {});
  }
  await emitRunFinishedNotice(ctx, owner, sealed);
  await fireChainedPipelines(ctx, owner, sealed);
}

/**
 * runCompleted chaining — scoped to the ACTIVATOR's own activations
 * (identity never crosses users; doc 46 §6). Bounded disk scan per the
 * no-reverse-index doctrine; each chained fire rides the SAME fire path
 * with `firedBy: 'event'` and an incremented chainDepth (fire-side loop
 * guard). Best-effort: a broken candidate never blocks finalize.
 */
async function fireChainedPipelines(ctx: PipelineRunOps, owner: PipelineOwner, run: RunRecord): Promise<void> {
  const depth = (run.chainDepth ?? 0) + 1;
  let activations: Array<{ projectId: string }>;
  try {
    activations = listAccountActivations(deriveActivationsRoot(tenantCtx(ctx.deps, owner)));
  } catch {
    return;
  }
  for (const { projectId } of activations) {
    // A pipeline never chains onto its own project — that run just finished.
    if (projectId === run.projectId) continue;
    try {
      const activation = loadActivationByProject(deriveActivationsRoot(tenantCtx(ctx.deps, owner)), projectId);
      if (!activation) continue;
      const defRoot = resolveDefRoot(tenantCtx(ctx.deps, owner), activation.pipelineScope);
      const def = loadPipeline(defRoot, activation.pipelineId);
      const trigger = def.on?.runCompleted;
      if (!trigger || trigger.pipelineId !== run.pipelineId) continue;
      if (!(trigger.statuses ?? ['completed']).includes(run.status)) continue;
      if (!loadAvailability(defRoot, activation.pipelineId).enabled) continue;
      await ctx.deps.scheduleQueue.addNow({
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
async function emitRunFinishedNotice(ctx: PipelineRunOps, owner: PipelineOwner, run: RunRecord): Promise<void> {
  if (!ctx.deps.chatService) return;
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
    await ctx.deps.chatService.appendAssistantMessage(run.projectId, UNIVERSAL_FEATURE, text, {
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
