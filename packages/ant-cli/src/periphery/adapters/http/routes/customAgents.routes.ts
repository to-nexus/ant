/**
 * Custom agent / job definition routes (universal runtime, D8 scopes).
 *
 * The API keeps the agent ⊃ job hierarchy explicit: jobs are only reachable
 * under an agent context. Definitions are plain files under the scope roots
 * (`.ant/agents/{agentId}/…`) — these routes are a thin CRUD over them.
 * Readonly scopes (org) return 403 for any mutation.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import multer from 'multer';
import { writeBufferVerified } from '../../../../core/utils/binaryIntegrity';
import { isValidCustomId } from '@ant/shared';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { deriveCustomAgentScopeRoots } from '../../../../core/customAgents/scopeRoots';
import {
  UNIVERSAL_ARTIFACT_CANONICAL_DIRS,
  UNIVERSAL_SESSIONS_NODE,
  buildUniversalMergedTree,
  resolveUniversalMergedPath,
  type UniversalTreeNode,
} from '../../../../core/customAgents/universalContainer';
import {
  discoverAgents,
  findCreateCollision,
  loadCustomJob,
  type CustomAgentScopeRoot,
} from '../../../../core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../../../core/customAgents/types';
import { createCollisionMessage, findWritableAgent, patchYamlFile, scaffoldAgent, scaffoldJob } from './helpers/customAgentHandlers';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';
import { UPLOAD_LIMITS } from '../../../../core/config/uploadLimits';

export function createCustomAgentRoutes(deps: { workspaceResolver: WorkspaceResolver }): Router {
  const router = Router();

  function scopeRootsFor(req: Request, projectId: string): CustomAgentScopeRoot[] {
    const userContext = extractUserContext(req);
    const projectPath = deps.workspaceResolver.getProjectPath(userContext, projectId);
    return deriveCustomAgentScopeRoots(projectPath);
  }

  // ── agents ─────────────────────────────────────────────────────────────

  router.get('/projects/:projectId/custom-agents', (req: Request, res: Response) => {
    try {
      const agents = discoverAgents(scopeRootsFor(req, req.params.projectId));
      res.json({ agents });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.post('/projects/:projectId/custom-agents', (req: Request, res: Response) => {
    try {
      // `description` from older FE builds is accepted-and-dropped (schema no longer carries it).
      const { id, name } = req.body ?? {};
      if (!isValidCustomId(id ?? '')) {
        return res.status(400).json({ error: `Agent id must match [a-z0-9-]+ (got: ${String(id)})` });
      }
      const scopeRoots = scopeRootsFor(req, req.params.projectId);
      const collision = findCreateCollision(scopeRoots, id);
      if (collision) {
        return res.status(409).json({ error: createCollisionMessage(id, collision) });
      }
      // Definitions are account-owned: creation always targets the user root.
      const root = scopeRoots.find((r) => r.scope === 'user')!;
      const agentDir = path.join(root.root, id);
      scaffoldAgent(agentDir, id, name || id);
      logger.info(`Custom agent scaffolded: ${id} (scope: user)`, { component: 'CustomAgents' });
      res.status(201).json({ id, name: name || id, scope: 'user', readonly: false, jobs: [] });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.patch('/projects/:projectId/custom-agents/:agentId', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req, req.params.projectId), req.params.agentId);
      if (!found) return;
      const { name } = req.body ?? {};
      patchYamlFile(path.join(found.agentDir, 'agent.yaml'), { name });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.delete('/projects/:projectId/custom-agents/:agentId', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req, req.params.projectId), req.params.agentId);
      if (!found) return;
      fs.rmSync(found.agentDir, { recursive: true, force: true });
      logger.info(`Custom agent deleted: ${req.params.agentId}`, { component: 'CustomAgents' });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  // ── jobs (agent context only) ──────────────────────────────────────────

  router.get('/projects/:projectId/custom-agents/:agentId/jobs', (req: Request, res: Response) => {
    try {
      const scopeRoots = scopeRootsFor(req, req.params.projectId);
      const agents = discoverAgents(scopeRoots);
      const agent = agents.find((a) => a.id === req.params.agentId);
      if (!agent) return res.status(404).json({ error: `Custom agent not found: ${req.params.agentId}` });
      res.json({ jobs: agent.jobs });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.post('/projects/:projectId/custom-agents/:agentId/jobs', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req, req.params.projectId), req.params.agentId);
      if (!found) return;
      // `description` from older FE builds is accepted-and-dropped — the
      // job.yaml schema no longer carries it (mirrors agent.yaml).
      const { id, name } = req.body ?? {};
      if (!isValidCustomId(id ?? '')) {
        return res.status(400).json({ error: `Job id must match [a-z0-9-]+ (got: ${String(id)})` });
      }
      const jobDir = path.join(found.agentDir, 'jobs', id);
      if (fs.existsSync(jobDir)) {
        return res.status(409).json({ error: `Custom job already exists: ${req.params.agentId}/${id}` });
      }
      scaffoldJob(jobDir, id, name || id);
      logger.info(`Custom job scaffolded: ${req.params.agentId}/${id}`, { component: 'CustomAgents' });
      res.status(201).json({ id, name: name || id });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.patch('/projects/:projectId/custom-agents/:agentId/jobs/:jobId', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req, req.params.projectId), req.params.agentId);
      if (!found) return;
      const jobYaml = path.join(found.agentDir, 'jobs', req.params.jobId, 'job.yaml');
      if (!isValidCustomId(req.params.jobId) || !fs.existsSync(jobYaml)) {
        return res.status(404).json({ error: `Custom job not found: ${req.params.agentId}/${req.params.jobId}` });
      }
      const { name } = req.body ?? {};
      patchYamlFile(jobYaml, { name });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.delete('/projects/:projectId/custom-agents/:agentId/jobs/:jobId', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req, req.params.projectId), req.params.agentId);
      if (!found) return;
      const jobDir = path.join(found.agentDir, 'jobs', req.params.jobId);
      if (!isValidCustomId(req.params.jobId) || !fs.existsSync(jobDir)) {
        return res.status(404).json({ error: `Custom job not found: ${req.params.agentId}/${req.params.jobId}` });
      }
      fs.rmSync(jobDir, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  // ── job validation (dry check — surfaces loader 400s before a run) ─────

  router.get('/projects/:projectId/custom-agents/:agentId/jobs/:jobId/validate', (req: Request, res: Response) => {
    try {
      const scopeRoots = scopeRootsFor(req, req.params.projectId);
      const resolved = loadCustomJob(scopeRoots, req.params.agentId, req.params.jobId);
      res.json({
        valid: true,
        builtinTools: resolved.builtinTools,
        mcpServers: Object.keys(resolved.mcpServers),
        intents: resolved.intents,
      });
    } catch (error: any) {
      if (error instanceof CustomAgentValidationError) {
        return res.status(400).json({ valid: false, error: error.message });
      }
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  // ── universal artifact tree (project-shared working tree, D6) ──────────

  const upload = multer({ storage: multer.memoryStorage(), limits: UPLOAD_LIMITS });

  /** Reserved top-level node name — the grafted sessions folder (see tree). */
  const SESSIONS_NODE = UNIVERSAL_SESSIONS_NODE;

  function firstSegment(rel: string): string {
    return rel.replace(/\\/g, '/').replace(/^\/+/, '').split('/')[0] ?? '';
  }

  function containerRootFor(req: Request, projectId: string): string {
    const userContext = extractUserContext(req);
    return deps.workspaceResolver.getUniversalContainerPath(userContext, projectId);
  }

  /**
   * Merged-path routing — delegates to the `universalContainer` SSOT
   * (`resolveUniversalMergedPath`), shared with FileOperationService.
   * Artifacts-only routes call it after their `sessions` reserved-name guard,
   * so non-`sessions/` paths always land inside `{container}/artifacts`.
   */
  function resolveMergedPath(req: Request, projectId: string, rel: string): string {
    return resolveUniversalMergedPath(containerRootFor(req, projectId), rel);
  }

  /** API node shape (no absolutePath leak). */
  interface ArtifactTreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    children?: ArtifactTreeNode[];
  }

  function toApiNode(n: UniversalTreeNode): ArtifactTreeNode {
    return {
      name: n.name,
      path: n.path,
      type: n.type,
      ...(n.type === 'file' ? { size: n.size ?? 0 } : { children: (n.children ?? []).map(toApiNode) }),
    };
  }

  router.get('/projects/:projectId/universal/artifacts/tree', (req: Request, res: Response) => {
    try {
      // Assembly SSOT — universalContainer.buildUniversalMergedTree (shared
      // with FileOperationService.getFileTree; single implementation, no drift).
      const tree = buildUniversalMergedTree(containerRootFor(req, req.params.projectId));
      res.json({ tree: tree.map(toApiNode) });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  router.post('/projects/:projectId/universal/artifacts/upload', upload.array('files'), async (req: Request, res: Response) => {
    try {
      const dirPath = (req.body.dirPath || '').replace(/\\/g, '/');
      const files = (req.files as Express.Multer.File[]) || [];
      const rawRelPaths = req.body.relativePaths;
      const relativePaths: string[] = Array.isArray(rawRelPaths) ? rawRelPaths : rawRelPaths ? [rawRelPaths] : [];

      const uploadedFiles: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const relPath = (relativePaths[i] || files[i].originalname).replace(/\\/g, '/');
        const effectiveRel = path.join(dirPath, relPath).replace(/\\/g, '/');
        if (firstSegment(effectiveRel) === SESSIONS_NODE) {
          return res.status(400).json({
            error: `"${SESSIONS_NODE}" is a reserved name at the workspace root`,
            code: 'reserved-name-sessions',
          });
        }
        const filePath = resolveMergedPath(req, req.params.projectId, effectiveRel);
        // Byte-safe write (size + header verification) — uploads must survive
        // binary payloads unmodified (no utf-8 round-trip).
        await writeBufferVerified(filePath, files[i].buffer);
        uploadedFiles.push(effectiveRel);
      }
      res.json({ success: true, uploadedFiles, count: uploadedFiles.length });
    } catch (error: any) {
      if (error?.code === 'CORRUPTED_FILE') {
        return res.status(422).json({ code: 'CORRUPTED_FILE', message: error.message, filename: error.filename });
      }
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  router.get('/projects/:projectId/universal/artifacts/file', (req: Request, res: Response) => {
    try {
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path query param is required' });
      const full = resolveMergedPath(req, req.params.projectId, rel);
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        return res.status(404).json({ error: `Artifact not found: ${rel}` });
      }
      res.download(full);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  router.delete('/projects/:projectId/universal/artifacts/file', (req: Request, res: Response) => {
    try {
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path query param is required' });
      const full = resolveMergedPath(req, req.params.projectId, rel);
      if (!fs.existsSync(full)) {
        return res.status(404).json({ error: `Artifact not found: ${rel}` });
      }
      // Canonical roots are clearable, never removable (codespace parity):
      // delete on the root clears its contents and keeps the dir.
      if (rel === SESSIONS_NODE || (UNIVERSAL_ARTIFACT_CANONICAL_DIRS as readonly string[]).includes(rel)) {
        for (const entry of fs.readdirSync(full)) {
          fs.rmSync(path.join(full, entry), { recursive: true, force: true });
        }
        return res.json({ success: true, cleared: true });
      }
      fs.rmSync(full, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  router.post('/projects/:projectId/universal/artifacts/create-file', (req: Request, res: Response) => {
    try {
      const rel = String(req.body?.path || '').replace(/\\/g, '/');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      if (firstSegment(rel) === SESSIONS_NODE) {
        return res.status(400).json({
          error: `"${SESSIONS_NODE}" is a reserved name at the workspace root`,
          code: 'reserved-name-sessions',
        });
      }
      const full = resolveMergedPath(req, req.params.projectId, rel);
      if (fs.existsSync(full)) {
        return res.status(409).json({ error: `Already exists: ${rel}` });
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '', { flag: 'wx' });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  router.post('/projects/:projectId/universal/artifacts/rename', (req: Request, res: Response) => {
    try {
      const rel = String(req.body?.path || '').replace(/\\/g, '/');
      const newName = String(req.body?.newName || '');
      if (!rel || !newName) return res.status(400).json({ error: 'path and newName are required' });
      if (newName.includes('/') || newName.includes('\\') || newName.startsWith('.')) {
        return res.status(400).json({ error: `Invalid name: ${newName}` });
      }
      if (firstSegment(rel) === SESSIONS_NODE || (UNIVERSAL_ARTIFACT_CANONICAL_DIRS as readonly string[]).includes(rel)) {
        return res.status(400).json({ error: `"${rel}" cannot be renamed` });
      }
      const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (!parentRel && (newName === SESSIONS_NODE || (UNIVERSAL_ARTIFACT_CANONICAL_DIRS as readonly string[]).includes(newName))) {
        return res.status(400).json({ error: `"${newName}" is a reserved name at the workspace root`, code: 'reserved-name-sessions' });
      }
      const from = resolveMergedPath(req, req.params.projectId, rel);
      const to = resolveMergedPath(req, req.params.projectId, parentRel ? `${parentRel}/${newName}` : newName);
      if (!fs.existsSync(from)) return res.status(404).json({ error: `Artifact not found: ${rel}` });
      if (fs.existsSync(to)) return res.status(409).json({ error: `Already exists: ${newName}` });
      fs.renameSync(from, to);
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  router.post('/projects/:projectId/universal/artifacts/mkdir', (req: Request, res: Response) => {
    try {
      const rel = String(req.body?.path || '');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      if (firstSegment(rel) === SESSIONS_NODE) {
        return res.status(400).json({
          error: `"${SESSIONS_NODE}" is a reserved name at the workspace root`,
          code: 'reserved-name-sessions',
        });
      }
      fs.mkdirSync(resolveMergedPath(req, req.params.projectId, rel), { recursive: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  return router;
}
