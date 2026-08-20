/**
 * Pipeline CRUD + activation + run surface. Definitions are ACCOUNT-scoped
 * (`/api/pipelines`, disk SSOT `.ant/pipelines`); the project binding is a
 * separate ACTIVATION record (activate/deactivate routes, 1:1 both ways).
 * While activated: the definition is edit-locked (PUT/DELETE answer 409) and
 * the bound project rejects interactive job starts (gate in job.routes).
 *
 * The FE never computes cron: `preview-fires` is the round-trip that also
 * powers the editor's form-disable leg. Approval resolution delegates to
 * ChatService's choice-resolved funnel (one authority, one audit line, one
 * NX key) and then advances the run via the coordinator.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  toCustomId,
  isValidCustomId,
  DEFAULT_PIPELINE_CAPS,
  UNIVERSAL_FEATURE,
  type ActivePipelineInfo,
  type PipelineActivation,
  type PipelineDef,
  type PipelineListEntry,
  type PipelineRunSummary,
} from '@ant/shared';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { getNextFires, checkMinInterval } from '../../../../core/pipelines/cron';
import { derivePipelinesRoot, pipelineDir, type PipelineTenantContext } from '../../../../core/pipelines/paths';
import {
  deleteActivation,
  deletePipeline,
  findActivationByProject,
  listPipelines,
  loadActivation,
  loadPipeline,
  pipelineExists,
  readRunIndex,
  saveActivation,
  savePipeline,
  validatePipelineDefServer,
  PipelineValidationError,
} from '../../../../core/pipelines/store';
import { findDuplicateActiveJob } from '../../../../core/scheduling/UniversalDispatchGate';
import type { ScheduleQueuePort, PipelineOwner } from '../../../../core/ports/scheduler';
import type { PipelineRunCoordinator } from '../../../../infrastructure/scheduling/PipelineRunCoordinator';
import { schedulerIdFor, PIPELINE_OWNER_FILE } from '../../../../infrastructure/scheduling/PipelineReconciler';
import { REDIS_KEYS, REDIS_TTL } from '../../../../core/constants/redis';
import { getRealtimeBroadcastChannel } from '../../../../infrastructure/state/redisConstants';
import type { StateStorePort } from '../../../../core/ports/stateStore';

export interface PipelinesRoutesDeps {
  workspaceResolver: {
    getPhysicalWorkspacesPath(): string;
    getWorkspacePath(userContext: any): string;
    getProjectPath(userContext: any, projectId: string): string;
  };
  coordinator: PipelineRunCoordinator;
  scheduleQueue: ScheduleQueuePort;
  stateStore: StateStorePort;
  chatService?: {
    appendChoiceResolved(projectId: string, featureName: string, args: any): Promise<{ resolved: boolean }>;
  };
}

function ownerOf(req: Request): PipelineOwner {
  const uc = extractUserContext(req);
  return {
    userId: uc.userId,
    organizationId: uc.organizationId,
    organizationKind: (uc as any).organizationKind ?? 'local',
  };
}

export function createPipelinesRoutes(deps: PipelinesRoutesDeps): Router {
  const router = Router();

  function rootOf(owner: PipelineOwner): string {
    const ctx: PipelineTenantContext = { workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(), ...owner };
    return derivePipelinesRoot(ctx);
  }

  async function publishPipelineEvent(owner: PipelineOwner, data: Record<string, unknown>): Promise<void> {
    try {
      await deps.stateStore.publish(getRealtimeBroadcastChannel(owner.organizationId, owner.userId), {
        type: 'pipeline',
        data,
        userContext: { userId: owner.userId, organizationId: owner.organizationId },
      });
    } catch {
      /* SSE refresh hint only — never block the write */
    }
  }

  function nextFireOf(def: PipelineDef): string | undefined {
    const preview = getNextFires(def.on.schedule.cron, def.on.schedule.tz, 1);
    return preview.ok ? preview.nextFires[0] : undefined;
  }

  async function setActivationProjections(owner: PipelineOwner, pipelineId: string, activation: PipelineActivation): Promise<void> {
    await deps.stateStore.setKeyWithTTL(
      REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, pipelineId),
      JSON.stringify(activation),
      REDIS_TTL.PIPE.ACTIVATION,
    );
    await deps.stateStore.setKeyWithTTL(
      REDIS_KEYS.PIPE.PROJECT(owner.organizationId, owner.userId, activation.projectId),
      pipelineId,
      REDIS_TTL.PIPE.ACTIVATION,
    );
  }

  async function clearActivationProjections(owner: PipelineOwner, pipelineId: string, projectId: string): Promise<void> {
    await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, pipelineId)).catch(() => {});
    await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.PROJECT(owner.organizationId, owner.userId, projectId)).catch(() => {});
  }

  async function buildListEntry(owner: PipelineOwner, pipelineId: string, def: PipelineDef): Promise<PipelineListEntry> {
    let activation: PipelineActivation | null = null;
    try {
      activation = loadActivation(rootOf(owner), pipelineId);
    } catch {
      // Invalid sidecar reads as deactivated for the list; reconciler logs it.
    }
    let lastRun: PipelineListEntry['lastRun'];
    let pendingApprovalCount = 0;
    const activeRunId = await deps.coordinator.getActiveRunId(owner, pipelineId);
    if (activeRunId) {
      const run = await deps.coordinator.getRun(activeRunId);
      if (run) {
        lastRun = { runId: run.runId, status: run.status, firedAt: run.startedAt };
        pendingApprovalCount = run.steps.filter((s) => s.status === 'awaiting_gate').length;
      }
    }
    if (!lastRun) {
      const [latest] = readRunIndex(rootOf(owner), pipelineId, 1);
      if (latest) lastRun = { runId: latest.runId, status: latest.status, firedAt: latest.startedAt };
    }
    return {
      id: pipelineId,
      name: def.name,
      activation,
      cron: def.on.schedule.cron,
      tz: def.on.schedule.tz,
      stepCount: def.steps.length,
      nextFireAt: activation ? nextFireOf(def) : undefined,
      lastRun,
      pendingApprovalCount,
    };
  }

  function allPipelineIds(owner: PipelineOwner): string[] {
    return listPipelines(rootOf(owner)).map((p) => p.id);
  }

  /** 409 helper — the definition is edit-locked while activated. */
  function activatedLock(owner: PipelineOwner, pipelineId: string): PipelineActivation | null {
    try {
      return loadActivation(rootOf(owner), pipelineId);
    } catch {
      // An unreadable sidecar still means "some activation exists" — locking
      // is the safe reading (deactivate clears it).
      return { projectId: 'unknown', activatedAt: new Date(0).toISOString() };
    }
  }

  // ── List ────────────────────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const items = listPipelines(rootOf(owner));
      const entries: PipelineListEntry[] = [];
      const invalid: Array<{ id: string; error: string }> = [];
      for (const item of items) {
        if (item.error || !item.def) {
          invalid.push({ id: item.id, error: item.error ?? 'unreadable definition' });
          continue;
        }
        entries.push(await buildListEntry(owner, item.id, item.def));
      }
      res.json({ pipelines: entries, invalid, caps: DEFAULT_PIPELINE_CAPS });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesList');
    }
  });

  // ── Create (always deactivated — activation is a separate step) ─────
  router.post('/', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const def = req.body?.def as PipelineDef | undefined;
      if (!def) {
        res.status(400).json({ error: 'body.def (pipeline definition) is required' });
        return;
      }
      const errors = validatePipelineDefServer(def);
      if (errors.length > 0) {
        res.status(400).json({ error: errors[0], errors, code: 'invalid-pipeline-def' });
        return;
      }
      const root = rootOf(owner);
      const requestedId = typeof req.body?.id === 'string' ? req.body.id : toCustomId(def.name);
      if (!isValidCustomId(requestedId)) {
        res.status(400).json({ error: `Invalid pipeline id: "${requestedId}"`, code: 'invalid-pipeline-id' });
        return;
      }
      if (pipelineExists(root, requestedId)) {
        res.status(409).json({ error: `Pipeline "${requestedId}" already exists`, code: 'pipeline-exists' });
        return;
      }
      const existing = listPipelines(root);
      if (existing.length >= DEFAULT_PIPELINE_CAPS.maxPipelines) {
        res.status(400).json({ error: `At most ${DEFAULT_PIPELINE_CAPS.maxPipelines} pipelines per account`, code: 'cap-exceeded' });
        return;
      }
      await savePipeline(root, requestedId, def);
      // Owner sidecar — the fire path never infers identity from the path.
      await fs.promises.writeFile(
        path.join(pipelineDir(root, requestedId), PIPELINE_OWNER_FILE),
        JSON.stringify(owner, null, 2),
        'utf-8',
      );
      await publishPipelineEvent(owner, { cause: 'defChanged', pipelineId: requestedId });
      res.status(201).json({ id: requestedId, entry: await buildListEntry(owner, requestedId, def) });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, code: 'invalid-pipeline-def' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesCreate');
    }
  });

  // ── Cron preview (also the editor's validation leg) ────────────────
  router.post('/preview-fires', async (req: Request, res: Response) => {
    try {
      const { cron, tz } = req.body ?? {};
      if (typeof cron !== 'string') {
        res.status(400).json({ error: 'cron is required' });
        return;
      }
      const preview = getNextFires(cron, typeof tz === 'string' ? tz : undefined, 5);
      if (!preview.ok) {
        res.json({ ok: false, error: preview.error, fires: [] });
        return;
      }
      const intervalError = checkMinInterval(cron, typeof tz === 'string' ? tz : undefined);
      res.json({ ok: !intervalError, error: intervalError ?? undefined, fires: preview.nextFires });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesPreviewFires');
    }
  });

  // ── Activatable projects (universal only; FE has no project-type metadata) ──
  router.get('/activatable-projects', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const uc = extractUserContext(req);
      const { isUniversalProject } = await import('../../../../core/customAgents/universalContainer');
      const workspacePath = deps.workspaceResolver.getWorkspacePath(uc);
      let names: string[] = [];
      try {
        names = (await fs.promises.readdir(workspacePath, { withFileTypes: true }))
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map((e) => e.name);
      } catch {
        names = [];
      }
      const activations = new Map<string, string>();
      for (const item of listPipelines(rootOf(owner))) {
        try {
          const activation = loadActivation(rootOf(owner), item.id);
          if (activation) activations.set(activation.projectId, item.id);
        } catch {
          /* invalid sidecar — not activated for the picker */
        }
      }
      const projects = names
        .filter((name) => {
          try {
            return isUniversalProject(path.join(workspacePath, name));
          } catch {
            return false;
          }
        })
        .map((name) => ({ id: name, name, activePipelineId: activations.get(name) ?? null }));
      res.json({ projects });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesActivatableProjects');
    }
  });

  // ── Approvals (inbox — account-wide) ─────────────────────────────────
  router.get('/approvals', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const approvals = await deps.coordinator.listPendingApprovals(owner, allPipelineIds(owner));
      res.json({ approvals });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesApprovals');
    }
  });

  router.post('/approvals/:gateId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const decision = req.body?.decision;
      if (decision !== 'approve' && decision !== 'reject') {
        res.status(400).json({ error: 'decision must be "approve" or "reject"' });
        return;
      }
      const hitl = await deps.coordinator.getHitlByGateId(req.params.gateId);
      if (!hitl || hitl.owner.userId !== owner.userId || hitl.owner.organizationId !== owner.organizationId) {
        res.status(404).json({ error: 'gate not found', gateId: req.params.gateId });
        return;
      }
      if (!deps.chatService) {
        res.status(503).json({ error: 'Chat service not available' });
        return;
      }
      // The card lives in the RUN's project (route is account-scoped now).
      const run = await deps.coordinator.getRun(hitl.runId);
      if (!run) {
        res.status(404).json({ error: 'run not found for gate', gateId: req.params.gateId });
        return;
      }
      // Single funnel: same NX-guarded resolve as a chat-card click.
      const result = await deps.chatService.appendChoiceResolved(run.projectId, UNIVERSAL_FEATURE, {
        jobId: hitl.anchorJobId,
        cardId: hitl.cardId,
        choiceSelected: decision,
        resolvedLabel: decision === 'approve' ? 'Approved' : 'Rejected',
        userContext: owner,
      });
      if (!result.resolved) {
        res.status(409).json({ error: 'gate already resolved', gateId: req.params.gateId });
        return;
      }
      await deps.coordinator.applyResolvedGate(
        hitl.cardId,
        decision === 'approve' ? 'approved' : 'rejected',
        owner.userId,
        'api',
      );
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesApprove');
    }
  });

  // ── Run detail / cancel (before /:pipelineId so "runs" never matches an id) ──
  router.get('/runs/:runId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      let run = await deps.coordinator.getRun(req.params.runId);
      if (!run) {
        const pipelineId = typeof req.query.pipelineId === 'string' ? req.query.pipelineId : undefined;
        if (pipelineId) run = deps.coordinator.readRunFromDisk(owner, pipelineId, req.params.runId);
      }
      if (!run) {
        res.status(404).json({ error: 'run not found', runId: req.params.runId });
        return;
      }
      const { defSnapshot: _snapshot, ...publicRun } = run;
      res.json({ run: publicRun });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesRunDetail');
    }
  });

  router.post('/runs/:runId/cancel', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.body?.pipelineId;
      if (typeof pipelineId !== 'string') {
        res.status(400).json({ error: 'pipelineId is required' });
        return;
      }
      const ok = await deps.coordinator.cancelRun(owner, pipelineId, req.params.runId);
      if (!ok) {
        res.status(404).json({ error: 'run not found or already terminal', runId: req.params.runId });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesRunCancel');
    }
  });

  // ── Per-pipeline ────────────────────────────────────────────────────
  router.get('/:pipelineId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const def = loadPipeline(rootOf(owner), req.params.pipelineId);
      let activation: PipelineActivation | null = null;
      try {
        activation = loadActivation(rootOf(owner), req.params.pipelineId);
      } catch {
        /* invalid sidecar reads as deactivated here; reconciler logs it */
      }
      res.json({ id: req.params.pipelineId, def, activation });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(404).json({ error: error.message, code: 'invalid-pipeline-def' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesGet');
    }
  });

  router.put('/:pipelineId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.params.pipelineId;
      const def = req.body?.def as PipelineDef | undefined;
      if (!def) {
        res.status(400).json({ error: 'body.def (pipeline definition) is required' });
        return;
      }
      const root = rootOf(owner);
      if (!pipelineExists(root, pipelineId)) {
        res.status(404).json({ error: `Pipeline "${pipelineId}" not found` });
        return;
      }
      // Edit lock: an activated pipeline is running unattended on a schedule —
      // deactivate first, then edit. (In-flight runs are additionally protected
      // by the frozen defSnapshot.)
      const lock = activatedLock(owner, pipelineId);
      if (lock) {
        res.status(409).json({
          error: `Pipeline "${pipelineId}" is activated on project "${lock.projectId}" — deactivate it before editing`,
          code: 'pipeline-activated',
          projectId: lock.projectId,
        });
        return;
      }
      const errors = validatePipelineDefServer(def);
      if (errors.length > 0) {
        res.status(400).json({ error: errors[0], errors, code: 'invalid-pipeline-def' });
        return;
      }
      await savePipeline(root, pipelineId, def);
      await publishPipelineEvent(owner, { cause: 'defChanged', pipelineId });
      res.json({ id: pipelineId, entry: await buildListEntry(owner, pipelineId, def) });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, code: 'invalid-pipeline-def' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesUpdate');
    }
  });

  router.delete('/:pipelineId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.params.pipelineId;
      const root = rootOf(owner);
      if (!pipelineExists(root, pipelineId)) {
        res.status(404).json({ error: `Pipeline "${pipelineId}" not found` });
        return;
      }
      // Same edit lock as PUT — no more implicit cancel-and-delete.
      const lock = activatedLock(owner, pipelineId);
      if (lock) {
        res.status(409).json({
          error: `Pipeline "${pipelineId}" is activated on project "${lock.projectId}" — deactivate it before deleting`,
          code: 'pipeline-activated',
          projectId: lock.projectId,
        });
        return;
      }
      await deps.scheduleQueue.removeCron(schedulerIdFor(owner, pipelineId));
      deletePipeline(root, pipelineId);
      await publishPipelineEvent(owner, { cause: 'defChanged', pipelineId });
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesDelete');
    }
  });

  // ── Activation ──────────────────────────────────────────────────────
  router.post('/:pipelineId/activate', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const uc = extractUserContext(req);
      const pipelineId = req.params.pipelineId;
      const projectId = req.body?.projectId;
      const root = rootOf(owner);
      if (typeof projectId !== 'string' || projectId.trim().length === 0) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      let def: PipelineDef;
      try {
        def = loadPipeline(root, pipelineId);
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e), code: 'invalid-pipeline-def' });
        return;
      }

      // Gate 1 — the target must be a universal project.
      const { isUniversalProject } = await import('../../../../core/customAgents/universalContainer');
      let projectOk = false;
      try {
        projectOk = isUniversalProject(deps.workspaceResolver.getProjectPath(uc, projectId));
      } catch {
        projectOk = false;
      }
      if (!projectOk) {
        res.status(400).json({ error: `Project "${projectId}" is not a universal-type project`, code: 'project-not-universal' });
        return;
      }

      // Gate 2 — 1:1 both directions.
      let own: PipelineActivation | null = null;
      try {
        own = loadActivation(root, pipelineId);
      } catch {
        own = null; // unreadable sidecar is replaced by this activate
      }
      if (own && own.projectId !== projectId) {
        res.status(409).json({
          error: `Pipeline "${pipelineId}" is already activated on project "${own.projectId}"`,
          code: 'pipeline-already-activated',
          projectId: own.projectId,
        });
        return;
      }
      const holder = findActivationByProject(root, projectId);
      if (holder && holder.pipelineId !== pipelineId) {
        res.status(409).json({
          error: `Project "${projectId}" already has an active pipeline ("${holder.pipelineId}")`,
          code: 'project-has-active-pipeline',
          pipelineId: holder.pipelineId,
        });
        return;
      }

      // Gate 3 — activation requires a quiet project: no live job of ANY kind
      // (running or paused; jobType unfiltered).
      const liveJob = await findDuplicateActiveJob(deps.stateStore, owner, projectId, UNIVERSAL_FEATURE);
      if (liveJob) {
        res.status(409).json({
          error: `Project "${projectId}" has a live job (${liveJob.jobId}) — stop or dismiss it before activating`,
          code: 'project-has-live-job',
          existingJobId: liveJob.jobId,
        });
        return;
      }

      const activation: PipelineActivation = own ?? {
        projectId,
        activatedAt: new Date().toISOString(),
        activatedBy: owner.userId,
      };
      await saveActivation(root, pipelineId, activation);
      await setActivationProjections(owner, pipelineId, activation);
      await deps.scheduleQueue.upsertCron(schedulerIdFor(owner, pipelineId), def.on.schedule.cron, def.on.schedule.tz, {
        kind: 'fire',
        owner,
        pipelineId,
        firedBy: 'cron',
      });
      const nextFireAt = nextFireOf(def);
      await publishPipelineEvent(owner, {
        cause: 'activationChanged',
        pipelineId,
        projectId,
        activation,
        ...(nextFireAt && { nextFireAt }),
      });
      res.json({ id: pipelineId, activation, nextFireAt });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, code: 'invalid-pipeline-activation' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesActivate');
    }
  });

  router.post('/:pipelineId/deactivate', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.params.pipelineId;
      const root = rootOf(owner);
      if (!pipelineExists(root, pipelineId)) {
        res.status(404).json({ error: `Pipeline "${pipelineId}" not found` });
        return;
      }
      let activation: PipelineActivation | null = null;
      try {
        activation = loadActivation(root, pipelineId);
      } catch {
        activation = null; // unreadable sidecar: deactivate clears it below
      }
      // Order: cron off → live run cancelled + running steps killed → SSOT
      // unlink → projections cleared. Idempotent (no activation = 200).
      await deps.scheduleQueue.removeCron(schedulerIdFor(owner, pipelineId));
      await deps.coordinator.deactivate(owner, pipelineId);
      deleteActivation(root, pipelineId);
      if (activation) {
        await clearActivationProjections(owner, pipelineId, activation.projectId);
        await publishPipelineEvent(owner, {
          cause: 'activationChanged',
          pipelineId,
          projectId: activation.projectId,
          activation: null,
        });
      }
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesDeactivate');
    }
  });

  // ── Run-now / runs list ─────────────────────────────────────────────
  router.post('/:pipelineId/run-now', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.params.pipelineId;
      const root = rootOf(owner);
      if (!pipelineExists(root, pipelineId)) {
        res.status(404).json({ error: `Pipeline "${pipelineId}" not found` });
        return;
      }
      // A run needs a project binding — run-now requires activation.
      let activation: PipelineActivation | null = null;
      try {
        activation = loadActivation(root, pipelineId);
      } catch {
        activation = null;
      }
      if (!activation) {
        res.status(409).json({ error: `Pipeline "${pipelineId}" is not activated — activate it onto a project first`, code: 'pipeline-not-activated' });
        return;
      }
      const existingRunId = await deps.coordinator.getActiveRunId(owner, pipelineId);
      if (existingRunId) {
        res.status(409).json({ error: 'A run is already live for this pipeline', existingRunId });
        return;
      }
      await deps.scheduleQueue.addNow({ kind: 'fire', owner, pipelineId, firedBy: 'manual', fireEpoch: Date.now() });
      res.status(202).json({ accepted: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesRunNow');
    }
  });

  router.get('/:pipelineId/runs', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.params.pipelineId;
      const runs: PipelineRunSummary[] = readRunIndex(rootOf(owner), pipelineId, 50);
      let live: PipelineRunSummary | undefined;
      const activeRunId = await deps.coordinator.getActiveRunId(owner, pipelineId);
      if (activeRunId) {
        const run = await deps.coordinator.getRun(activeRunId);
        if (run && !runs.some((r) => r.runId === run.runId)) {
          live = {
            runId: run.runId,
            pipelineId,
            projectId: run.projectId,
            status: run.status,
            firedBy: run.firedBy,
            fireEpoch: run.fireEpoch,
            startedAt: run.startedAt,
            endedAt: run.endedAt,
          };
        }
      }
      res.json({ runs: live ? [live, ...runs] : runs });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesRuns');
    }
  });

  return router;
}

/**
 * Project-scoped read for the chat surface: does THIS project have an active
 * pipeline, and is it waiting or running? Mounted at
 * `/api/projects/:projectId/active-pipeline` (mergeParams).
 */
export function createActivePipelineRoute(deps: PipelinesRoutesDeps): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const projectId = req.params.projectId;
      const root = derivePipelinesRoot({ workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(), ...owner });
      const bound = findActivationByProject(root, projectId);
      if (!bound) {
        res.json({ active: null });
        return;
      }
      let name = bound.pipelineId;
      let nextFireAt: string | undefined;
      try {
        const def = loadPipeline(root, bound.pipelineId);
        name = def.name;
        const preview = getNextFires(def.on.schedule.cron, def.on.schedule.tz, 1);
        nextFireAt = preview.ok ? preview.nextFires[0] : undefined;
      } catch {
        /* invalid def: still report the binding */
      }
      let state: ActivePipelineInfo['state'] = 'waiting';
      let currentRunId: string | undefined;
      const activeRunId = await deps.coordinator.getActiveRunId(owner, bound.pipelineId);
      if (activeRunId) {
        currentRunId = activeRunId;
        const run = await deps.coordinator.getRun(activeRunId);
        state = run?.status === 'awaiting_human' ? 'awaiting_human' : 'running';
      }
      const active: ActivePipelineInfo = {
        pipelineId: bound.pipelineId,
        pipelineName: name,
        state,
        ...(nextFireAt && { nextFireAt }),
        ...(currentRunId && { currentRunId }),
      };
      res.json({ active });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'ActivePipeline');
    }
  });

  return router;
}
