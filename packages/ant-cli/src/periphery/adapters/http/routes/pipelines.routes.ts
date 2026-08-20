/**
 * Pipeline CRUD + availability + activation + run surface.
 *
 * Definitions are scoped TEMPLATES (`/api/pipelines`): personal + org scope
 * roots (agents precedent), merged closest-wins, org writes judged per-caller
 * by the pipeline ACL. The AVAILABILITY state machine binds the write surface:
 * PUT/DELETE/promote require `disabled`, activate requires `enabled`, disable
 * requires zero activations (never cascaded — holders deactivate themselves).
 *
 * Activations are the scheduling unit and live in the CALLER's account keyed
 * by projectId — a pipeline may be activated by many users on many projects;
 * a project holds at most one activation (structural: one dir per projectId).
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
  MEMBERSHIP_REQUIRED,
  UNIVERSAL_FEATURE,
  type ActivePipelineInfo,
  type PipelineActivation,
  type PipelineActivationView,
  type PipelineDef,
  type PipelineListEntry,
  type PipelineRunSummary,
  type PipelineScope,
} from '@ant/shared';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import {
  canEditOrgResource,
  computeOrgResourcePermissions,
  createOrgGateResolver,
  readOrgPipelineAcl,
  updateOrgPipelineAcl,
  type OrgResourceGate,
} from './helpers/orgAclStore';
import { resolveLiveTeamMembership } from './helpers/teamRole';
import { getNextFires, checkMinInterval } from '../../../../core/pipelines/cron';
import {
  deriveActivationsRoot,
  derivePipelinesRoot,
  pipelineDir,
  type PipelineTenantContext,
} from '../../../../core/pipelines/paths';
import {
  derivePipelineScopeRootsForTenant,
  resolveDefRoot,
  type PipelineScopeRoot,
} from '../../../../core/pipelines/scopeRoots';
import {
  deleteActivationRecord,
  deletePipeline,
  findActivationsForPipeline,
  hasRunLog,
  listAccountActivations,
  listPipelines,
  loadActivationByProject,
  loadAvailability,
  loadPipeline,
  pipelineExists,
  readRunIndex,
  saveActivationRecord,
  saveAvailability,
  savePipeline,
  validatePipelineDefServer,
  PipelineValidationError,
} from '../../../../core/pipelines/store';
import { findDuplicateActiveJob } from '../../../../core/scheduling/UniversalDispatchGate';
import type { OrganizationRepositoryPort } from '../../../../core/ports/organizationRepository';
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
  organizationRepository: OrganizationRepositoryPort;
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

  const orgGateFor = createOrgGateResolver(
    {
      organizationRepository: deps.organizationRepository,
      workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(),
    },
    readOrgPipelineAcl,
  );

  function ctxOf(owner: PipelineOwner): PipelineTenantContext {
    return { workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(), ...owner };
  }

  function scopeRootsOf(owner: PipelineOwner): PipelineScopeRoot[] {
    return derivePipelineScopeRootsForTenant(ctxOf(owner));
  }

  function actRootOf(owner: PipelineOwner): string {
    return deriveActivationsRoot(ctxOf(owner));
  }

  /** Closest-wins definition resolve across the caller's scope roots. */
  function findPipelineRoot(
    scopeRoots: PipelineScopeRoot[],
    pipelineId: string,
  ): { scopeRoot: PipelineScopeRoot } | null {
    for (const scopeRoot of scopeRoots) {
      if (pipelineExists(scopeRoot.root, pipelineId)) return { scopeRoot };
    }
    return null;
  }

  /** Any-scope resolve (org pipelines are viewable by every member) or 400/404. */
  function findViewablePipeline(
    res: Response,
    owner: PipelineOwner,
    pipelineId: string,
  ): { scopeRoot: PipelineScopeRoot } | null {
    if (!isValidCustomId(pipelineId)) {
      res.status(400).json({ error: `Invalid pipeline id: ${pipelineId}` });
      return null;
    }
    const found = findPipelineRoot(scopeRootsOf(owner), pipelineId);
    if (!found) {
      res.status(404).json({ error: `Pipeline not found: ${pipelineId}` });
      return null;
    }
    return found;
  }

  /** Write funnel: 400 invalid id / 404 not found / 403 org-ACL refusal (findWritableAgent mirror). */
  async function findWritablePipeline(
    res: Response,
    req: Request,
    owner: PipelineOwner,
    pipelineId: string,
  ): Promise<{ scopeRoot: PipelineScopeRoot } | null> {
    const found = findViewablePipeline(res, owner, pipelineId);
    if (!found) return null;
    if (found.scopeRoot.aclGoverned) {
      const gate = await orgGateFor(req)();
      if (!canEditOrgResource(gate.records[pipelineId], gate.callerId, gate.liveRole)) {
        res.status(403).json({
          error: `You do not have edit access to org pipeline "${pipelineId}" — ask the pipeline owner or an org admin`,
          code: 'org-pipeline-forbidden',
        });
        return null;
      }
    }
    return found;
  }

  /** 409 when the availability machine forbids writes (enabled = published). */
  function refuseWhileEnabled(res: Response, root: string, pipelineId: string, action: string): boolean {
    let enabled: boolean;
    try {
      enabled = loadAvailability(root, pipelineId).enabled;
    } catch {
      // Unreadable sidecar: refusing is the safe reading (disable rewrites it).
      enabled = true;
    }
    if (enabled) {
      res.status(409).json({
        error: `Pipeline "${pipelineId}" is enabled — disable it before ${action}`,
        code: 'pipeline-enabled',
      });
      return true;
    }
    return false;
  }

  function safeEnabled(root: string, pipelineId: string): boolean {
    try {
      return loadAvailability(root, pipelineId).enabled;
    } catch {
      return false;
    }
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

  async function setActivationProjections(owner: PipelineOwner, activation: PipelineActivation): Promise<void> {
    await deps.stateStore.setKeyWithTTL(
      REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, activation.projectId),
      JSON.stringify(activation),
      REDIS_TTL.PIPE.ACTIVATION,
    );
    await deps.stateStore.setKeyWithTTL(
      REDIS_KEYS.PIPE.PROJECT(owner.organizationId, owner.userId, activation.projectId),
      activation.pipelineId,
      REDIS_TTL.PIPE.ACTIVATION,
    );
  }

  async function clearActivationProjections(owner: PipelineOwner, projectId: string): Promise<void> {
    await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.ACTIVATION(owner.organizationId, owner.userId, projectId)).catch(() => {});
    await deps.stateStore.deleteKey(REDIS_KEYS.PIPE.PROJECT(owner.organizationId, owner.userId, projectId)).catch(() => {});
  }

  /** One activation row hydrated with live state (Redis) + last run (disk). */
  async function activationView(
    actOwner: PipelineOwner,
    activation: PipelineActivation,
    mine: boolean,
    nextFireAt: string | undefined,
    broken: boolean,
  ): Promise<PipelineActivationView> {
    let state: PipelineActivationView['state'] = broken ? 'broken' : 'waiting';
    let currentRunId: string | undefined;
    let lastRun: PipelineActivationView['lastRun'];
    const runId = await deps.coordinator.getActiveRunId(actOwner, activation.projectId);
    if (runId) {
      currentRunId = runId;
      const run = await deps.coordinator.getRun(runId);
      if (run) {
        if (!broken) state = run.status === 'awaiting_human' ? 'awaiting_human' : 'running';
        lastRun = { runId: run.runId, status: run.status, firedAt: run.startedAt };
      }
    }
    if (!lastRun) {
      const [latest] = readRunIndex(deriveActivationsRoot(ctxOf(actOwner)), activation.projectId, 1, activation.pipelineId);
      if (latest) lastRun = { runId: latest.runId, status: latest.status, firedAt: latest.startedAt };
    }
    return {
      pipelineId: activation.pipelineId,
      projectId: activation.projectId,
      activatedBy: activation.activatedBy ?? actOwner.userId,
      activatedAt: activation.activatedAt,
      mine,
      state,
      ...(broken ? {} : nextFireAt ? { nextFireAt } : {}),
      ...(currentRunId && { currentRunId }),
      ...(lastRun && { lastRun }),
    };
  }

  /**
   * All activations of one pipeline visible to the caller: their own, plus —
   * for org-scope pipelines — every org member's (read-only rows, `mine: false`).
   */
  async function listActivationViews(
    owner: PipelineOwner,
    scope: PipelineScope,
    pipelineId: string,
    nextFireAt: string | undefined,
    enabled: boolean,
  ): Promise<PipelineActivationView[]> {
    const views: PipelineActivationView[] = [];
    const own = listAccountActivations(actRootOf(owner)).filter(
      (a) => a.pipelineId === pipelineId && a.pipelineScope === scope,
    );
    for (const activation of own) {
      views.push(await activationView(owner, activation, true, nextFireAt, !enabled));
    }
    if (scope === 'org' && owner.organizationKind === 'team') {
      const all = findActivationsForPipeline(
        deps.workspaceResolver.getPhysicalWorkspacesPath(),
        owner.organizationId,
        pipelineId,
      );
      for (const { userId, activation } of all) {
        if (userId === owner.userId || activation.pipelineScope !== 'org') continue;
        const member: PipelineOwner = { userId, organizationId: owner.organizationId, organizationKind: 'team' };
        views.push(await activationView(member, activation, false, nextFireAt, !enabled));
      }
    }
    return views;
  }

  async function buildListEntry(
    owner: PipelineOwner,
    gate: OrgResourceGate | null,
    scopeRoot: PipelineScopeRoot,
    pipelineId: string,
    def: PipelineDef,
    pendingByPipeline: Map<string, number>,
  ): Promise<PipelineListEntry> {
    const enabled = safeEnabled(scopeRoot.root, pipelineId);
    const isOrg = scopeRoot.scope === 'org' && !!scopeRoot.aclGoverned;
    const org = isOrg && gate ? computeOrgResourcePermissions(gate.records[pipelineId], gate.callerId, gate.liveRole) : undefined;
    const readonly = isOrg ? !(org?.canEdit ?? false) : false;
    const fire = nextFireOf(def);
    const activations = await listActivationViews(owner, scopeRoot.scope, pipelineId, fire, enabled);
    const mineActive = activations.filter((a) => a.mine);
    let lastRun: PipelineListEntry['lastRun'];
    for (const a of mineActive) {
      if (a.lastRun && (!lastRun || a.lastRun.firedAt > lastRun.firedAt)) lastRun = a.lastRun;
    }
    return {
      id: pipelineId,
      name: def.name,
      cron: def.on.schedule.cron,
      tz: def.on.schedule.tz,
      stepCount: def.steps.length,
      scope: scopeRoot.scope,
      readonly,
      enabled,
      ...(org && { org }),
      activations,
      ...(enabled && mineActive.length > 0 && fire ? { nextFireAt: fire } : {}),
      ...(lastRun && { lastRun }),
      pendingApprovalCount: pendingByPipeline.get(pipelineId) ?? 0,
    };
  }

  // ── List ────────────────────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const scopeRoots = scopeRootsOf(owner);
      const needsGate = scopeRoots.some((r) => r.aclGoverned);
      const gate = needsGate ? await orgGateFor(req)() : null;
      const pending = await deps.coordinator.listPendingApprovals(owner);
      const pendingByPipeline = new Map<string, number>();
      for (const p of pending) pendingByPipeline.set(p.pipelineId, (pendingByPipeline.get(p.pipelineId) ?? 0) + 1);

      const entries: PipelineListEntry[] = [];
      const invalid: Array<{ id: string; error: string; scope: PipelineScope }> = [];
      const seen = new Set<string>();
      const resolvable = new Set<string>(); // "{scope}:{id}" — orphan-activation detection
      for (const scopeRoot of scopeRoots) {
        for (const item of listPipelines(scopeRoot.root)) {
          if (seen.has(item.id)) continue; // closest scope wins id collisions
          seen.add(item.id);
          if (item.error || !item.def) {
            invalid.push({ id: item.id, error: item.error ?? 'unreadable definition', scope: scopeRoot.scope });
            continue;
          }
          resolvable.add(`${scopeRoot.scope}:${item.id}`);
          entries.push(await buildListEntry(owner, gate, scopeRoot, item.id, item.def, pendingByPipeline));
        }
      }

      // Own activations whose pinned definition no longer resolves — surfaced,
      // never auto-deleted (the execution view offers deactivate).
      const orphanActivations: PipelineActivationView[] = [];
      for (const activation of listAccountActivations(actRootOf(owner))) {
        if (resolvable.has(`${activation.pipelineScope}:${activation.pipelineId}`)) continue;
        orphanActivations.push(await activationView(owner, activation, true, undefined, true));
      }

      res.json({ pipelines: entries, invalid, orphanActivations, caps: DEFAULT_PIPELINE_CAPS });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesList');
    }
  });

  // ── Create (personal root, DISABLED draft — enable is a separate step) ──
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
      const scopeRoots = scopeRootsOf(owner);
      const root = derivePipelinesRoot(ctxOf(owner));
      const requestedId = typeof req.body?.id === 'string' ? req.body.id : toCustomId(def.name);
      if (!isValidCustomId(requestedId)) {
        res.status(400).json({ error: `Invalid pipeline id: "${requestedId}"`, code: 'invalid-pipeline-id' });
        return;
      }
      // Cross-scope collision: shadowing an org pipeline is refused, not applied.
      const collision = findPipelineRoot(scopeRoots, requestedId);
      if (collision) {
        res.status(409).json({
          error:
            collision.scopeRoot.scope === 'org'
              ? `Pipeline id "${requestedId}" is taken by an org pipeline — choose another id`
              : `Pipeline "${requestedId}" already exists`,
          code: 'pipeline-exists',
        });
        return;
      }
      const existing = listPipelines(root);
      if (existing.length >= DEFAULT_PIPELINE_CAPS.maxPipelines) {
        res.status(400).json({ error: `At most ${DEFAULT_PIPELINE_CAPS.maxPipelines} pipelines per account`, code: 'cap-exceeded' });
        return;
      }
      await savePipeline(root, requestedId, def);
      // Authorship sidecar — display/bookkeeping only; the fire identity is the activator's.
      await fs.promises.writeFile(
        path.join(pipelineDir(root, requestedId), PIPELINE_OWNER_FILE),
        JSON.stringify(owner, null, 2),
        'utf-8',
      );
      await saveAvailability(root, requestedId, {
        enabled: false,
        changedAt: new Date().toISOString(),
        changedBy: owner.userId,
      });
      await publishPipelineEvent(owner, { cause: 'defChanged', pipelineId: requestedId });
      const userRoot = scopeRoots.find((r) => r.scope === 'user')!;
      res.status(201).json({
        id: requestedId,
        entry: await buildListEntry(owner, null, userRoot, requestedId, def, new Map()),
      });
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
      for (const activation of listAccountActivations(actRootOf(owner))) {
        activations.set(activation.projectId, activation.pipelineId);
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

  // ── Approvals (inbox — the caller's own activations) ─────────────────
  router.get('/approvals', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const approvals = await deps.coordinator.listPendingApprovals(owner);
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
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
        if (projectId) run = deps.coordinator.readRunFromDisk(owner, projectId, req.params.runId);
      }
      // Own runs only: the caller's own activation dir must hold the run log
      // (the coordinator writes it there on fire) — members' rows are summaries.
      if (run && !hasRunLog(actRootOf(owner), run.projectId, run.runId)) run = null;
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
      const run = await deps.coordinator.getRun(req.params.runId);
      // Own runs only — same structural check as the detail read.
      if (!run || !hasRunLog(actRootOf(owner), run.projectId, run.runId)) {
        res.status(404).json({ error: 'run not found or already terminal', runId: req.params.runId });
        return;
      }
      const ok = await deps.coordinator.cancelRun(owner, req.params.runId);
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
      const found = findViewablePipeline(res, owner, req.params.pipelineId);
      if (!found) return;
      const { scopeRoot } = found;
      const def = loadPipeline(scopeRoot.root, req.params.pipelineId);
      const enabled = safeEnabled(scopeRoot.root, req.params.pipelineId);
      const gate = scopeRoot.aclGoverned ? await orgGateFor(req)() : null;
      const org = gate ? computeOrgResourcePermissions(gate.records[req.params.pipelineId], gate.callerId, gate.liveRole) : undefined;
      const activations = await listActivationViews(owner, scopeRoot.scope, req.params.pipelineId, nextFireOf(def), enabled);
      res.json({
        id: req.params.pipelineId,
        def,
        scope: scopeRoot.scope,
        readonly: scopeRoot.aclGoverned ? !(org?.canEdit ?? false) : false,
        enabled,
        ...(org && { org }),
        activations,
      });
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
      const found = await findWritablePipeline(res, req, owner, pipelineId);
      if (!found) return;
      // Availability machine: editable only while disabled (disabled ⇒ zero
      // activations ⇒ no crons to resync; in-flight runs hold defSnapshot).
      if (refuseWhileEnabled(res, found.scopeRoot.root, pipelineId, 'editing')) return;
      const errors = validatePipelineDefServer(def);
      if (errors.length > 0) {
        res.status(400).json({ error: errors[0], errors, code: 'invalid-pipeline-def' });
        return;
      }
      await savePipeline(found.scopeRoot.root, pipelineId, def);
      await publishPipelineEvent(owner, { cause: 'defChanged', pipelineId });
      const gate = found.scopeRoot.aclGoverned ? await orgGateFor(req)() : null;
      res.json({
        id: pipelineId,
        entry: await buildListEntry(owner, gate, found.scopeRoot, pipelineId, def, new Map()),
      });
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
      const found = await findWritablePipeline(res, req, owner, pipelineId);
      if (!found) return;
      // Disabled-only (disabled ⇒ zero activations ⇒ no cron to remove).
      if (refuseWhileEnabled(res, found.scopeRoot.root, pipelineId, 'deleting')) return;
      deletePipeline(found.scopeRoot.root, pipelineId);
      if (found.scopeRoot.aclGoverned) {
        await updateOrgPipelineAcl(
          deps.workspaceResolver.getPhysicalWorkspacesPath(),
          owner.organizationId,
          (records) => {
            delete records[pipelineId];
          },
        );
      }
      await publishPipelineEvent(owner, { cause: 'defChanged', pipelineId });
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesDelete');
    }
  });

  // ── Availability (enable = publish, disable = reclaim for editing) ────
  router.post('/:pipelineId/enable', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.params.pipelineId;
      const found = await findWritablePipeline(res, req, owner, pipelineId);
      if (!found) return;
      // Publish requires a valid definition — a broken draft never activates.
      try {
        loadPipeline(found.scopeRoot.root, pipelineId);
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e), code: 'invalid-pipeline-def' });
        return;
      }
      await saveAvailability(found.scopeRoot.root, pipelineId, {
        enabled: true,
        changedAt: new Date().toISOString(),
        changedBy: owner.userId,
      });
      await publishPipelineEvent(owner, { cause: 'availabilityChanged', pipelineId, enabled: true });
      res.json({ id: pipelineId, enabled: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesEnable');
    }
  });

  router.post('/:pipelineId/disable', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.params.pipelineId;
      const found = await findWritablePipeline(res, req, owner, pipelineId);
      if (!found) return;
      const holders = () =>
        listActivationViews(owner, found.scopeRoot.scope, pipelineId, undefined, true).then((views) =>
          views.map((v) => ({ userId: v.activatedBy, projectId: v.projectId })),
        );
      // Zero-activation gate — never cascaded, never force-deactivated:
      // holders (including other org members) deactivate themselves first.
      let active = await holders();
      if (active.length > 0) {
        res.status(409).json({
          error: `Pipeline "${pipelineId}" has ${active.length} activation(s) — ask the holder(s) to deactivate first`,
          code: 'pipeline-has-activations',
          activations: active,
        });
        return;
      }
      await saveAvailability(found.scopeRoot.root, pipelineId, {
        enabled: false,
        changedAt: new Date().toISOString(),
        changedBy: owner.userId,
      });
      // Race guard: an activate that read `enabled` before our write may have
      // landed an activation after our scan — roll back rather than strand it.
      active = await holders();
      if (active.length > 0) {
        await saveAvailability(found.scopeRoot.root, pipelineId, {
          enabled: true,
          changedAt: new Date().toISOString(),
          changedBy: owner.userId,
        });
        res.status(409).json({
          error: `Pipeline "${pipelineId}" was activated concurrently — ask the holder(s) to deactivate first`,
          code: 'pipeline-has-activations',
          activations: active,
        });
        return;
      }
      await publishPipelineEvent(owner, { cause: 'availabilityChanged', pipelineId, enabled: false });
      res.json({ id: pipelineId, enabled: false });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesDisable');
    }
  });

  // ── Org scoping: promote / permissions / editors (accountAgents mirror) ──
  router.post('/:pipelineId/promote', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.params.pipelineId;
      if (owner.organizationKind !== 'team') {
        res.status(400).json({ error: 'Promoting requires an active team organization', code: 'not-team-active' });
        return;
      }
      const membership = await resolveLiveTeamMembership(
        deps.organizationRepository,
        owner.userId,
        owner.organizationId,
      );
      if (!membership) {
        res.status(403).json({ error: 'You are not a member of this organization', code: MEMBERSHIP_REQUIRED });
        return;
      }
      const found = findViewablePipeline(res, owner, pipelineId);
      if (!found) return;
      if (found.scopeRoot.scope !== 'user') {
        res.status(400).json({ error: `Pipeline "${pipelineId}" is not in your personal scope`, code: 'not-user-scope' });
        return;
      }
      // Promote moves the definition dir — disabled-only, like every other write.
      if (refuseWhileEnabled(res, found.scopeRoot.root, pipelineId, 'promoting')) return;
      const workspacesPath = deps.workspaceResolver.getPhysicalWorkspacesPath();
      const orgRoot = resolveDefRoot(ctxOf(owner), 'org');
      const destDir = pipelineDir(orgRoot, pipelineId);
      if (fs.existsSync(path.join(destDir, 'pipeline.yaml'))) {
        res.status(409).json({ error: `An org pipeline with id "${pipelineId}" already exists`, code: 'org-pipeline-exists' });
        return;
      }
      // ACL entry FIRST — an orphan entry is harmless if the move fails; a
      // moved dir without an owner record would strand the pipeline admin-only.
      await updateOrgPipelineAcl(workspacesPath, owner.organizationId, (records) => {
        records[pipelineId] = { owner: owner.userId, editors: [] };
      });
      try {
        fs.mkdirSync(path.dirname(destDir), { recursive: true });
        fs.renameSync(pipelineDir(found.scopeRoot.root, pipelineId), destDir);
      } catch (moveError) {
        try {
          await updateOrgPipelineAcl(workspacesPath, owner.organizationId, (records) => {
            delete records[pipelineId];
          });
        } catch { /* best-effort rollback — orphan entries are inert */ }
        throw moveError;
      }
      await publishPipelineEvent(owner, { cause: 'defChanged', pipelineId });
      res.status(201).json({ id: pipelineId, scope: 'org', owner: owner.userId });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesPromote');
    }
  });

  /** Resolve an ACL-governed org pipeline or answer 400/404. */
  function findOrgAclPipeline(
    res: Response,
    owner: PipelineOwner,
    pipelineId: string,
  ): { scopeRoot: PipelineScopeRoot } | null {
    if (!isValidCustomId(pipelineId)) {
      res.status(400).json({ error: `Invalid pipeline id: ${pipelineId}` });
      return null;
    }
    const found = findPipelineRoot(scopeRootsOf(owner), pipelineId);
    if (!found || !found.scopeRoot.aclGoverned) {
      res.status(404).json({ error: `Org pipeline not found: ${pipelineId}` });
      return null;
    }
    return found;
  }

  router.get('/:pipelineId/permissions', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      if (!findOrgAclPipeline(res, owner, req.params.pipelineId)) return;
      const gate = await orgGateFor(req)();
      res.json(computeOrgResourcePermissions(gate.records[req.params.pipelineId], gate.callerId, gate.liveRole));
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesPermissions');
    }
  });

  router.put('/:pipelineId/editors', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      if (!findOrgAclPipeline(res, owner, req.params.pipelineId)) return;
      const gate = await orgGateFor(req)();
      const entry = gate.records[req.params.pipelineId];
      const perms = computeOrgResourcePermissions(entry, gate.callerId, gate.liveRole);
      if (!perms.canManageEditors) {
        res.status(403).json({
          error: `You do not have permission to manage editors of "${req.params.pipelineId}"`,
          code: 'org-pipeline-forbidden',
        });
        return;
      }
      const rawEditors = req.body?.editors;
      if (!Array.isArray(rawEditors) || rawEditors.some((e) => typeof e !== 'string')) {
        res.status(400).json({ error: 'editors must be an array of userIds (emails)' });
        return;
      }
      const editors = [...new Set(rawEditors.map((e: string) => e.trim().toLowerCase()).filter(Boolean))]
        .filter((e) => e !== entry?.owner);
      for (const editorId of editors) {
        const m = await deps.organizationRepository.getMembership(editorId, owner.organizationId);
        if (!m) {
          res.status(400).json({ error: `"${editorId}" is not a member of this organization`, code: 'editor-not-member' });
          return;
        }
      }
      const updated = await updateOrgPipelineAcl(
        deps.workspaceResolver.getPhysicalWorkspacesPath(),
        owner.organizationId,
        (records) => {
          // Pre-ACL org pipeline (no entry): the managing admin adopts ownership.
          const cur = records[req.params.pipelineId] ?? { owner: gate.callerId, editors: [] };
          records[req.params.pipelineId] = { ...cur, editors };
        },
      );
      res.json(computeOrgResourcePermissions(updated[req.params.pipelineId], gate.callerId, gate.liveRole));
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesEditors');
    }
  });

  // ── Activations ─────────────────────────────────────────────────────
  router.get('/:pipelineId/activations', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const found = findViewablePipeline(res, owner, req.params.pipelineId);
      if (!found) return;
      const def = loadPipeline(found.scopeRoot.root, req.params.pipelineId);
      const enabled = safeEnabled(found.scopeRoot.root, req.params.pipelineId);
      const activations = await listActivationViews(
        owner,
        found.scopeRoot.scope,
        req.params.pipelineId,
        nextFireOf(def),
        enabled,
      );
      res.json({ activations });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(404).json({ error: error.message, code: 'invalid-pipeline-def' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesActivations');
    }
  });

  router.post('/:pipelineId/activate', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const uc = extractUserContext(req);
      const pipelineId = req.params.pipelineId;
      const projectId = req.body?.projectId;
      if (typeof projectId !== 'string' || projectId.trim().length === 0) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      const found = findViewablePipeline(res, owner, pipelineId);
      if (!found) return;
      const defRoot = found.scopeRoot.root;
      let def: PipelineDef;
      try {
        def = loadPipeline(defRoot, pipelineId);
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e), code: 'invalid-pipeline-def' });
        return;
      }

      // Gate 0 — availability: only an enabled (published) pipeline activates.
      if (!safeEnabled(defRoot, pipelineId)) {
        res.status(409).json({ error: `Pipeline "${pipelineId}" is disabled — enable it first`, code: 'pipeline-disabled' });
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

      // Gate 2 — one active pipeline per project (structural: one dir per
      // projectId). The pipeline side is unbounded — more projects welcome.
      const actRoot = actRootOf(owner);
      let holder: PipelineActivation | null = null;
      try {
        holder = loadActivationByProject(actRoot, projectId);
      } catch {
        // Unreadable sidecar still means "this project is taken" — refuse;
        // deactivate clears it.
        res.status(409).json({
          error: `Project "${projectId}" has an unreadable activation record — deactivate it first`,
          code: 'project-has-active-pipeline',
        });
        return;
      }
      if (holder && !(holder.pipelineId === pipelineId && holder.pipelineScope === found.scopeRoot.scope)) {
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

      const activation: PipelineActivation = holder ?? {
        pipelineId,
        pipelineScope: found.scopeRoot.scope,
        projectId,
        activatedAt: new Date().toISOString(),
        activatedBy: owner.userId,
      };
      await saveActivationRecord(actRoot, activation);

      // Race guard vs disable: re-read availability AFTER the activation
      // landed — if the owner disabled concurrently, roll back and refuse.
      if (!safeEnabled(defRoot, pipelineId)) {
        deleteActivationRecord(actRoot, projectId);
        res.status(409).json({ error: `Pipeline "${pipelineId}" was disabled concurrently`, code: 'pipeline-disabled' });
        return;
      }

      await setActivationProjections(owner, activation);
      await deps.scheduleQueue.upsertCron(schedulerIdFor(owner, projectId), def.on.schedule.cron, def.on.schedule.tz, {
        kind: 'fire',
        owner,
        pipelineId,
        pipelineScope: activation.pipelineScope,
        projectId,
        firedBy: 'cron',
      });
      const nextFireAt = nextFireOf(def);
      await publishPipelineEvent(owner, {
        cause: 'activationChanged',
        pipelineId,
        projectId,
        activation,
        activatedBy: owner.userId,
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
      const projectId = req.body?.projectId;
      if (typeof projectId !== 'string' || projectId.trim().length === 0) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      const actRoot = actRootOf(owner);
      let activation: PipelineActivation | null = null;
      let unreadable = false;
      try {
        activation = loadActivationByProject(actRoot, projectId);
      } catch {
        unreadable = true; // unreadable sidecar: deactivate clears it below
      }
      if (!unreadable) {
        if (!activation) {
          res.status(404).json({ error: `No activation on project "${projectId}"`, code: 'not-activated' });
          return;
        }
        if (activation.pipelineId !== pipelineId) {
          res.status(404).json({
            error: `Project "${projectId}" is activated with "${activation.pipelineId}", not "${pipelineId}"`,
            code: 'not-activated',
          });
          return;
        }
      }
      // Order: cron off → live run cancelled + running steps killed → SSOT
      // unlink (activation.json only — runs survive) → projections cleared.
      await deps.scheduleQueue.removeCron(schedulerIdFor(owner, projectId));
      await deps.coordinator.deactivate(owner, projectId);
      deleteActivationRecord(actRoot, projectId);
      await clearActivationProjections(owner, projectId);
      await publishPipelineEvent(owner, {
        cause: 'activationChanged',
        pipelineId,
        projectId,
        activation: null,
        activatedBy: owner.userId,
      });
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
      const projectId = req.body?.projectId;
      if (typeof projectId !== 'string' || projectId.trim().length === 0) {
        res.status(400).json({ error: 'projectId is required' });
        return;
      }
      // A run needs an activation — run-now fires the caller's own binding.
      let activation: PipelineActivation | null = null;
      try {
        activation = loadActivationByProject(actRootOf(owner), projectId);
      } catch {
        activation = null;
      }
      if (!activation || activation.pipelineId !== pipelineId) {
        res.status(409).json({
          error: `Pipeline "${pipelineId}" is not activated on project "${projectId}" — activate it first`,
          code: 'pipeline-not-activated',
        });
        return;
      }
      const existingRunId = await deps.coordinator.getActiveRunId(owner, projectId);
      if (existingRunId) {
        res.status(409).json({ error: 'A run is already live for this activation', existingRunId });
        return;
      }
      await deps.scheduleQueue.addNow({
        kind: 'fire',
        owner,
        pipelineId,
        pipelineScope: activation.pipelineScope,
        projectId,
        firedBy: 'manual',
        fireEpoch: Date.now(),
      });
      res.status(202).json({ accepted: true });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesRunNow');
    }
  });

  router.get('/:pipelineId/runs', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const pipelineId = req.params.pipelineId;
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
      if (!projectId) {
        res.status(400).json({ error: 'projectId query is required (runs are per activation)' });
        return;
      }
      let target = owner;
      if (userId && userId !== owner.userId) {
        // Read-only visibility into an org member's activation history —
        // org-scope pipelines only, live members only.
        const found = findPipelineRoot(scopeRootsOf(owner), pipelineId);
        if (!found || !found.scopeRoot.aclGoverned) {
          res.status(403).json({ error: 'Only org pipelines expose other members\' runs', code: 'org-pipeline-forbidden' });
          return;
        }
        const gate = await orgGateFor(req)();
        if (!gate.liveRole) {
          res.status(403).json({ error: 'You are not a member of this organization', code: MEMBERSHIP_REQUIRED });
          return;
        }
        target = { userId, organizationId: owner.organizationId, organizationKind: 'team' };
      }
      const targetActRoot = deriveActivationsRoot(ctxOf(target));
      const runs: PipelineRunSummary[] = readRunIndex(targetActRoot, projectId, 50, pipelineId);
      let live: PipelineRunSummary | undefined;
      const activeRunId = await deps.coordinator.getActiveRunId(target, projectId);
      if (activeRunId) {
        const run = await deps.coordinator.getRun(activeRunId);
        if (run && run.pipelineId === pipelineId && !runs.some((r) => r.runId === run.runId)) {
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
      const ctx: PipelineTenantContext = { workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(), ...owner };
      let bound: PipelineActivation | null = null;
      try {
        bound = loadActivationByProject(deriveActivationsRoot(ctx), projectId);
      } catch {
        // Unreadable sidecar: the chat lock stays engaged with what we know.
        bound = null;
      }
      if (!bound) {
        res.json({ active: null });
        return;
      }
      let name = bound.pipelineId;
      let nextFireAt: string | undefined;
      try {
        const def = loadPipeline(resolveDefRoot(ctx, bound.pipelineScope), bound.pipelineId);
        name = def.name;
        const preview = getNextFires(def.on.schedule.cron, def.on.schedule.tz, 1);
        nextFireAt = preview.ok ? preview.nextFires[0] : undefined;
      } catch {
        /* invalid def: still report the binding */
      }
      let state: ActivePipelineInfo['state'] = 'waiting';
      let currentRunId: string | undefined;
      const activeRunId = await deps.coordinator.getActiveRunId(owner, projectId);
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
