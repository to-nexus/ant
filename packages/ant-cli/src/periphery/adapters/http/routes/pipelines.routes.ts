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
import { activationStateOf, type ActivePipelineInfo, type PipelineActivation } from '@ant/shared';
import { sendErrorResponse } from './helpers/errorResponse';
import { getNextFires } from '../../../../core/pipelines/cron';
import type { PipelineTenantContext } from '../../../../core/pipelines/paths';
import { resolveDefRoot } from '../../../../core/pipelines/scopeRoots';
import { loadPipeline } from '../../../../core/pipelines/store';
import { resolveActivation } from '../../../../infrastructure/scheduling/resolveActivation';
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
      // Disk record, else the projection — a just-written activation must lock
      // the chat even from a pod whose NFS view has not caught up.
      const bound: PipelineActivation | null = (await resolveActivation(deps.stateStore, ctx.workspacesPath, owner, projectId)).activation;
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
      const liveRuns = await deps.coordinator.listLiveRuns(owner, projectId);
      const active: ActivePipelineInfo = {
        pipelineId: bound.pipelineId,
        pipelineName: name,
        state: activationStateOf(liveRuns),
        ...(nextFireAt && { nextFireAt }),
        liveRuns,
      };
      res.json({ active });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'ActivePipeline');
    }
  });

  return router;
}
