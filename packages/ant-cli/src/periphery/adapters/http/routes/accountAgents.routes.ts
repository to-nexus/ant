/**
 * Scoped agent-definition API (`/api/definitions/agents`).
 *
 * The agent settings screen opens from the profile menu WITHOUT a selected
 * project (D-G), so these routes derive the scope roots from the account's
 * user dir (`getWorkspacePath(userContext)`) — never from a projectId. CRUD
 * semantics are shared with the project-scoped mount via
 * `helpers/customAgentHandlers.ts` (single implementation, no drift).
 *
 * Definition files are code-exterior data: every write goes through ONE
 * funnel (PUT /:agentId/file) — whitelist + YAML-syntax + id≡dirname gates
 * refuse with 400 before writing; semantic errors (loadCustomJob dry-run)
 * save AND return `validation.errors` as warnings.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { boundedMultipartUpload } from '../middleware/boundedMultipart';
import {
  CUSTOM_ID_HINT,
  GENERAL_INTENT,
  MEMBERSHIP_REQUIRED,
  isValidCustomId,
  type CustomJobPromptPreview,
} from '@ant/shared';
import { CUSTOM_AGENTS_DIRNAME } from '../../../../core/customAgents/scopeRoots';
import {
  discoverAgents,
  findAgentRoot,
  findCreateCollision,
  loadCustomJob,
  type CustomAgentScopeRoot,
} from '../../../../core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../../../core/customAgents/types';
import { validateDefinitionSave } from '../../../../core/customAgents/definitionGate';
import { buildCustomJobSystemBlock } from '../../../../core/customAgents/promptBlock';
import { moveUniversalAgentData, moveUniversalJobData } from '../../../../core/customAgents/universalContainer';
import { MUTATING_BUILTIN_TOOLS, UNIVERSAL_BUILTIN_TOOLS } from '../../../../core/customAgents/universalToolPolicy';
import { TEMPLATE_PATHS } from '../../../../core/prompt/builder/templatePaths';
import {
  createCollisionMessage,
  decorateOrgAgentSummaries,
  findWritableAgent,
  patchYamlFile,
  scaffoldAgent,
  scaffoldJob,
  writeDefinitionUpload,
} from './helpers/customAgentHandlers';
import { computeOrgResourcePermissions, updateOrgAgentAcl } from './helpers/orgAclStore';
import { resolveLiveTeamMembership } from './helpers/teamRole';
import { extractUserContext } from './helpers/userContext';
import {
  buildAccountAgentsRouteContext,
  type AccountAgentsRoutesDeps,
} from './accountAgents/context';
import { registerDefinitionFileRoutes } from './accountAgents/definitionFiles.routes';
import { agentIdOfWrite, attachAgentDefinitionChangeBroadcast } from './helpers/agentDefinitionEvents';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';
import { UPLOAD_LIMITS } from '../../../../core/config/uploadLimits';

/** First-segment literals on this mount that are routes, not agent ids. */
const ACCOUNT_MOUNT_RESERVED: ReadonlySet<string> = new Set(['import']);

export function createAccountAgentRoutes(deps: AccountAgentsRoutesDeps): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: UPLOAD_LIMITS });
  const ctx = buildAccountAgentsRouteContext(deps);
  const { scopeRootsFor, orgGateFor, creationRoot, findViewableAgent } = ctx;

  // Every mutating request on this mount is a definition write (`POST /`,
  // `/:agentId/**`, `/import`) — the composer graft and the settings rail
  // refresh on the resulting `agentDefinition` hint. Attached before the
  // routes so the file sub-router is covered too.
  attachAgentDefinitionChangeBroadcast(router, {
    stateStore: deps.stateStore,
    match: (req) => ({ agentId: agentIdOfWrite(req, req.path.split('/')[1], ACCOUNT_MOUNT_RESERVED) }),
  });

  // ── listing ─────────────────────────────────────────────────────────────

  router.get('/', async (req: Request, res: Response) => {
    try {
      const scopeRoots = scopeRootsFor(req);
      let agents = discoverAgents(scopeRoots);
      // Team callers get per-caller org permissions: `readonly` becomes the
      // caller's effective authority, `org` carries the projection.
      if (extractUserContext(req).organizationKind === 'team') {
        agents = decorateOrgAgentSummaries(agents, scopeRoots, await orgGateFor(req)());
      }
      // builtinToolPreset supplies the settings form's tool-checkbox
      // vocabulary from the runtime SSOT — never hardcoded in the FE.
      // mutatingBuiltinTools marks the tools whose approval defaults to
      // 'always' so the approval editor can label them without hardcoding.
      res.json({
        agents,
        builtinToolPreset: UNIVERSAL_BUILTIN_TOOLS,
        mutatingBuiltinTools: MUTATING_BUILTIN_TOOLS,
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // ── agent / job CRUD (mirrors the project-scoped mount) ─────────────────

  router.post('/', (req: Request, res: Response) => {
    try {
      // `description` from older FE builds is accepted-and-dropped — the
      // agent.yaml schema no longer carries it.
      const { id, name } = req.body ?? {};
      if (!isValidCustomId(id ?? '')) {
        return res.status(400).json({ error: `Agent id must be ${CUSTOM_ID_HINT} (got: ${String(id)})` });
      }
      const scopeRoots = scopeRootsFor(req);
      const collision = findCreateCollision(scopeRoots, id);
      if (collision) {
        return res.status(409).json({ error: createCollisionMessage(id, collision) });
      }
      const root = creationRoot(scopeRoots);
      const agentDir = path.join(root.root, id);
      scaffoldAgent(agentDir, id, name || id);
      logger.info(`Custom agent scaffolded: ${id} (scope: user)`, { component: 'AccountAgents' });
      res.status(201).json({ id, name: name || id, scope: 'user', readonly: false, jobs: [] });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.patch('/:agentId', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const { name } = req.body ?? {};
      patchYamlFile(path.join(found.agentDir, 'agent.yaml'), { name });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  /**
   * Change an agent's id — the id IS the definition directory name, so this
   * moves that directory AND the container data keyed by it in every universal
   * project of the account (`sessions/{agentId}`, `artifacts/plan/{agentId}`).
   * Leaving those behind would silently reset the agent's memory everywhere.
   *
   * Every destination is checked before anything moves, so a refusal leaves the
   * account exactly as it was. Known gap (shared with DELETE /:agentId): a job
   * already running under the old id finishes writing to the old paths.
   */
  router.post('/:agentId/rename', async (req: Request, res: Response) => {
    try {
      const scopeRoots = scopeRootsFor(req);
      const found = await findWritableAgent(res, scopeRoots, req.params.agentId, orgGateFor(req));
      if (!found) return;
      const { id: newId } = req.body ?? {};
      if (!isValidCustomId(newId ?? '')) {
        return res.status(400).json({ error: `Agent id must be ${CUSTOM_ID_HINT} (got: ${String(newId)})` });
      }
      if (newId === req.params.agentId) return res.json({ id: newId, movedProjects: [] });

      const collision = findCreateCollision(scopeRoots, newId);
      if (collision) {
        return res.status(409).json({ error: createCollisionMessage(newId, collision) });
      }

      const workspacePath = deps.workspaceResolver.getWorkspacePath(extractUserContext(req));
      const { conflicts } = moveUniversalAgentData(workspacePath, req.params.agentId, newId, { dryRun: true });
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: `Workspace data for "${newId}" already exists — nothing was moved`,
          conflicts,
        });
      }

      const newDir = path.join(found.scopeRoot.root, newId);
      fs.renameSync(found.agentDir, newDir);
      patchYamlFile(path.join(newDir, 'agent.yaml'), { id: newId });
      const { movedProjects } = moveUniversalAgentData(workspacePath, req.params.agentId, newId);
      // Org agents: the ACL entry is keyed by agent id — move it with the dir.
      if (found.scopeRoot.aclGoverned) {
        const userContext = extractUserContext(req);
        await updateOrgAgentAcl(
          deps.workspaceResolver.getPhysicalWorkspacesPath(),
          userContext.organizationId,
          (records) => {
            const entry = records[req.params.agentId];
            if (entry) {
              delete records[req.params.agentId];
              records[newId] = entry;
            }
          },
        );
      }

      logger.info(
        `Custom agent renamed: ${req.params.agentId} → ${newId} (workspace data moved in ${movedProjects.length} project(s))`,
        { component: 'AccountAgents' },
      );
      res.json({ id: newId, movedProjects });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.delete('/:agentId', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      fs.rmSync(found.agentDir, { recursive: true, force: true });
      if (found.scopeRoot.aclGoverned) {
        const userContext = extractUserContext(req);
        await updateOrgAgentAcl(
          deps.workspaceResolver.getPhysicalWorkspacesPath(),
          userContext.organizationId,
          (records) => {
            delete records[req.params.agentId];
          },
        );
      }
      logger.info(`Custom agent deleted: ${req.params.agentId}`, { component: 'AccountAgents' });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/jobs', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      // `description` from older FE builds is accepted-and-dropped — the
      // job.yaml schema no longer carries it (mirrors agent.yaml).
      const { id, name } = req.body ?? {};
      if (!isValidCustomId(id ?? '')) {
        return res.status(400).json({ error: `Job id must be ${CUSTOM_ID_HINT} (got: ${String(id)})` });
      }
      const jobDir = path.join(found.agentDir, 'jobs', id);
      if (fs.existsSync(jobDir)) {
        return res.status(409).json({ error: `Custom job already exists: ${req.params.agentId}/${id}` });
      }
      scaffoldJob(jobDir, id, name || id);
      res.status(201).json({ id, name: name || id });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.patch('/:agentId/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const jobYaml = path.join(found.agentDir, 'jobs', req.params.jobId, 'job.yaml');
      if (!isValidCustomId(req.params.jobId) || !fs.existsSync(jobYaml)) {
        return res.status(404).json({ error: `Custom job not found: ${req.params.agentId}/${req.params.jobId}` });
      }
      const { name } = req.body ?? {};
      patchYamlFile(jobYaml, { name });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  /**
   * Change a job's id — symmetric with `POST /:agentId/rename`. The id is the
   * job directory name AND keys the per-job container data
   * (`sessions/{agentId}/{jobId}.json`, `artifacts/plan/{agentId}/{jobId}`) in
   * every universal project of the account, so the same dry-run-then-move
   * contract applies: any occupied destination refuses before anything moves.
   */
  router.post('/:agentId/jobs/:jobId/rename', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const oldJobId = req.params.jobId;
      const jobDir = path.join(found.agentDir, 'jobs', oldJobId);
      if (!isValidCustomId(oldJobId) || !fs.existsSync(jobDir)) {
        return res.status(404).json({ error: `Custom job not found: ${req.params.agentId}/${oldJobId}` });
      }
      const { id: newId } = req.body ?? {};
      if (!isValidCustomId(newId ?? '')) {
        return res.status(400).json({ error: `Job id must be ${CUSTOM_ID_HINT} (got: ${String(newId)})` });
      }
      if (newId === oldJobId) return res.json({ id: newId, movedProjects: [] });

      const newDir = path.join(found.agentDir, 'jobs', newId);
      if (fs.existsSync(newDir)) {
        return res.status(409).json({ error: `Custom job already exists: ${req.params.agentId}/${newId}` });
      }

      const workspacePath = deps.workspaceResolver.getWorkspacePath(extractUserContext(req));
      const { conflicts } = moveUniversalJobData(workspacePath, req.params.agentId, oldJobId, newId, { dryRun: true });
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: `Workspace data for "${req.params.agentId}/${newId}" already exists — nothing was moved`,
          conflicts,
        });
      }

      fs.renameSync(jobDir, newDir);
      patchYamlFile(path.join(newDir, 'job.yaml'), { id: newId });
      const { movedProjects } = moveUniversalJobData(workspacePath, req.params.agentId, oldJobId, newId);

      logger.info(
        `Custom job renamed: ${req.params.agentId}/${oldJobId} → ${newId} (workspace data moved in ${movedProjects.length} project(s))`,
        { component: 'AccountAgents' },
      );
      res.json({ id: newId, movedProjects });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.delete('/:agentId/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const jobDir = path.join(found.agentDir, 'jobs', req.params.jobId);
      if (!isValidCustomId(req.params.jobId) || !fs.existsSync(jobDir)) {
        return res.status(404).json({ error: `Custom job not found: ${req.params.agentId}/${req.params.jobId}` });
      }
      fs.rmSync(jobDir, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // ── org promotion + per-agent org permissions (org-owned agents) ─────────

  /**
   * Promote a personal agent into the active TEAM org — a MOVE (not a copy)
   * of the definition dir into `{ws}/{orgId}/.ant/agents/`, recording the
   * caller as the agent owner in the org ACL. Runtime container data stays
   * put: sessions/plans are keyed by agentId under each project and the id
   * does not change. Any live member may promote (no approval workflow).
   */
  router.post('/:agentId/promote', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      if (userContext.organizationKind !== 'team') {
        return res.status(400).json({
          error: 'Promotion requires an active team organization',
          code: 'not-team-active',
        });
      }
      const membership = await resolveLiveTeamMembership(
        deps.organizationRepository,
        userContext.userId,
        userContext.organizationId,
      );
      if (!membership) {
        return res.status(403).json({
          error: 'You are not a member of this organization.',
          code: MEMBERSHIP_REQUIRED,
        });
      }
      const agentId = req.params.agentId;
      if (!isValidCustomId(agentId)) {
        return res.status(400).json({ error: `Invalid agent id: ${agentId}` });
      }
      const scopeRoots = scopeRootsFor(req);
      const found = findAgentRoot(scopeRoots, agentId);
      if (!found) {
        return res.status(404).json({ error: `Custom agent not found: ${agentId}` });
      }
      if (found.scopeRoot.scope !== 'user') {
        return res.status(400).json({
          error: `Only personal agents can be promoted (agent "${agentId}" is ${found.scopeRoot.scope}-scope)`,
          code: 'not-user-scope',
        });
      }
      const workspacesPath = deps.workspaceResolver.getPhysicalWorkspacesPath();
      const destDir = path.join(workspacesPath, userContext.organizationId, CUSTOM_AGENTS_DIRNAME, agentId);
      if (fs.existsSync(path.join(destDir, 'agent.yaml'))) {
        return res.status(409).json({
          error: `An org agent with id "${agentId}" already exists`,
          code: 'org-agent-exists',
        });
      }
      // ACL entry FIRST — an orphan entry is harmless if the move fails (it
      // is ignored on read and removed on delete); a moved dir without an
      // owner record would strand the agent as admin-only.
      await updateOrgAgentAcl(workspacesPath, userContext.organizationId, (records) => {
        records[agentId] = { owner: userContext.userId, editors: [] };
      });
      try {
        fs.mkdirSync(path.dirname(destDir), { recursive: true });
        fs.renameSync(found.agentDir, destDir);
      } catch (moveError) {
        try {
          await updateOrgAgentAcl(workspacesPath, userContext.organizationId, (records) => {
            delete records[agentId];
          });
        } catch { /* best-effort rollback — orphan entries are inert */ }
        throw moveError;
      }
      logger.info(
        `Custom agent promoted to org: ${agentId} (org: ${userContext.organizationId}, owner: ${userContext.userId})`,
        { component: 'AccountAgents' },
      );
      res.status(201).json({ id: agentId, scope: 'org', owner: userContext.userId });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  /** Resolve an ACL-governed org agent or answer 400/404. */
  function findOrgAclAgent(
    res: Response,
    scopeRoots: CustomAgentScopeRoot[],
    agentId: string,
  ): { scopeRoot: CustomAgentScopeRoot; agentDir: string } | null {
    if (!isValidCustomId(agentId)) {
      res.status(400).json({ error: `Invalid agent id: ${agentId}` });
      return null;
    }
    const found = findAgentRoot(scopeRoots, agentId);
    if (!found || !found.scopeRoot.aclGoverned) {
      res.status(404).json({ error: `Org agent not found: ${agentId}` });
      return null;
    }
    return found;
  }

  router.get('/:agentId/permissions', async (req: Request, res: Response) => {
    try {
      if (!findOrgAclAgent(res, scopeRootsFor(req), req.params.agentId)) return;
      const gate = await orgGateFor(req)();
      res.json(computeOrgResourcePermissions(gate.records[req.params.agentId], gate.callerId, gate.liveRole));
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  /**
   * Replace the delegated editors list. Requires manage authority (owner ∨
   * org admin/owner). Every editor must be a live org member; the owner is
   * implicit — never listed, never removable.
   */
  router.put('/:agentId/editors', async (req: Request, res: Response) => {
    try {
      if (!findOrgAclAgent(res, scopeRootsFor(req), req.params.agentId)) return;
      const gate = await orgGateFor(req)();
      const entry = gate.records[req.params.agentId];
      const perms = computeOrgResourcePermissions(entry, gate.callerId, gate.liveRole);
      if (!perms.canManageEditors) {
        return res.status(403).json({
          error: `You do not have permission to manage editors of "${req.params.agentId}"`,
          code: 'org-agent-forbidden',
        });
      }
      const rawEditors = req.body?.editors;
      if (!Array.isArray(rawEditors) || rawEditors.some((e) => typeof e !== 'string')) {
        return res.status(400).json({ error: 'editors must be an array of userIds (emails)' });
      }
      const userContext = extractUserContext(req);
      const editors = [...new Set(rawEditors.map((e: string) => e.trim().toLowerCase()).filter(Boolean))]
        .filter((e) => e !== entry?.owner);
      for (const editorId of editors) {
        const m = await deps.organizationRepository.getMembership(editorId, userContext.organizationId);
        if (!m) {
          return res.status(400).json({
            error: `"${editorId}" is not a member of this organization`,
            code: 'editor-not-member',
          });
        }
      }
      const updated = await updateOrgAgentAcl(
        deps.workspaceResolver.getPhysicalWorkspacesPath(),
        userContext.organizationId,
        (records) => {
          // Pre-ACL org agent (no entry): the managing admin adopts ownership.
          const cur = records[req.params.agentId] ?? { owner: gate.callerId, editors: [] };
          records[req.params.agentId] = { ...cur, editors };
        },
      );
      const finalEntry = updated[req.params.agentId];
      res.json(computeOrgResourcePermissions(finalEntry, gate.callerId, gate.liveRole));
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.get('/:agentId/jobs/:jobId/validate', (req: Request, res: Response) => {
    try {
      const resolved = loadCustomJob(scopeRootsFor(req), req.params.agentId, req.params.jobId);
      const advisories = resolved.advisories ?? [];
      res.json({
        // Advisories (H9-class) load fine but fail validation — the author
        // is the one asking, and `valid: false` is what they self-correct on.
        valid: advisories.length === 0,
        ...(advisories.length > 0 ? { errors: advisories } : {}),
        builtinTools: resolved.builtinTools,
        mcpServers: Object.keys(resolved.mcpServers),
        apiServers: Object.keys(resolved.apiServers),
        intents: resolved.intents,
      });
    } catch (error: any) {
      if (error instanceof CustomAgentValidationError) {
        return res.status(400).json({ valid: false, error: error.message });
      }
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // Composed-prompt preview: the exact <custom_job_instructions> block the
  // runtime injects for the given active intents (readonly scopes viewable).
  router.get('/:agentId/jobs/:jobId/prompt-preview', (req: Request, res: Response) => {
    try {
      const { agentId, jobId } = req.params;
      const resolved = loadCustomJob(scopeRootsFor(req), agentId, jobId);
      const rawIntents = String(req.query.intents ?? '');
      const intents = rawIntents
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const known = new Set(resolved.intents.map((i) => i.id));
      for (const id of intents) {
        if (id !== GENERAL_INTENT && !known.has(id)) {
          return res.status(400).json({ error: `Unknown intent id for this job: "${id}"`, code: 'unknown-intent' });
        }
      }
      const block = buildCustomJobSystemBlock(resolved, intents);
      const preview: CustomJobPromptPreview = {
        agentId,
        jobId,
        activeIntents: intents,
        system: block.text,
        harnessTemplates: Object.values<string>(TEMPLATE_PATHS.universalAgent),
        inlined: block.inlined,
        toc: block.toc,
      };
      res.json(preview);
    } catch (error: any) {
      if (error instanceof CustomAgentValidationError) {
        return res.status(400).json({ valid: false, error: error.message });
      }
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // ── definition files (routes/accountAgents/definitionFiles.routes.ts) ──
  registerDefinitionFileRoutes(router, ctx, upload);

  // Whole-agent import via folder upload (webkitdirectory). Zip is a
  // follow-up (no unzip dependency in the runtime image).
  router.post('/import', ...boundedMultipartUpload(upload), (req: Request, res: Response) => {
    try {
      const scopeRoots = scopeRootsFor(req);
      const files = (req.files as Express.Multer.File[]) || [];
      const rawRelPaths = req.body.relativePaths;
      const relativePaths: string[] = Array.isArray(rawRelPaths) ? rawRelPaths : rawRelPaths ? [rawRelPaths] : [];
      if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

      // The top-level folder name is the agent id.
      const firstSegments = new Set(
        relativePaths.map((p) => p.replace(/\\/g, '/').replace(/^\/+/, '').split('/')[0]).filter(Boolean),
      );
      if (firstSegments.size !== 1) {
        return res.status(400).json({ error: 'Upload exactly one agent folder (a single top-level directory)' });
      }
      const agentId = [...firstSegments][0];
      if (!isValidCustomId(agentId)) {
        return res.status(400).json({ error: `Agent folder name must match [a-z0-9-]+ (got: ${agentId})` });
      }
      const hasAgentYaml = relativePaths.some((p) => p.replace(/\\/g, '/') === `${agentId}/agent.yaml`);
      if (!hasAgentYaml) {
        return res.status(400).json({ error: 'The agent folder must contain agent.yaml at its root' });
      }
      const root = creationRoot(scopeRoots);
      const collision = findCreateCollision(scopeRoots, agentId);
      const overwrite = String(req.body.overwrite || '') === 'true';
      // Overwrite is a REPLACE of the definition dir, and only where the caller
      // may write: a readonly (builtin/org) id stays a 409 no matter the flag.
      if (collision && !(overwrite && collision.scopeRoot.root === root.root)) {
        // Typed, because the CLIENT turns this verdict into the overwrite
        // prompt. Its own pre-check reads a list that can be stale; without a
        // code to recognise, a stale list turned the prompt into a silent
        // failure on whatever error surface happened to be mounted.
        return res.status(409).json({
          error: createCollisionMessage(agentId, collision),
          code: 'agent-exists',
          agentId,
          writable: collision.scopeRoot.root === root.root,
        });
      }

      const agentDir = path.join(root.root, agentId);
      if (collision) fs.rmSync(agentDir, { recursive: true, force: true });
      const uploaded: string[] = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const withAgent = (relativePaths[i] || files[i].originalname).replace(/\\/g, '/').replace(/^\/+/, '');
        const rel = withAgent.split('/').slice(1).join('/');
        const written = writeDefinitionUpload(agentDir, rel, files[i].buffer);
        if (written.ok) uploaded.push(rel);
        else skipped.push({ path: withAgent, reason: written.reason });
      }
      logger.info(`Custom agent imported: ${agentId} (${uploaded.length} files, ${skipped.length} skipped)`, { component: 'AccountAgents' });
      // The bytes landed unvalidated (this lane is a person's, never a job's);
      // the dry-run verdict rides the response so the client can say what the
      // `PUT /file` funnel would have said — warn, never roll back, like PUT.
      const validation = validateDefinitionSave(scopeRoots, agentDir, agentId, 'agent.yaml');
      res.status(201).json({ success: true, agentId, uploaded, skipped, validation });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // Terminal JSON 404 — an unmatched path on this surface must not fall
  // through to Express's HTML error page: the caller is usually a job's
  // api__ant__ tool, and HTML costs it a self-inference retry round
  // (major-loading-floor RCA: PUT /:id/jobs/:jobId/file). Name the funnel.
  router.use((req: Request, res: Response) => {
    if (/^\/[^/]+\/jobs\/[^/]+\/file$/.test(req.path)) {
      return res.status(404).json({
        error:
          'No such route: definition files under jobs/ are written through the single funnel — ' +
          'PUT /definitions/agents/{agentId}/file with body { path: "jobs/{jobId}/...", content } ' +
          '(read: GET /definitions/agents/{agentId}/file?path=...).',
      });
    }
    return res.status(404).json({
      error:
        `No such route: ${req.method} /definitions/agents${req.path}. ` +
        'Definition files are read and written through GET|PUT /definitions/agents/{agentId}/file; ' +
        'structure is created through POST /definitions/agents and POST /definitions/agents/{agentId}/jobs.',
    });
  });

  return router;
}
