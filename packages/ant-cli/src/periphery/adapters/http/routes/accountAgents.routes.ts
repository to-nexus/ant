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
import { boundedMultipart } from '../middleware/boundedMultipart';
import {
  CUSTOM_ID_HINT,
  GENERAL_INTENT,
  MEMBERSHIP_REQUIRED,
  classifyDefinitionDir,
  isAllowedDefinitionDir,
  isAllowedDefinitionPath,
  isValidCustomId,
  type CustomJobPromptPreview,
} from '@ant/shared';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { FILE_READ_MAX_BYTES } from '../services/ProjectService/FileOperationService';
import { CUSTOM_AGENTS_DIRNAME, deriveCustomAgentScopeRootsForTenant } from '../../../../core/customAgents/scopeRoots';
import type { OrganizationRepositoryPort } from '../../../../core/ports/organizationRepository';
import {
  discoverAgents,
  findAgentRoot,
  findCreateCollision,
  loadCustomJob,
  type CustomAgentScopeRoot,
} from '../../../../core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../../../core/customAgents/types';
import { buildCustomJobSystemBlock } from '../../../../core/customAgents/promptBlock';
import { moveUniversalAgentData, moveUniversalJobData } from '../../../../core/customAgents/universalContainer';
import { MUTATING_BUILTIN_TOOLS, UNIVERSAL_BUILTIN_TOOLS } from '../../../../core/customAgents/universalToolPolicy';
import { TEMPLATE_PATHS } from '../../../../core/prompt/builder/templatePaths';
import {
  buildDefinitionTree,
  createCollisionMessage,
  decorateOrgAgentSummaries,
  findWritableAgent,
  gateDefinitionSave,
  patchYamlFile,
  resolveDefinitionPath,
  scaffoldAgent,
  scaffoldJob,
  validateDefinitionSave,
} from './helpers/customAgentHandlers';
import {
  canEditOrgResource,
  computeOrgResourcePermissions,
  createOrgGateResolver,
  readOrgAgentAcl,
  updateOrgAgentAcl,
} from './helpers/orgAclStore';
import { resolveLiveTeamMembership } from './helpers/teamRole';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { streamDefinitionArchive } from './helpers/definitionArchive';
import { downloadRateLimiter } from '../middleware/rateLimiter';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { logger } from '../../../../utils/logger';
import { UPLOAD_LIMITS } from '../../../../core/config/uploadLimits';

/**
 * Files the settings UI may never delete/rename directly — remove the
 * agent/job/intent directory instead. `intents/{id}/infer.md` is included:
 * deleting or renaming it alone always breaks the required-file invariant
 * (the sibling prompt.md and hooks.yaml are optional and stay freely
 * deletable).
 */
function isStructuralFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return (
    normalized === 'agent.yaml' ||
    /^jobs\/[^/]+\/job\.yaml$/.test(normalized) ||
    /^jobs\/[^/]+\/intents\/[^/]+\/infer\.md$/.test(normalized)
  );
}

/** `jobs/{jobId}/intents/{intentId}` (the intent DIRECTORY), or null. */
function parseIntentDirPath(relPath: string): { jobId: string; intentId: string } | null {
  const parts = relPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  if (parts.length !== 4 || parts[0] !== 'jobs' || parts[2] !== 'intents') return null;
  if (!isValidCustomId(parts[1]) || !isValidCustomId(parts[3])) return null;
  return { jobId: parts[1], intentId: parts[3] };
}

export function createAccountAgentRoutes(deps: {
  workspaceResolver: WorkspaceResolver;
  organizationRepository: OrganizationRepositoryPort;
  /** Backs the cluster-wide per-account budget on the folder-export stream. */
  stateStore?: StateStorePort;
}): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: UPLOAD_LIMITS });

  function scopeRootsFor(req: Request): CustomAgentScopeRoot[] {
    const userContext = extractUserContext(req);
    return deriveCustomAgentScopeRootsForTenant({
      workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(),
      userId: userContext.userId,
      organizationId: userContext.organizationId,
      organizationKind: userContext.organizationKind ?? 'local',
    });
  }

  const orgGateFor = createOrgGateResolver(
    {
      organizationRepository: deps.organizationRepository,
      workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(),
    },
    readOrgAgentAcl,
  );

  /** The creation/import destination — the writable user root. */
  function creationRoot(scopeRoots: CustomAgentScopeRoot[]): CustomAgentScopeRoot {
    return scopeRoots.find((r) => r.scope === 'user' && !r.readonly)!;
  }

  /** Any-scope resolve (readonly scopes are viewable) or 400/404 response. */
  function findViewableAgent(
    res: Response,
    scopeRoots: CustomAgentScopeRoot[],
    agentId: string,
  ): { scopeRoot: CustomAgentScopeRoot; agentDir: string } | null {
    if (!isValidCustomId(agentId)) {
      res.status(400).json({ error: `Invalid agent id: ${agentId}` });
      return null;
    }
    const found = findAgentRoot(scopeRoots, agentId);
    if (!found) {
      res.status(404).json({ error: `Custom agent not found: ${agentId}` });
      return null;
    }
    return found;
  }

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
      res.json({
        valid: true,
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

  // ── definition files ─────────────────────────────────────────────────────

  router.get('/:agentId/files', async (req: Request, res: Response) => {
    try {
      const found = findViewableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      // `readonly` is the CALLER's effective authority, mirroring the list
      // decoration: ACL-governed org agents resolve per caller — the
      // structural flag alone would tell every member the agent is editable.
      let readonly = found.scopeRoot.readonly;
      if (found.scopeRoot.aclGoverned) {
        const gate = await orgGateFor(req)();
        readonly = !canEditOrgResource(gate.records[req.params.agentId], gate.callerId, gate.liveRole);
      }
      res.json({
        tree: buildDefinitionTree(found.agentDir),
        scope: found.scopeRoot.scope,
        readonly,
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.get('/:agentId/file', (req: Request, res: Response) => {
    try {
      const found = findViewableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path query param is required' });
      let full: string;
      try {
        full = resolveDefinitionPath(found.agentDir, rel);
      } catch {
        // Traversal out of the agent dir is a caller error, not a server one
        // (this is what keeps the sibling agent-acl.json unreachable).
        return res.status(400).json({ error: `Invalid definition path: ${rel}` });
      }
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        return res.status(404).json({ error: `Definition file not found: ${rel}` });
      }
      // Same descriptor-bound ceiling as every other JSON file read: the whole
      // body is materialised into the API heap and the serializer, and the
      // whitelist admits `on-demand/**.json` of any size (a vendor swagger
      // dropped in verbatim). An authenticated route is not a budgeted one.
      const size = fs.statSync(full).size;
      if (size > FILE_READ_MAX_BYTES) {
        return res.status(413).json({
          error: `Definition file too large to open as text: ${rel} (limit ${FILE_READ_MAX_BYTES} bytes)`,
          code: 'FILE_TOO_LARGE',
        });
      }
      res.json({ path: rel, content: fs.readFileSync(full, 'utf-8') });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  /**
   * Whole-agent folder export — the mirror of `POST /import`. Any scope is
   * downloadable (readonly org/builtin agents are browseable, and this ships
   * exactly the bytes their file endpoints already serve); the archive admits
   * only `isAllowedDefinitionPath`, so the sibling `agent-acl.json` and any
   * future non-definition file in the tree stay out of it by default, and the
   * ZIP round-trips back through import with nothing skipped.
   */
  router.get('/:agentId/download', downloadRateLimiter, async (req: Request, res: Response) => {
    try {
      const found = findViewableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const userContext = extractUserContext(req);
      await streamDefinitionArchive(res, {
        root: found.scopeRoot.root,
        dirName: req.params.agentId,
        admits: isAllowedDefinitionPath,
        stateStore: deps.stateStore,
        slotKey: `ant:slots:defzip:${userContext.organizationId}:${userContext.userId}`,
        component: 'AccountAgents',
      });
    } catch (error: any) {
      if (!res.headersSent) sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // The single definition write funnel — raw editor AND structured form
  // sections both land here.
  router.put('/:agentId/file', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.body?.path || '');
      const content = req.body?.content;
      // Name the field that is missing. One message for both made a dropped
      // `path` read as a size/serialization problem, and the caller "fixed" it
      // by splitting the file across two PUTs — which overwrites, not appends.
      if (!rel) {
        return res.status(400).json({ error: 'path is required (the definition-relative file path to write)' });
      }
      if (typeof content !== 'string') {
        return res.status(400).json({
          error:
            content === undefined
              ? 'content is required (the file\'s full text — this route replaces the file, it never appends)'
              : `content must be a string (got: ${Array.isArray(content) ? 'array' : typeof content})`,
        });
      }
      const gate = gateDefinitionSave(req.params.agentId, rel, content, found.agentDir);
      if (!gate.ok) {
        return res.status(gate.status).json({ error: gate.error, code: 'definition-gate-failed' });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      // Report what this write replaced. A second PUT to one path is legitimate
      // (a shrinking rewrite is a normal edit) so it is never refused — but a
      // caller that believed it was appending has no other way to observe that
      // it destroyed the previous content.
      const replacedBytes = fs.existsSync(full) ? fs.statSync(full).size : 0;
      fs.writeFileSync(full, content, 'utf-8');
      const validation = validateDefinitionSave(scopeRootsFor(req), found.agentDir, req.params.agentId, rel);
      res.json({ success: true, validation, replacedBytes, newBytes: Buffer.byteLength(content, 'utf-8') });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/create', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.body?.path || '');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      if (!isAllowedDefinitionPath(rel)) {
        return res.status(400).json({ error: `Path is outside the definition whitelist: ${rel}` });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      if (fs.existsSync(full)) {
        return res.status(409).json({ error: `Already exists: ${rel}` });
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '', { flag: 'wx' });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/mkdir', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.body?.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      const kind = classifyDefinitionDir(rel);
      if (kind === 'unknown') {
        return res.status(400).json({ error: `Path is outside the definition whitelist: ${rel}` });
      }
      // A job/intent directory is BORN by its own creator (POST /jobs, and the
      // intent's infer.md save) — mkdir must not become a second birth site.
      if (kind === 'job') {
        return res.status(400).json({ error: 'Create a job with POST /:agentId/jobs — it scaffolds job.yaml' });
      }
      if (kind === 'intent') {
        return res.status(400).json({ error: 'Create an intent by saving its infer.md — the directory follows' });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      if (fs.existsSync(full)) return res.status(409).json({ error: `Already exists: ${rel}` });
      fs.mkdirSync(full, { recursive: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/rename', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.body?.path || '').replace(/\\/g, '/');
      const newName = String(req.body?.newName || '');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      if (!newName) return res.status(400).json({ error: 'newName is required' });
      if (newName.includes('/') || newName.includes('\\') || newName.startsWith('.')) {
        return res.status(400).json({ error: `Invalid name: ${newName}` });
      }
      // Intent rename = pure directory rename, server-side (no file declares
      // the id — the directory name IS the id). An FE create-new+delete-old
      // sequence would still trip the structural-file rules, and delete-first
      // loses data on failure.
      const intentDir = parseIntentDirPath(rel);
      if (intentDir) {
        if (!isValidCustomId(newName)) {
          return res.status(400).json({ error: `Intent id must be ${CUSTOM_ID_HINT} (got: ${newName})` });
        }
        if (newName === GENERAL_INTENT) {
          return res.status(400).json({
            error: `"${GENERAL_INTENT}" is the implicit fallback intent and cannot be declared`,
          });
        }
        const from = resolveDefinitionPath(found.agentDir, rel);
        const to = resolveDefinitionPath(found.agentDir, `jobs/${intentDir.jobId}/intents/${newName}`);
        if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
          return res.status(404).json({ error: `Intent directory not found: ${rel}` });
        }
        if (fs.existsSync(to)) {
          return res.status(409).json({ error: `Already exists: jobs/${intentDir.jobId}/intents/${newName}` });
        }
        fs.renameSync(from, to);
        return res.json({ success: true });
      }
      if (isStructuralFile(rel)) {
        return res.status(400).json({ error: `"${rel}" cannot be renamed — delete the agent/job/intent directory instead` });
      }
      const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const newRel = parentRel ? `${parentRel}/${newName}` : newName;
      if (!isAllowedDefinitionPath(newRel)) {
        return res.status(400).json({ error: `Target path is outside the definition whitelist: ${newRel}` });
      }
      const from = resolveDefinitionPath(found.agentDir, rel);
      const to = resolveDefinitionPath(found.agentDir, newRel);
      if (!fs.existsSync(from)) return res.status(404).json({ error: `Definition file not found: ${rel}` });
      if (fs.existsSync(to)) return res.status(409).json({ error: `Already exists: ${newRel}` });
      fs.renameSync(from, to);
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.delete('/:agentId/file', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path query param is required' });
      if (isStructuralFile(rel)) {
        return res.status(400).json({ error: `"${rel}" cannot be deleted — delete the agent/job/intent directory instead` });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      if (!fs.existsSync(full)) return res.status(404).json({ error: `Definition file not found: ${rel}` });
      fs.rmSync(full, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/upload', ...boundedMultipart(), upload.array('files'), async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const files = (req.files as Express.Multer.File[]) || [];
      const rawRelPaths = req.body.relativePaths;
      const relativePaths: string[] = Array.isArray(rawRelPaths) ? rawRelPaths : rawRelPaths ? [rawRelPaths] : [];

      // Directory-unit upload = REPLACE: validate everything before the rm so a
      // rejected request never leaves a half-deleted directory behind.
      const replaceDir = String(req.body.replaceDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
      if (replaceDir) {
        if (!isAllowedDefinitionDir(replaceDir) || classifyDefinitionDir(replaceDir) === 'agent-root') {
          return res.status(400).json({ error: `Invalid replaceDir: ${replaceDir}` });
        }
        const outside = relativePaths.find((p) => !p.replace(/\\/g, '/').startsWith(`${replaceDir}/`));
        if (outside) {
          return res.status(400).json({ error: `Upload path outside replaceDir (${replaceDir}): ${outside}` });
        }
        fs.rmSync(resolveDefinitionPath(found.agentDir, replaceDir), { recursive: true, force: true });
      }

      const uploaded: string[] = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const rel = (relativePaths[i] || files[i].originalname).replace(/\\/g, '/');
        if (!isAllowedDefinitionPath(rel)) {
          skipped.push({ path: rel, reason: 'outside the definition whitelist' });
          continue;
        }
        const full = resolveDefinitionPath(found.agentDir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, files[i].buffer.toString('utf-8'), 'utf-8');
        uploaded.push(rel);
      }
      res.json({ success: true, uploaded, skipped });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // Whole-agent import via folder upload (webkitdirectory). Zip is a
  // follow-up (no unzip dependency in the runtime image).
  router.post('/import', ...boundedMultipart(), upload.array('files'), (req: Request, res: Response) => {
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
        return res.status(409).json({ error: createCollisionMessage(agentId, collision) });
      }

      const agentDir = path.join(root.root, agentId);
      if (collision) fs.rmSync(agentDir, { recursive: true, force: true });
      const uploaded: string[] = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const withAgent = (relativePaths[i] || files[i].originalname).replace(/\\/g, '/').replace(/^\/+/, '');
        const rel = withAgent.split('/').slice(1).join('/');
        if (!rel || !isAllowedDefinitionPath(rel)) {
          skipped.push({ path: withAgent, reason: 'outside the definition whitelist' });
          continue;
        }
        const full = resolveDefinitionPath(agentDir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, files[i].buffer.toString('utf-8'), 'utf-8');
        uploaded.push(rel);
      }
      logger.info(`Custom agent imported: ${agentId} (${uploaded.length} files, ${skipped.length} skipped)`, { component: 'AccountAgents' });
      res.status(201).json({ success: true, agentId, uploaded, skipped });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  return router;
}
