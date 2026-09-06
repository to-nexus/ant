/**
 * Editor round-trips — cron preview (the FE never computes fire times) and
 * the activatable-project listing (universal projects only).
 */

import type { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { extractUserContext } from '../helpers/userContext';
import { sendErrorResponse } from '../helpers/errorResponse';
import { getNextFires, checkMinInterval } from '../../../../../core/pipelines/cron';
import { listAccountActivations } from '../../../../../core/pipelines/store';
import { ownerOf, type PipelinesRouteContext } from './context';

export function registerPlanningRoutes(router: Router, ctx: PipelinesRouteContext): void {
  const { deps, actRootOf } = ctx;

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
      const { isUniversalProject } = await import('../../../../../core/customAgents/universalContainer');
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
}
