/**
 * Activations — the scheduling unit, keyed by projectId in the CALLER's
 * account — plus run-now and the per-activation run history.
 */

import type { Router, Request, Response } from 'express';
import {
  isApprovalStep,
  MEMBERSHIP_REQUIRED,
  UNIVERSAL_FEATURE,
  validatePipelineActivation,
  parsePipelineDuration,
  type PipelineActivation,
  type PipelineDef,
  resolveRunConcurrency,
  runSummaryOf,
  type PipelineRunSummary,
} from '@ant/shared';
import { approverUnion, syncApproverIndexForActivation } from '../../../../../core/pipelines/approverIndex';
import { extractUserContext } from '../helpers/userContext';
import { sendErrorResponse } from '../helpers/errorResponse';
import { validatePipelineCatalogServer } from '../../../../../core/pipelines/catalogBinding';
import { deriveActivationsRoot } from '../../../../../core/pipelines/paths';
import {
  deleteActivationRecord,
  loadActivationByProject,
  loadPipeline,
  readRunIndex,
  saveActivationRecord,
  PipelineValidationError,
} from '../../../../../core/pipelines/store';
import { resolveDefRoot } from '../../../../../core/pipelines/scopeRoots';
import { findDuplicateActiveJob } from '../../../../../core/scheduling/UniversalDispatchGate';
import { fetchSchedulerIdFor, schedulerIdFor } from '../../../../../infrastructure/scheduling/PipelineReconciler';
import { ensureItemLedger } from '../../../../../infrastructure/scheduling/pipelineRun/itemLedger';
import { deactivatePipelineBinding } from '../../../../../infrastructure/scheduling/deactivateBinding';
import { isSingleSegment, reject400 } from './context';
import { ownerOf, type PipelinesRouteContext } from './context';

export function registerActivationRoutes(router: Router, ctx: PipelinesRouteContext): void {
  const { deps, orgGateFor, ctxOf, scopeRootsOf, actRootOf, findPipelineRoot, findViewablePipeline, safeEnabled, publishPipelineEvent, nextFireOf, setActivationProjections, listActivationViews } = ctx;

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
        def.on?.fetch,
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
      if (!isSingleSegment(projectId)) return void reject400(res, 'projectId');
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
      // The ACTIVATOR's catalog is what dispatch resolves against — re-judge
      // it here (the enabler's catalog may differ, or agents were deleted).
      const catalogErrors = validatePipelineCatalogServer(def, ctxOf(owner));
      if (catalogErrors.length > 0) {
        res.status(400).json({ error: catalogErrors[0], errors: catalogErrors, code: 'invalid-pipeline-def' });
        return;
      }

      // Gate 0 — availability: only an enabled (published) pipeline activates.
      if (!safeEnabled(defRoot, pipelineId)) {
        res.status(409).json({ error: `Pipeline "${pipelineId}" is disabled — enable it first`, code: 'pipeline-disabled' });
        return;
      }

      // Gate 1 — the target must be a universal project.
      const { isUniversalProject } = await import('../../../../../core/customAgents/universalContainer');
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

      // Per-gate approver roster (optional). Keys are validated against the
      // def's approval-step ids; every member must be a live org member.
      const rawApprovers = req.body?.approvers;
      let approvers: Record<string, string[]> | undefined;
      if (rawApprovers !== undefined && rawApprovers !== null) {
        if (typeof rawApprovers !== 'object' || Array.isArray(rawApprovers)) {
          res.status(400).json({ error: 'approvers must be a map of { <gateStepId>: [memberId, …] }' });
          return;
        }
        approvers = Object.fromEntries(
          Object.entries(rawApprovers as Record<string, string[]>).filter(
            ([, list]) => Array.isArray(list) && list.length > 0,
          ),
        );
        if (Object.keys(approvers).length === 0) approvers = undefined;
      }
      if (approvers && owner.organizationKind !== 'team') {
        res.status(400).json({ error: 'Gate approvers need a team organization', code: 'approvers-require-team-org' });
        return;
      }
      if (approvers) {
        const gateStepIds = def.steps.filter(isApprovalStep).map((s) => s.id);
        const approverErrors = validatePipelineActivation(
          { pipelineId, pipelineScope: found.scopeRoot.scope, projectId, activatedAt: new Date().toISOString(), approvers },
          { gateStepIds },
        );
        if (approverErrors.length > 0) {
          res.status(400).json({ error: approverErrors[0], errors: approverErrors, code: 'invalid-approvers' });
          return;
        }
        const dead: string[] = [];
        for (const userId of [...new Set(Object.values(approvers).flat())]) {
          const membership = await deps.organizationRepository.getMembership(userId, owner.organizationId);
          if (!membership) dead.push(userId);
        }
        if (dead.length > 0) {
          res.status(400).json({
            error: `Not a member of this organization: ${dead.join(', ')}`,
            code: 'approver-not-member',
            invalidApprovers: dead,
          });
          return;
        }
      }

      const activation: PipelineActivation = holder
        ? { ...holder, ...(approvers ? { approvers } : {}) }
        : {
            pipelineId,
            pipelineScope: found.scopeRoot.scope,
            projectId,
            activatedAt: new Date().toISOString(),
            activatedBy: owner.userId,
            ...(approvers ? { approvers } : {}),
          };
      await saveActivationRecord(actRoot, activation);
      await syncApproverIndexForActivation(
        deps.stateStore,
        owner.organizationId,
        owner.userId,
        projectId,
        approverUnion(holder),
        approverUnion(activation),
      );

      // Race guard vs disable: re-read availability AFTER the activation
      // landed — if the owner disabled concurrently, roll back and refuse.
      if (!safeEnabled(defRoot, pipelineId)) {
        deleteActivationRecord(actRoot, projectId);
        res.status(409).json({ error: `Pipeline "${pipelineId}" was disabled concurrently`, code: 'pipeline-disabled' });
        return;
      }

      await setActivationProjections(owner, activation);
      // Manual-only pipelines register no scheduler — run-now is their only
      // fire source; the projections above still arm the exclusion gate.
      if (def.on?.schedule) {
        await deps.scheduleQueue.upsertCron(schedulerIdFor(owner, projectId), def.on.schedule.cron, def.on.schedule.tz, {
          kind: 'fire',
          owner,
          pipelineId,
          pipelineScope: activation.pipelineScope,
          projectId,
          firedBy: 'cron',
        });
      }
      // A fetch activation polls on its own `every` scheduler; the claim
      // projection is rebuilt from the (possibly pre-existing) disk ledger so
      // a re-activation never re-fires cases that already ran.
      if (def.on?.fetch) {
        const everyMs = parsePipelineDuration(def.on.fetch.every);
        if (everyMs) {
          await deps.scheduleQueue.upsertEvery(fetchSchedulerIdFor(owner, projectId), everyMs, {
            kind: 'fetch-poll',
            owner,
            pipelineId,
            pipelineScope: activation.pipelineScope,
            projectId,
          });
        }
        await ensureItemLedger(deps.stateStore, actRoot, owner, projectId, pipelineId).catch(() => false);
      }
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
      if (!isSingleSegment(projectId)) return void reject400(res, 'projectId');
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
      // Legs live in `deactivatePipelineBinding` — the ONE deactivation
      // authority, shared with the project delete/rename cascade.
      await deactivatePipelineBinding(
        {
          workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(),
          scheduleQueue: deps.scheduleQueue,
          coordinator: deps.coordinator,
          stateStore: deps.stateStore,
        },
        owner,
        projectId,
        { pipelineIdHint: pipelineId },
      );
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
      if (!isSingleSegment(projectId)) return void reject400(res, 'projectId');
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
      // Admission is the fire path's slot cap (the definition's `concurrency`);
      // this is the early, readable refusal for the button — only when the
      // activation is at cap, so a burst of Run now starts N independent runs.
      // `existingRunId` stays one release for API callers.
      let cap = 1;
      let def: PipelineDef | null = null;
      try {
        def = loadPipeline(resolveDefRoot(ctxOf(owner), activation.pipelineScope), pipelineId);
        cap = resolveRunConcurrency(def);
      } catch {
        /* unresolvable def: the fire path skips; refuse at the default cap */
      }
      // Run-now on a FETCH activation is Poll-now: the poll admits items up to
      // the room under `concurrency` itself, so there is no cap refusal here.
      if (def?.on?.fetch) {
        await deps.scheduleQueue.addNow({
          kind: 'fetch-poll',
          owner,
          pipelineId,
          pipelineScope: activation.pipelineScope,
          projectId,
          manual: true,
        });
        res.status(202).json({ accepted: true, polled: true });
        return;
      }
      const existingRunIds = await deps.coordinator.listActiveRunIds(owner, projectId);
      if (existingRunIds.length >= cap) {
        res.status(409).json({
          error: cap > 1 ? `This activation already holds ${existingRunIds.length} live runs (concurrency ${cap})` : 'A run is already live for this activation',
          existingRunIds,
          existingRunId: existingRunIds[0],
          concurrency: cap,
        });
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
      if (!isSingleSegment(projectId)) return void reject400(res, 'projectId');
      let target = owner;
      if (userId && userId !== owner.userId) {
        // Read-only visibility into an org member's activation history —
        // org-scope pipelines only, live members only.
        if (!isSingleSegment(userId)) return void reject400(res, 'userId');
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
        // M-025: the target userId whose activation tree we are about to read
        // must itself be a live member of the caller's org — the caller's own
        // role is not authority over an arbitrary target's directory.
        const targetMembership = await deps.organizationRepository.getMembership(userId, owner.organizationId);
        if (!targetMembership) {
          res.status(403).json({ error: `"${userId}" is not a member of this organization`, code: MEMBERSHIP_REQUIRED });
          return;
        }
        target = { userId, organizationId: owner.organizationId, organizationKind: 'team' };
      }
      const targetActRoot = deriveActivationsRoot(ctxOf(target));
      const runs: PipelineRunSummary[] = readRunIndex(targetActRoot, projectId, 50, pipelineId);
      // Live runs ride ahead of the sealed index — every one of them, newest first.
      const live: PipelineRunSummary[] = [];
      for (const { runId } of await deps.coordinator.listLiveRuns(target, projectId)) {
        const run = await deps.coordinator.getRun(runId);
        if (run && run.pipelineId === pipelineId && !runs.some((r) => r.runId === run.runId)) live.push(runSummaryOf(run));
      }
      res.json({ runs: [...live, ...runs] });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesRuns');
    }
  });
}
