/**
 * Editor round-trips — cron preview (the FE never computes fire times) and
 * the activatable-project listing (universal projects only).
 */

import type { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { validatePipelineFetchTrigger, type PipelineFetchTrigger } from '@ant/shared';
import { extractUserContext } from '../helpers/userContext';
import { sendErrorResponse } from '../helpers/errorResponse';
import { jobExecuteRateLimiter } from '../../middleware/rateLimiter';
import { REDIS_KEYS } from '../../../../../core/constants/redis';
import { getNextFires, checkMinInterval } from '../../../../../core/pipelines/cron';
import { pollFetchSource } from '../../../../../core/pipelines/fetchConnection';
import { listAccountActivations, loadActivationByProject } from '../../../../../core/pipelines/store';
import { isSingleSegment, ownerOf, reject400, type PipelinesRouteContext } from './context';

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

  // ── Fetch preview — the editor's "what would a poll see" round-trip ──
  // A dry run with the CALLER's credentials: no claim, no fire, `claimed` per
  // item when a projectId names one of the caller's activations — judged in
  // the ledger of the pipeline being edited (`pipelineId`, else the project's
  // activated one), since claims are namespaced per pipeline. An
  // authenticated egress on a caller-composed request, so it is rate-limited
  // and refused to the self-api pin (a job must not turn the owner's secrets
  // into a proxy).
  router.post('/preview-fetch', jobExecuteRateLimiter, async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const raw = req.body?.fetch;
      const errors = validatePipelineFetchTrigger(raw);
      if (errors.length > 0) {
        res.status(400).json({ error: errors[0], errors, code: 'invalid-fetch-trigger' });
        return;
      }
      const projectId = req.body?.projectId;
      if (projectId !== undefined && !isSingleSegment(projectId)) return void reject400(res, 'projectId');
      const pipelineIdRaw = req.body?.pipelineId;
      if (pipelineIdRaw !== undefined && !isSingleSegment(pipelineIdRaw)) return void reject400(res, 'pipelineId');
      if (!deps.credentialResolverFor) {
        res.status(503).json({ error: 'credential store unavailable in this process', code: 'credentials-unavailable' });
        return;
      }
      const trigger = raw as PipelineFetchTrigger;
      const outcome = await pollFetchSource(
        { tenant: ctx.ctxOf(owner), credentialResolver: deps.credentialResolverFor(owner) },
        trigger,
      );
      if (!outcome.ok) {
        res.json({ ok: false, error: outcome.error, items: [], seen: 0, skipped: 0 });
        return;
      }
      let ledgerPipelineId: string | undefined = pipelineIdRaw;
      if (projectId && !ledgerPipelineId) {
        try {
          ledgerPipelineId = loadActivationByProject(actRootOf(owner), projectId)?.pipelineId;
        } catch {
          ledgerPipelineId = undefined; // unreadable sidecar — no ledger to judge against
        }
      }
      const items = [];
      for (const item of outcome.extracted.items) {
        const claimed =
          projectId && ledgerPipelineId
            ? await deps.stateStore.exists(REDIS_KEYS.PIPE.ITEM(owner.organizationId, owner.userId, projectId, ledgerPipelineId, item.key)).catch(() => false)
            : false;
        items.push({ ...item, claimed });
      }
      res.json({ ok: true, items, seen: outcome.extracted.seen, skipped: outcome.extracted.skipped });
    } catch (error) {
      sendErrorResponse(res, 500, error, 'PipelinesPreviewFetch');
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
