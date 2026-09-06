/**
 * Pipeline CRUD + availability + activation + run surface.
 *
 * Definitions are scoped TEMPLATES (`/api/definitions/pipelines`, the agents
 * family): personal + org scope
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
import type { ActivePipelineInfo, PipelineActivation } from '@ant/shared';
import { sendErrorResponse } from './helpers/errorResponse';
import { getNextFires } from '../../../../core/pipelines/cron';
import { deriveActivationsRoot, type PipelineTenantContext } from '../../../../core/pipelines/paths';
import { resolveDefRoot } from '../../../../core/pipelines/scopeRoots';
import { loadActivationByProject, loadPipeline } from '../../../../core/pipelines/store';
import {
  buildPipelinesRouteContext,
  isSingleSegment,
  ownerOf,
  reject400,
  type PipelinesRoutesDeps,
} from './pipelines/context';
import { registerCatalogRoutes } from './pipelines/catalog.routes';
import { registerPlanningRoutes } from './pipelines/planning.routes';
import { registerApprovalRoutes } from './pipelines/approvals.routes';
import { registerRunRoutes } from './pipelines/runs.routes';
import { registerDefinitionRoutes } from './pipelines/definition.routes';
import { registerActivationRoutes } from './pipelines/activations.routes';

export type { PipelinesRoutesDeps } from './pipelines/context';

export function createPipelinesRoutes(deps: PipelinesRoutesDeps): Router {
  const router = Router();
  const ctx = buildPipelinesRouteContext(deps);

  // Registration ORDER is load-bearing: the literal route groups (preview-fires,
  // activatable-projects, approvals/*, runs/*) must register before the
  // `/:pipelineId` groups so a reserved literal never matches as an id.
  registerCatalogRoutes(router, ctx);
  registerPlanningRoutes(router, ctx);
  registerApprovalRoutes(router, ctx);
  registerRunRoutes(router, ctx);
  registerDefinitionRoutes(router, ctx);
  registerActivationRoutes(router, ctx);

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
      if (!isSingleSegment(projectId)) return void reject400(res, 'projectId');
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
        if (def.on?.schedule) {
          const preview = getNextFires(def.on.schedule.cron, def.on.schedule.tz, 1);
          nextFireAt = preview.ok ? preview.nextFires[0] : undefined;
        }
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
