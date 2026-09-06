/**
 * Pipeline catalog — list (with orphan-activation detection) and create
 * (personal root, DISABLED draft).
 */

import type { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  toCustomId,
  isValidCustomId,
  DEFAULT_PIPELINE_CAPS,
  type PipelineActivationView,
  type PipelineDef,
  type PipelineListEntry,
  type PipelineScope,
} from '@ant/shared';
import { sendErrorResponse } from '../helpers/errorResponse';
import { collectPipelineSaveWarnings } from '../../../../../core/pipelines/catalogBinding';
import { derivePipelinesRoot, pipelineDir } from '../../../../../core/pipelines/paths';
import {
  listAccountActivations,
  listPipelines,
  saveAvailability,
  savePipeline,
  validatePipelineDefServer,
  PipelineValidationError,
} from '../../../../../core/pipelines/store';
import { PIPELINE_OWNER_FILE } from '../../../../../infrastructure/scheduling/PipelineReconciler';
import { ownerOf, type PipelinesRouteContext } from './context';

export function registerCatalogRoutes(router: Router, ctx: PipelinesRouteContext): void {
  const { deps, orgGateFor, ctxOf, scopeRootsOf, actRootOf, findPipelineRoot, publishPipelineEvent, activationView, buildListEntry } = ctx;

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
      // Advisory, never blocking: a draft may reference agents not authored
      // yet. Enable/activate are where the same findings hard-fail.
      const catalogWarnings = collectPipelineSaveWarnings(def, ctxOf(owner));
      res.status(201).json({
        id: requestedId,
        entry: await buildListEntry(owner, null, userRoot, requestedId, def, new Map()),
        ...(catalogWarnings.length > 0 && { catalogWarnings }),
      });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, code: 'invalid-pipeline-def' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesCreate');
    }
  });
}
