/**
 * Account-scoped agent settings API (`/api/account/agents`).
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
import { isAllowedDefinitionPath, isValidCustomId } from '@ant/shared';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { deriveCustomAgentScopeRootsFromUserDir } from '../../../../core/customAgents/scopeRoots';
import {
  discoverAgents,
  findAgentRoot,
  findCreateCollision,
  loadCustomJob,
  type CustomAgentScopeRoot,
} from '../../../../core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../../../core/customAgents/types';
import { UNIVERSAL_BUILTIN_TOOLS } from '../../../../core/customAgents/universalToolPolicy';
import {
  buildDefinitionTree,
  findWritableAgent,
  gateDefinitionSave,
  patchYamlFile,
  resolveDefinitionPath,
  scaffoldAgent,
  scaffoldJob,
  validateDefinitionSave,
} from './helpers/customAgentHandlers';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';

/** Files the settings UI may never delete/rename directly — remove the agent/job instead. */
function isStructuralFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized === 'agent.yaml' || /^jobs\/[^/]+\/job\.yaml$/.test(normalized);
}

export function createAccountAgentRoutes(deps: { workspaceResolver: WorkspaceResolver }): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  function scopeRootsFor(req: Request): CustomAgentScopeRoot[] {
    const userContext = extractUserContext(req);
    return deriveCustomAgentScopeRootsFromUserDir(deps.workspaceResolver.getWorkspacePath(userContext));
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

  router.get('/', (req: Request, res: Response) => {
    try {
      const agents = discoverAgents(scopeRootsFor(req));
      // builtinToolPreset supplies the settings form's tool-checkbox
      // vocabulary from the runtime SSOT — never hardcoded in the FE.
      res.json({ agents, builtinToolPreset: UNIVERSAL_BUILTIN_TOOLS });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // ── agent / job CRUD (mirrors the project-scoped mount) ─────────────────

  router.post('/', (req: Request, res: Response) => {
    try {
      const { id, name, description = '' } = req.body ?? {};
      if (!isValidCustomId(id ?? '')) {
        return res.status(400).json({ error: `Agent id must match [a-z0-9-]+ (got: ${String(id)})` });
      }
      const scopeRoots = scopeRootsFor(req);
      if (findCreateCollision(scopeRoots, id)) {
        return res.status(409).json({ error: `Custom agent already exists: ${id}` });
      }
      const root = scopeRoots.find((r) => r.scope === 'user')!;
      const agentDir = path.join(root.root, id);
      scaffoldAgent(agentDir, id, name || id, description);
      logger.info(`Custom agent scaffolded: ${id} (scope: user)`, { component: 'AccountAgents' });
      res.status(201).json({ id, name: name || id, description, scope: 'user', readonly: false, jobs: [] });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.patch('/:agentId', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const { name, description } = req.body ?? {};
      patchYamlFile(path.join(found.agentDir, 'agent.yaml'), { name, description });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.delete('/:agentId', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      fs.rmSync(found.agentDir, { recursive: true, force: true });
      logger.info(`Custom agent deleted: ${req.params.agentId}`, { component: 'AccountAgents' });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/jobs', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const { id, name, description = '' } = req.body ?? {};
      if (!isValidCustomId(id ?? '')) {
        return res.status(400).json({ error: `Job id must match [a-z0-9-]+ (got: ${String(id)})` });
      }
      const jobDir = path.join(found.agentDir, 'jobs', id);
      if (fs.existsSync(jobDir)) {
        return res.status(409).json({ error: `Custom job already exists: ${req.params.agentId}/${id}` });
      }
      scaffoldJob(jobDir, id, name || id, description);
      res.status(201).json({ id, name: name || id, description });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.patch('/:agentId/jobs/:jobId', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const jobYaml = path.join(found.agentDir, 'jobs', req.params.jobId, 'job.yaml');
      if (!isValidCustomId(req.params.jobId) || !fs.existsSync(jobYaml)) {
        return res.status(404).json({ error: `Custom job not found: ${req.params.agentId}/${req.params.jobId}` });
      }
      const { name, description } = req.body ?? {};
      patchYamlFile(jobYaml, { name, description });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.delete('/:agentId/jobs/:jobId', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
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

  router.get('/:agentId/jobs/:jobId/validate', (req: Request, res: Response) => {
    try {
      const resolved = loadCustomJob(scopeRootsFor(req), req.params.agentId, req.params.jobId);
      res.json({
        valid: true,
        builtinTools: resolved.builtinTools,
        mcpServers: Object.keys(resolved.mcpServers),
        outputsMode: resolved.outputs.mode,
        workspace: resolved.workspace,
        intents: resolved.intents,
      });
    } catch (error: any) {
      if (error instanceof CustomAgentValidationError) {
        return res.status(400).json({ valid: false, error: error.message });
      }
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // ── definition files ─────────────────────────────────────────────────────

  router.get('/:agentId/files', (req: Request, res: Response) => {
    try {
      const found = findViewableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      res.json({
        tree: buildDefinitionTree(found.agentDir),
        scope: found.scopeRoot.scope,
        readonly: found.scopeRoot.readonly,
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
      const full = resolveDefinitionPath(found.agentDir, rel);
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        return res.status(404).json({ error: `Definition file not found: ${rel}` });
      }
      res.json({ path: rel, content: fs.readFileSync(full, 'utf-8') });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // The single definition write funnel — raw editor AND structured form
  // sections both land here.
  router.put('/:agentId/file', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const rel = String(req.body?.path || '');
      const content = req.body?.content;
      if (!rel || typeof content !== 'string') {
        return res.status(400).json({ error: 'path and content (string) are required' });
      }
      const gate = gateDefinitionSave(req.params.agentId, rel, content);
      if (!gate.ok) {
        return res.status(gate.status).json({ error: gate.error, code: 'definition-gate-failed' });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf-8');
      const validation = validateDefinitionSave(scopeRootsFor(req), found.agentDir, req.params.agentId, rel);
      res.json({ success: true, validation });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/create', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
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

  router.post('/:agentId/files/rename', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const rel = String(req.body?.path || '').replace(/\\/g, '/');
      const newName = String(req.body?.newName || '');
      if (!rel || !newName) return res.status(400).json({ error: 'path and newName are required' });
      if (newName.includes('/') || newName.includes('\\') || newName.startsWith('.')) {
        return res.status(400).json({ error: `Invalid name: ${newName}` });
      }
      if (isStructuralFile(rel)) {
        return res.status(400).json({ error: `"${rel}" cannot be renamed — delete the agent/job instead` });
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

  router.delete('/:agentId/file', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path query param is required' });
      if (isStructuralFile(rel)) {
        return res.status(400).json({ error: `"${rel}" cannot be deleted — delete the agent/job instead` });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      if (!fs.existsSync(full)) return res.status(404).json({ error: `Definition file not found: ${rel}` });
      fs.rmSync(full, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/upload', upload.array('files'), (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const files = (req.files as Express.Multer.File[]) || [];
      const rawRelPaths = req.body.relativePaths;
      const relativePaths: string[] = Array.isArray(rawRelPaths) ? rawRelPaths : rawRelPaths ? [rawRelPaths] : [];

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
  router.post('/import', upload.array('files'), (req: Request, res: Response) => {
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
      if (findCreateCollision(scopeRoots, agentId)) {
        return res.status(409).json({ error: `Custom agent already exists: ${agentId}` });
      }

      const root = scopeRoots.find((r) => r.scope === 'user')!;
      const agentDir = path.join(root.root, agentId);
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
