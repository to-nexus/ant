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
  parsePipelineYaml,
  saveAvailability,
  savePipeline,
  validatePipelineDefServer,
  PipelineValidationError,
} from '../../../../../core/pipelines/store';
import { validateBody } from '../../middleware/validateBody';
import { PipelineImportBodySchema } from '../helpers/pipelineImportSchema';
import { PIPELINE_OWNER_FILE } from '../../../../../infrastructure/scheduling/PipelineReconciler';
import { ownerOf, type PipelinesRouteContext } from './context';

export function registerCatalogRoutes(router: Router, ctx: PipelinesRouteContext): void {
  const { deps, orgGateFor, ctxOf, scopeRootsOf, actRootOf, findPipelineRoot, findWritablePipeline, refuseWhileEnabled, publishPipelineEvent, activationView, buildListEntry } = ctx;

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

  /**
   * Create in the caller's personal root as a DISABLED draft.
   *
   * Shared by `POST /` and `POST /import` so the two cannot drift on id
   * derivation, cross-scope collision, caps, or the availability default.
   * Answers the response itself — including every refusal — and returns the
   * created id, or null when it already answered.
   */
  async function createPipelineDraft(
    req: Request,
    res: Response,
    def: PipelineDef,
    suppliedId: string | undefined,
  ): Promise<{ id: string; entry: PipelineListEntry; catalogWarnings: string[] } | null> {
    const owner = ownerOf(req);
    const errors = validatePipelineDefServer(def);
    if (errors.length > 0) {
      res.status(400).json({ error: errors[0], errors, code: 'invalid-pipeline-def' });
      return null;
    }
    const scopeRoots = scopeRootsOf(owner);
    const root = derivePipelinesRoot(ctxOf(owner));
    // `id` is optional only while `def.name` has something to slug. A name
    // with no [a-z0-9] run (any non-Latin script — legitimate for a
    // user-authored definition) slugs to "", which is not an invalid id the
    // caller sent: it is an id nobody could derive. Saying so, and where the
    // field belongs, is the difference between one round trip and a guessing
    // loop — a Korean-named draft cost an LLM author two of six saves.
    const requestedId = suppliedId ?? toCustomId(def.name);
    if (!requestedId) {
      const inQuery = typeof req.query?.id === 'string' && req.query.id.length > 0;
      res.status(400).json({
        error:
          `Cannot derive a pipeline id from name "${def.name}" — it has no [a-z0-9] characters to slug. ` +
          (inQuery
            ? 'Send `id` in the request BODY (`{ id, def }`), not the query string.'
            : 'Send an explicit `id` in the request body (`{ id, def }`).'),
        code: 'pipeline-id-required',
      });
      return null;
    }
    if (!isValidCustomId(requestedId)) {
      res.status(400).json({ error: `Invalid pipeline id: "${requestedId}"`, code: 'invalid-pipeline-id' });
      return null;
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
        conflictId: requestedId,
        scope: collision.scopeRoot.scope,
      });
      return null;
    }
    const existing = listPipelines(root);
    if (existing.length >= DEFAULT_PIPELINE_CAPS.maxPipelines) {
      res.status(400).json({ error: `At most ${DEFAULT_PIPELINE_CAPS.maxPipelines} pipelines per account`, code: 'cap-exceeded' });
      return null;
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
    return {
      id: requestedId,
      entry: await buildListEntry(owner, null, userRoot, requestedId, def, new Map()),
      catalogWarnings: collectPipelineSaveWarnings(def, ctxOf(owner)),
    };
  }

  // ── Create (personal root, DISABLED draft — enable is a separate step) ──
  router.post('/', async (req: Request, res: Response) => {
    try {
      const def = req.body?.def as PipelineDef | undefined;
      if (!def) {
        res.status(400).json({ error: 'body.def (pipeline definition) is required' });
        return;
      }
      const suppliedId = typeof req.body?.id === 'string' ? req.body.id : undefined;
      const created = await createPipelineDraft(req, res, def, suppliedId);
      if (!created) return;
      res.status(201).json({
        id: created.id,
        entry: created.entry,
        ...(created.catalogWarnings.length > 0 && { catalogWarnings: created.catalogWarnings }),
      });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, code: 'invalid-pipeline-def' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesCreate');
    }
  });

  /**
   * Import a definition from an uploaded `pipeline.yaml`.
   *
   * The payload is the FILE TEXT, not a parsed def: `parsePipelineYaml` is the
   * one owner of yaml → def, and the write still goes through `savePipeline`,
   * so import gains no second write funnel and no second parser. Reserved
   * literal — registered here, ahead of every `/:pipelineId` group.
   *
   * A collision answers 409 `pipeline-exists` so the CLIENT prompts; only an
   * explicit `overwrite` replaces, and only while the pipeline is disabled
   * (the availability machine owns that, exactly as `PUT /:id` does).
   */
  router.post('/import', validateBody(PipelineImportBodySchema), async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const { yaml: text, id: suppliedId, overwrite } = req.body as {
        yaml: string;
        id?: string;
        overwrite?: boolean;
      };

      const def = parsePipelineYaml(text, suppliedId);
      const targetId = suppliedId ?? toCustomId(def.name);
      const collision = targetId ? findPipelineRoot(scopeRootsOf(owner), targetId) : null;

      if (!collision) {
        const created = await createPipelineDraft(req, res, def, suppliedId);
        if (!created) return;
        res.status(201).json({
          id: created.id,
          entry: created.entry,
          created: true,
          ...(created.catalogWarnings.length > 0 && { catalogWarnings: created.catalogWarnings }),
        });
        return;
      }

      if (!overwrite) {
        res.status(409).json({
          error:
            collision.scopeRoot.scope === 'org'
              ? `Pipeline id "${targetId}" is taken by an org pipeline — rename the folder`
              : `Pipeline "${targetId}" already exists`,
          code: 'pipeline-exists',
          conflictId: targetId,
          scope: collision.scopeRoot.scope,
        });
        return;
      }

      const found = await findWritablePipeline(res, req, owner, targetId);
      if (!found) return;
      // Availability machine: editable only while disabled — an import must
      // not be a back door around what `PUT /:id` refuses.
      if (refuseWhileEnabled(res, found.scopeRoot.root, targetId, 'editing')) return;
      await savePipeline(found.scopeRoot.root, targetId, def);
      await publishPipelineEvent(owner, { cause: 'defChanged', pipelineId: targetId });
      const gate = found.scopeRoot.aclGoverned ? await orgGateFor(req)() : null;
      const catalogWarnings = collectPipelineSaveWarnings(def, ctxOf(owner));
      res.json({
        id: targetId,
        entry: await buildListEntry(owner, gate, found.scopeRoot, targetId, def, new Map()),
        created: false,
        ...(catalogWarnings.length > 0 && { catalogWarnings }),
      });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, code: 'invalid-pipeline-def' });
        return;
      }
      sendErrorResponse(res, 500, error, 'PipelinesImport');
    }
  });
}
