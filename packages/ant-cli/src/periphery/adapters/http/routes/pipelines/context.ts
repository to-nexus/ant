/**
 * Shared context for the pipelines route group modules — the deps surface and
 * the closure helpers every group uses (scope-root resolution, org-ACL gates,
 * the availability machine's refusals, activation views, list entries).
 */

import { Request, Response } from 'express';
import {
  isValidCustomId,
  type PipelineActivation,
  type PipelineActivationView,
  type PipelineDef,
  type PipelineListEntry,
  type PipelineScope,
} from '@ant/shared';
import { extractUserContext } from '../helpers/userContext';
import { assertPathSegment } from '../../../../../core/config/pathContainment';
import {
  canEditOrgResource,
  computeOrgResourcePermissions,
  createOrgGateResolver,
  readOrgPipelineAcl,
  type OrgResourceGate,
} from '../helpers/orgAclStore';
import { getNextFires } from '../../../../../core/pipelines/cron';
import { deriveActivationsRoot, type PipelineTenantContext } from '../../../../../core/pipelines/paths';
import {
  derivePipelineScopeRootsForTenant,
  type PipelineScopeRoot,
} from '../../../../../core/pipelines/scopeRoots';
import {
  findActivationsForPipeline,
  listAccountActivations,
  loadAvailability,
  pipelineExists,
  readRunIndex,
} from '../../../../../core/pipelines/store';
import type { OrganizationRepositoryPort } from '../../../../../core/ports/organizationRepository';
import type { ScheduleQueuePort, PipelineOwner } from '../../../../../core/ports/scheduler';
import type { PipelineRunCoordinator } from '../../../../../infrastructure/scheduling/PipelineRunCoordinator';
import { REDIS_KEYS, REDIS_TTL } from '../../../../../core/constants/redis';
import { getRealtimeBroadcastChannel } from '../../../../../infrastructure/state/redisConstants';
import type { StateStorePort } from '../../../../../core/ports/stateStore';

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

export function ownerOf(req: Request): PipelineOwner {
  const uc = extractUserContext(req);
  return {
    userId: uc.userId,
    organizationId: uc.organizationId,
    organizationKind: (uc as any).organizationKind ?? 'local',
  };
}

/**
 * Reject a caller-supplied identifier that is not a single path segment with a
 * clean 400, before it reaches an activation path helper. The helpers throw on
 * the same values (final boundary), but a route-level check turns the traversal
 * attempt into a 400 rather than a 500 and stops disk reads from being attempted
 * at all (H-016, M-025).
 */
export function isSingleSegment(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    assertPathSegment('id', value);
    return true;
  } catch {
    return false;
  }
}

export function reject400(res: Response, field: string): null {
  res.status(400).json({ error: `Invalid ${field}` });
  return null;
}

export type PipelinesRouteContext = ReturnType<typeof buildPipelinesRouteContext>;

export function buildPipelinesRouteContext(deps: PipelinesRoutesDeps) {
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
    if (!def.on?.schedule) return undefined; // manual-only — no scheduled fire
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
      // Org-visible by design: who opens which gate is never hidden.
      ...(activation.approvers && { approvers: activation.approvers }),
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
      ...(def.on?.schedule && { cron: def.on.schedule.cron, tz: def.on.schedule.tz }),
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

  return {
    deps,
    orgGateFor,
    ctxOf,
    scopeRootsOf,
    actRootOf,
    findPipelineRoot,
    findViewablePipeline,
    findWritablePipeline,
    findOrgAclPipeline,
    refuseWhileEnabled,
    safeEnabled,
    publishPipelineEvent,
    nextFireOf,
    setActivationProjections,
    activationView,
    listActivationViews,
    buildListEntry,
  };
}
