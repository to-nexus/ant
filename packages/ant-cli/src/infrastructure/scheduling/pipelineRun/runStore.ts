/**
 * Run persistence, locking and fan-out kernel — every cluster funnels its run
 * mutations through `mutateRun` (per-run Redis lock + orphan-gate sweep), and
 * every event/SSE write goes through `appendEvent` / `publish`.
 */

import {
  isApprovalStep,
  type PipelineDef,
  type PipelineEventData,
  type PipelinePendingApproval,
  type PipelineRunEvent,
  type RunRecord,
  type StepRecord,
} from '@ant/shared';
import type { PipelineOwner } from '../../../core/ports/scheduler';
import { REDIS_KEYS, REDIS_TTL, getRealtimeBroadcastChannel } from '../../../core/constants/redis';
import { logger } from '../../../utils/logger';
import type { StepDispatch } from '../../../core/pipelines/ChainExecutor';
import { parseApproverIndexEntry, readApproverIndex } from '../../../core/pipelines/approverIndex';
import { deriveActivationsRoot, type PipelineTenantContext } from '../../../core/pipelines/paths';
import { appendRunEvent, hasRunLog, listAccountActivations, loadActivationByProject, readRunEvents } from '../../../core/pipelines/store';
import { COMPONENT, type HitlRecord, type PipelineCoordinatorDeps } from './types';

const RUN_LOCK_RETRIES = 20;
const RUN_LOCK_RETRY_DELAY_MS = 250;

export function tenantCtx(deps: PipelineCoordinatorDeps, owner: PipelineOwner): PipelineTenantContext {
  return { workspacesPath: deps.workspacesPath, ...owner };
}

export async function getRun(deps: PipelineCoordinatorDeps, runId: string): Promise<RunRecord | null> {
  const raw = await deps.stateStore.getKey(REDIS_KEYS.PIPE.RUN(runId));
  return raw ? (JSON.parse(raw) as RunRecord) : null;
}

/** Disk fallback for terminal runs whose projection has expired. */
export function readRunFromDisk(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
  projectId: string,
  runId: string,
): RunRecord | null {
  const events = readRunEvents(deriveActivationsRoot(tenantCtx(deps, owner)), projectId, runId);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const detail = events[i]?.detail as { run?: RunRecord } | undefined;
    if (events[i].event === 'run_finished' && detail?.run) return detail.run;
  }
  return null;
}

export async function saveRun(deps: PipelineCoordinatorDeps, run: RunRecord): Promise<void> {
  // Open-ended human waits (gate without timeout, clarify) must outlive the
  // 7d projection TTL — align with the ACTIVE overlap bound while awaiting.
  const awaiting = run.steps.some((s) => s.status === 'awaiting_gate' || s.status === 'awaiting_clarify');
  const ttl = awaiting ? REDIS_TTL.PIPE.ACTIVE : REDIS_TTL.PIPE.RUN;
  await deps.stateStore.setKeyWithTTL(REDIS_KEYS.PIPE.RUN(run.runId), JSON.stringify(run), ttl);
}

/**
 * Take down one armed-but-orphaned gate: timeout/remind arms, HITL record,
 * card key, and a run-log line so the audit trail says why the card
 * vanished. Idempotent — every key delete tolerates absence.
 */
async function disarmGate(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
  run: RunRecord,
  step: StepRecord,
): Promise<void> {
  const gate = step.gate;
  if (!gate) return;
  await deps.scheduleQueue.cancelDelayed(`gto-${gate.gateId}`);
  await deps.scheduleQueue.cancelDelayed(`gre-${gate.gateId}`);
  await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.HITL(gate.gateId)).catch(() => {});
  await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.CARD(gate.cardId)).catch(() => {});
  await appendEvent(deps, owner, run.projectId, {
    ts: new Date().toISOString(),
    event: 'step_completed',
    runId: run.runId,
    stepId: step.stepId,
    gateId: gate.gateId,
    detail: { outcome: 'cancelled', reason: 'gate-orphaned-by-abort' },
  });
}

export async function mutateRun(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
  runId: string,
  fn: (run: RunRecord, def: PipelineDef | undefined) => Promise<{ run: RunRecord; dispatches: StepDispatch[] }>,
): Promise<{ run: RunRecord; dispatches: StepDispatch[] } | null> {
  const lockKey = REDIS_KEYS.PIPE.RUN_LOCK(runId);
  for (let attempt = 0; attempt < RUN_LOCK_RETRIES; attempt += 1) {
    if (await deps.stateStore.acquireLock(lockKey, REDIS_TTL.PIPE.RUN_LOCK)) {
      let result: { run: RunRecord; dispatches: StepDispatch[] } | null = null;
      let orphanedGates: StepRecord[] = [];
      try {
        const live = await getRun(deps, runId);
        if (!live) return null;
        result = await fn(live, live.defSnapshot);
        await saveRun(deps, result.run);
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
        await deps.stateStore.releaseLock(lockKey).catch(() => {});
      }
      for (const step of orphanedGates) await disarmGate(deps, owner, result!.run, step);
      return result;
    }
    await new Promise((r) => setTimeout(r, RUN_LOCK_RETRY_DELAY_MS));
  }
  logger.warn(`[Pipeline] run lock starvation: ${runId}`, { component: COMPONENT });
  return null;
}

/** Overlap-guard holder for one ACTIVATION (projectId-keyed). */
export async function getActiveRunId(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
  projectId: string,
): Promise<string | null> {
  return deps.stateStore.getKey(REDIS_KEYS.PIPE.ACTIVE(owner.organizationId, owner.userId, projectId));
}

/** Pending gates across the caller's own activations (disk-derived scan). */
export async function listPendingApprovals(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
): Promise<PipelinePendingApproval[]> {
  const out: PipelinePendingApproval[] = [];
  for (const { projectId } of listAccountActivations(deriveActivationsRoot(tenantCtx(deps, owner)))) {
    const runId = await getActiveRunId(deps, owner, projectId);
    if (!runId) continue;
    const run = await getRun(deps, runId);
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
          ...(s.gate.onTimeout && { onTimeout: s.gate.onTimeout }),
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

export async function getHitlByGateId(
  deps: PipelineCoordinatorDeps,
  gateId: string,
): Promise<HitlRecord | null> {
  const raw = await deps.stateStore.getKey(REDIS_KEYS.PIPE.HITL(gateId));
  if (!raw) return null;
  return JSON.parse(raw) as HitlRecord;
}

/**
 * Pending APPROVAL-STEP gates the caller may decide on OTHER members'
 * activations — discovered via the approver-of index, then re-verified
 * against each owner's live activation.json (the index is advisory). Clarify
 * and tool rows never surface here: those stay activator-scoped in v1.
 */
export async function listApproverPendingApprovals(
  deps: PipelineCoordinatorDeps,
  caller: PipelineOwner,
): Promise<PipelinePendingApproval[]> {
  if (caller.organizationKind !== 'team') return [];
  const out: PipelinePendingApproval[] = [];
  const entries = await readApproverIndex(deps.stateStore, caller.organizationId, caller.userId);
  for (const entry of entries) {
    const parsed = parseApproverIndexEntry(entry);
    if (!parsed) continue;
    const owner: PipelineOwner = {
      userId: parsed.ownerUserId,
      organizationId: caller.organizationId,
      organizationKind: 'team',
    };
    if (owner.userId === caller.userId) continue; // own rows come from the own-scan
    let approversByGate: Record<string, string[]> | undefined;
    try {
      approversByGate = loadActivationByProject(
        deriveActivationsRoot(tenantCtx(deps, owner)),
        parsed.projectId,
      )?.approvers;
    } catch {
      continue; // unreadable/gone activation — stale index entry
    }
    if (!approversByGate) continue;
    const runId = await getActiveRunId(deps, owner, parsed.projectId);
    if (!runId) continue;
    const run = await getRun(deps, runId);
    if (!run) continue;
    for (const s of run.steps) {
      if (s.status !== 'awaiting_gate' || !s.gate || s.gate.decision) continue;
      const stepDef = run.defSnapshot?.steps.find((d) => d.id === s.stepId);
      const isTool = stepDef ? !isApprovalStep(stepDef) : s.gate.gateId.startsWith('tga-');
      if (isTool) continue;
      if (!(approversByGate[s.stepId] ?? []).includes(caller.userId)) continue;
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
        ...(s.gate.onTimeout && { onTimeout: s.gate.onTimeout }),
        role: 'approver',
        ownerUserId: owner.userId,
      });
    }
  }
  return out;
}

/**
 * Read-only run access for a NON-owner: the caller is on ANY gate's roster of
 * the activation that owns this run (index-discovered, live-verified), and the
 * owner's activation dir actually holds the run log. Grants the run DETAIL
 * only — cancel/clarify stay activator-scoped.
 */
export async function approverRunAccess(
  deps: PipelineCoordinatorDeps,
  caller: PipelineOwner,
  run: Pick<RunRecord, 'runId' | 'projectId'>,
): Promise<boolean> {
  if (caller.organizationKind !== 'team') return false;
  const entries = await readApproverIndex(deps.stateStore, caller.organizationId, caller.userId);
  for (const entry of entries) {
    const parsed = parseApproverIndexEntry(entry);
    if (!parsed || parsed.projectId !== run.projectId || parsed.ownerUserId === caller.userId) continue;
    const owner: PipelineOwner = {
      userId: parsed.ownerUserId,
      organizationId: caller.organizationId,
      organizationKind: 'team',
    };
    try {
      const activation = loadActivationByProject(deriveActivationsRoot(tenantCtx(deps, owner)), run.projectId);
      const listed = Object.values(activation?.approvers ?? {}).some((l) => l.includes(caller.userId));
      if (!listed) continue;
      if (hasRunLog(deriveActivationsRoot(tenantCtx(deps, owner)), run.projectId, run.runId)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function isTerminal(status: RunRecord['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'partial' || status === 'cancelled';
}

/** SSE payload copy — the frozen def never rides the wire. */
export function publicRun(run: RunRecord): Omit<RunRecord, 'defSnapshot'> {
  const { defSnapshot: _snapshot, ...rest } = run;
  return rest;
}

export async function appendEvent(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
  projectId: string,
  event: PipelineRunEvent,
): Promise<void> {
  try {
    await appendRunEvent(deriveActivationsRoot(tenantCtx(deps, owner)), projectId, event);
  } catch (err) {
    logger.warn(`[Pipeline] run-event append failed: ${projectId}/${event.runId}`, { component: COMPONENT }, err);
  }
}

export async function publish(
  deps: PipelineCoordinatorDeps,
  owner: PipelineOwner,
  data: PipelineEventData,
): Promise<void> {
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
    await deps.stateStore.publish(getRealtimeBroadcastChannel(owner.organizationId, owner.userId), {
      type: 'pipeline',
      data: payload,
      userContext: { userId: owner.userId, organizationId: owner.organizationId },
    });
  } catch (err) {
    logger.warn('[Pipeline] SSE publish failed', { component: COMPONENT }, err);
  }
}
