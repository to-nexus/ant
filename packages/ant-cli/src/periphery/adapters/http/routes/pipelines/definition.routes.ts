/**
 * Per-pipeline definition surface — read/download/replace/delete, the
 * availability machine (enable/disable), and org scoping (promote/
 * permissions/editors, the accountAgents mirror).
 */

import type { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { isExportablePipelineFile, MEMBERSHIP_REQUIRED, type PipelineDef } from '@ant/shared';
import { sendErrorResponse } from '../helpers/errorResponse';
import { streamDefinitionArchive } from '../helpers/definitionArchive';
import { downloadRateLimiter } from '../../middleware/rateLimiter';
import { computeOrgResourcePermissions, updateOrgPipelineAcl } from '../helpers/orgAclStore';
import { resolveLiveTeamMembership } from '../helpers/teamRole';
import { collectPipelineSaveWarnings, validatePipelineCatalogServer } from '../../../../../core/pipelines/catalogBinding';
import { pipelineDir } from '../../../../../core/pipelines/paths';
import { resolveDefRoot } from '../../../../../core/pipelines/scopeRoots';
import {
  deletePipeline,
  loadPipeline,
  saveAvailability,
  savePipeline,
  validatePipelineDefServer,
  PipelineValidationError,
} from '../../../../../core/pipelines/store';
import { ownerOf, type PipelinesRouteContext } from './context';

export function registerDefinitionRoutes(router: Router, ctx: PipelinesRouteContext): void {
  const { deps, orgGateFor, ctxOf, findViewablePipeline, findWritablePipeline, findOrgAclPipeline, refuseWhileEnabled, safeEnabled, publishPipelineEvent, nextFireOf, listActivationViews, buildListEntry } = ctx;

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

  /**
   * Definition folder export. Viewable in any scope (an org member may read a
   * shared pipeline), and the archive admits only `isExportablePipelineFile` —
   * so `owner.json`, which carries the AUTHOR's account coordinates, never
   * leaves with the download.
   */
  router.get('/:pipelineId/download', downloadRateLimiter, async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      const found = findViewablePipeline(res, owner, req.params.pipelineId);
      if (!found) return;
      await streamDefinitionArchive(res, {
        root: found.scopeRoot.root,
        dirName: req.params.pipelineId,
        admits: isExportablePipelineFile,
        stateStore: deps.stateStore,
        slotKey: `ant:slots:defzip:${owner.organizationId}:${owner.userId}`,
        component: 'PipelinesDownload',
      });
    } catch (error) {
      if (!res.headersSent) sendErrorResponse(res, 500, error, 'PipelinesDownload');
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
      const catalogWarnings = collectPipelineSaveWarnings(def, ctxOf(owner));
      res.json({
        id: pipelineId,
        entry: await buildListEntry(owner, gate, found.scopeRoot, pipelineId, def, new Map()),
        ...(catalogWarnings.length > 0 && { catalogWarnings }),
      });
    } catch (error) {
      if (error instanceof PipelineValidationError) {
        res.status(400).json({ error: error.message, errors: error.errors, code: 'invalid-pipeline-def' });
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
      let def: PipelineDef;
      try {
        def = loadPipeline(found.scopeRoot.root, pipelineId);
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : String(e), code: 'invalid-pipeline-def' });
        return;
      }
      // Publish also requires the steps to resolve against the enabler's agent
      // catalog — a typo'd ref or verdict outcome fails HERE, not at dispatch.
      const catalogErrors = validatePipelineCatalogServer(def, ctxOf(owner));
      if (catalogErrors.length > 0) {
        res.status(400).json({ error: catalogErrors[0], errors: catalogErrors, code: 'invalid-pipeline-def' });
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
}
