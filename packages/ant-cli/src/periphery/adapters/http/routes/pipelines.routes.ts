/**
 * Pipeline CRUD + run surface — project-scoped HTTP facade over the
 * account-scoped disk SSOT (`.ant/pipelines`). The FE never computes cron:
 * `preview-fires` is the round-trip that also powers the editor's
 * form-disable leg. Approval resolution delegates to ChatService's
 * choice-resolved funnel (one authority, one audit line, one NX key) and
 * then advances the run via the coordinator.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  toCustomId,
  isValidCustomId,
  DEFAULT_PIPELINE_CAPS,
  UNIVERSAL_FEATURE,
  type PipelineDef,
  type PipelineListEntry,
  type PipelineRunSummary,
} from '@ant/shared';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { getNextFires, checkMinInterval } from '../../../../core/pipelines/cron';
import { derivePipelinesRoot, pipelineDir, type PipelineTenantContext } from '../../../../core/pipelines/paths';
import {
  deletePipeline,
  listPipelines,
  loadPipeline,
  pipelineExists,
  readRunIndex,
  savePipeline,
  validatePipelineDefServer,
  PipelineValidationError,
} from '../../../../core/pipelines/store';
import type { ScheduleQueuePort, PipelineOwner } from '../../../../core/ports/scheduler';
import type { PipelineRunCoordinator } from '../../../../infrastructure/scheduling/PipelineRunCoordinator';
import { schedulerIdFor, PIPELINE_OWNER_FILE } from '../../../../infrastructure/scheduling/PipelineReconciler';
import { getRealtimeBroadcastChannel } from '../../../../infrastructure/state/redisConstants';
import type { StateStorePort } from '../../../../core/ports/stateStore';

export function createPipelinesRoutes(deps: {
  workspaceResolver: { getPhysicalWorkspacesPath(): string };
  coordinator: PipelineRunCoordinator;
  scheduleQueue: ScheduleQueuePort;
  stateStore: StateStorePort;
  chatService?: {
    appendChoiceResolved(projectId: string, featureName: string, args: any): Promise<{ resolved: boolean }>;
  };
}): Router {
  const router = Router({ mergeParams: true });

  function ownerOf(req: Request): PipelineOwner {
    const uc = extractUserContext(req);
    return {
      userId: uc.userId,
      organizationId: uc.organizationId,
      organizationKind: (uc as any).organizationKind ?? 'local',
    };
  }

  function rootOf(owner: PipelineOwner): string {
    const ctx: PipelineTenantContext = { workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(), ...owner };
    return derivePipelinesRoot(ctx);
  }

  async function publishDefChanged(owner: PipelineOwner, projectId: string, pipelineId: string): Promise<void> {
    try {
      await deps.stateStore.publish(getRealtimeBroadcastChannel(owner.organizationId, owner.userId), {
        type: 'pipeline',
        data: { cause: 'defChanged', projectId, pipelineId },
        userContext: { userId: owner.userId, organizationId: owner.organizationId },
      });
    } catch {
      /* SSE refresh hint only — never block the write */
    }
  }

  async function syncScheduler(owner: PipelineOwner, pipelineId: string, def: PipelineDef): Promise<void> {
    const id = schedulerIdFor(owner, pipelineId);
    if (def.enabled) {
      await deps.scheduleQueue.upsertCron(id, def.on.schedule.cron, def.on.schedule.tz, {
        kind: 'fire',
        owner,
        pipelineId,
        firedBy: 'cron',
      });
    } else {
      await deps.scheduleQueue.removeCron(id);
    }
  }

  async function buildListEntry(owner: PipelineOwner, pipelineId: string, def: PipelineDef): Promise<PipelineListEntry> {
    let nextFireAt: string | undefined;
    if (def.enabled) {
      const preview = getNextFires(def.on.schedule.cron, def.on.schedule.tz, 1);
      nextFireAt = preview.ok ? preview.nextFires[0] : undefined;
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
      enabled: def.enabled,
      projectId: def.projectId,
      cron: def.on.schedule.cron,
      tz: def.on.schedule.tz,
      stepCount: def.steps.length,
      nextFireAt,
      lastRun,
      pendingApprovalCount,
    };
  }

  function projectPipelineIds(owner: PipelineOwner, projectId: string): string[] {
    return listPipelines(rootOf(owner))
      .filter((p) => p.def?.projectId === projectId)
      .map((p) => p.id);
  }

  // ── List ────────────────────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const projectId = req.params.projectId;
      const items = listPipelines(rootOf(owner));
      const entries: PipelineListEntry[] = [];
      const invalid: Array<{ id: string; error: string }> = [];
      for (const item of items) {
        if (item.error || !item.def) {
          invalid.push({ id: item.id, error: item.error ?? 'unreadable definition' });
          continue;
        }
        if (item.def.projectId !== projectId) continue;
        entries.push(await buildListEntry(owner, item.id, item.def));
      }
      res.json({ pipelines: entries, invalid, caps: DEFAULT_PIPELINE_CAPS });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesList');
    }
  });

  // ── Create ──────────────────────────────────────────────────────────
  router.post('/', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const projectId = req.params.projectId;
      const def = req.body?.def as PipelineDef | undefined;
      if (!def) {
        res.status(400).json({ error: 'body.def (pipeline definition) is required' });
        return;
      }
      if (def.projectId !== projectId) {
        res.status(400).json({ error: `def.projectId must match the route project ("${projectId}")`, code: 'project-mismatch' });
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
      await syncScheduler(owner, requestedId, def);
      await publishDefChanged(owner, projectId, requestedId);
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

  // ── Approvals (inbox) ───────────────────────────────────────────────
  router.get('/approvals', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const projectId = req.params.projectId;
      const approvals = await deps.coordinator.listPendingApprovals(owner, projectPipelineIds(owner, projectId));
      res.json({ approvals });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesApprovals');
    }
  });

  router.post('/approvals/:gateId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const projectId = req.params.projectId;
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
      // Single funnel: same NX-guarded resolve as a chat-card click.
      const result = await deps.chatService.appendChoiceResolved(projectId, UNIVERSAL_FEATURE, {
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
      res.json({ id: req.params.pipelineId, def });
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
      const projectId = req.params.projectId;
      const pipelineId = req.params.pipelineId;
      const def = req.body?.def as PipelineDef | undefined;
      if (!def) {
        res.status(400).json({ error: 'body.def (pipeline definition) is required' });
        return;
      }
      if (def.projectId !== projectId) {
        res.status(400).json({ error: `def.projectId must match the route project ("${projectId}")`, code: 'project-mismatch' });
        return;
      }
      const root = rootOf(owner);
      if (!pipelineExists(root, pipelineId)) {
        res.status(404).json({ error: `Pipeline "${pipelineId}" not found` });
        return;
      }
      const errors = validatePipelineDefServer(def);
      if (errors.length > 0) {
        res.status(400).json({ error: errors[0], errors, code: 'invalid-pipeline-def' });
        return;
      }
      await savePipeline(root, pipelineId, def);
      await syncScheduler(owner, pipelineId, def);
      await publishDefChanged(owner, projectId, pipelineId);
      res.json({ id: pipelineId, entry: await buildListEntry(owner, pipelineId, def) });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, code: 'invalid-pipeline-def' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesUpdate');
    }
  });

  router.patch('/:pipelineId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const enabled = req.body?.enabled;
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled (boolean) is required' });
        return;
      }
      const root = rootOf(owner);
      const def = loadPipeline(root, req.params.pipelineId);
      const next = { ...def, enabled };
      await savePipeline(root, req.params.pipelineId, next);
      await syncScheduler(owner, req.params.pipelineId, next);
      await publishDefChanged(owner, req.params.projectId, req.params.pipelineId);
      res.json({ id: req.params.pipelineId, entry: await buildListEntry(owner, req.params.pipelineId, next) });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, code: 'invalid-pipeline-def' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesPatch');
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
      await deps.scheduleQueue.removeCron(schedulerIdFor(owner, pipelineId));
      const activeRunId = await deps.coordinator.getActiveRunId(owner, pipelineId);
      if (activeRunId) {
        await deps.coordinator.cancelRun(owner, pipelineId, activeRunId).catch(() => {});
      }
      deletePipeline(root, pipelineId);
      await publishDefChanged(owner, req.params.projectId, pipelineId);
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesDelete');
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
