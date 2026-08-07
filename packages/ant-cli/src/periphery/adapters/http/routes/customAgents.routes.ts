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
  discoverAgents,
  findAgentRoot,
  loadCustomJob,
  type CustomAgentScopeRoot,
} from '../../../../core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../../../core/customAgents/types';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';

const AGENT_SCAFFOLD_SYSTEM_MD = `# Role

Describe this agent's shared persona and working principles here.
Everything in \`base/\` is always injected for every job of this agent.
Put long, situational material into \`injections/\` instead — the runtime
shows a table of contents and loads files on demand.
`;

const JOB_SCAFFOLD_SYSTEM_MD = `# Job Procedure

Describe what this job does, step by step, and what a good result looks like.
This file is always injected on top of the agent's shared \`base/\` prose.
`;

function scaffoldAgent(agentDir: string, id: string, name: string, description: string): void {
  fs.mkdirSync(path.join(agentDir, 'base'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'injections'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.yaml'), yaml.dump({ id, name, description, version: 1 }), 'utf-8');
  fs.writeFileSync(path.join(agentDir, 'base', 'system.md'), AGENT_SCAFFOLD_SYSTEM_MD, 'utf-8');
}

function scaffoldJob(jobDir: string, id: string, name: string, description: string): void {
  fs.mkdirSync(path.join(jobDir, 'base'), { recursive: true });
  fs.mkdirSync(path.join(jobDir, 'injections'), { recursive: true });
  fs.writeFileSync(
    path.join(jobDir, 'job.yaml'),
    yaml.dump({ id, name, description, version: 1, outputs: { mode: 'free' } }),
    'utf-8',
  );
  fs.writeFileSync(path.join(jobDir, 'base', 'system.md'), JOB_SCAFFOLD_SYSTEM_MD, 'utf-8');
}

/** Patch top-level yaml fields in place, preserving the rest of the document. */
function patchYamlFile(filePath: string, patch: Record<string, unknown>): void {
  const doc = (yaml.load(fs.readFileSync(filePath, 'utf-8')) ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) doc[k] = v;
  }
  fs.writeFileSync(filePath, yaml.dump(doc), 'utf-8');
}

export function createCustomAgentRoutes(deps: { workspaceResolver: WorkspaceResolver }): Router {
  const router = Router();

  function scopeRootsFor(req: Request, projectId: string): CustomAgentScopeRoot[] {
    const userContext = extractUserContext(req);
    const projectPath = deps.workspaceResolver.getProjectPath(userContext, projectId);
    return deriveCustomAgentScopeRoots(projectPath);
  }

  function findWritableAgent(
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
    if (found.scopeRoot.readonly) {
      res.status(403).json({ error: `Custom agent "${agentId}" is read-only (scope: ${found.scopeRoot.scope})` });
      return null;
    }
    return found;
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
      const { id, name, description = '', scope = 'project' } = req.body ?? {};
      if (!isValidCustomId(id ?? '')) {
        return res.status(400).json({ error: `Agent id must match [a-z0-9-]+ (got: ${String(id)})` });
      }
      if (scope !== 'project' && scope !== 'user') {
        return res.status(400).json({ error: `scope must be "project" | "user" (org agents are managed by the org)` });
      }
      const scopeRoots = scopeRootsFor(req, req.params.projectId);
      if (findAgentRoot(scopeRoots, id)) {
        return res.status(409).json({ error: `Custom agent already exists: ${id}` });
      }
      const root = scopeRoots.find((r) => r.scope === scope)!;
      const agentDir = path.join(root.root, id);
      scaffoldAgent(agentDir, id, name || id, description);
      logger.info(`Custom agent scaffolded: ${id} (scope: ${scope})`, { component: 'CustomAgents' });
      res.status(201).json({ id, name: name || id, description, scope, readonly: false, jobs: [] });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.patch('/projects/:projectId/custom-agents/:agentId', (req: Request, res: Response) => {
    try {
      const found = findWritableAgent(res, scopeRootsFor(req, req.params.projectId), req.params.agentId);
      if (!found) return;
      const { name, description } = req.body ?? {};
      patchYamlFile(path.join(found.agentDir, 'agent.yaml'), { name, description });
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
      const { id, name, description = '' } = req.body ?? {};
      if (!isValidCustomId(id ?? '')) {
        return res.status(400).json({ error: `Job id must match [a-z0-9-]+ (got: ${String(id)})` });
      }
      const jobDir = path.join(found.agentDir, 'jobs', id);
      if (fs.existsSync(jobDir)) {
        return res.status(409).json({ error: `Custom job already exists: ${req.params.agentId}/${id}` });
      }
      scaffoldJob(jobDir, id, name || id, description);
      logger.info(`Custom job scaffolded: ${req.params.agentId}/${id}`, { component: 'CustomAgents' });
      res.status(201).json({ id, name: name || id, description });
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
      const { name, description } = req.body ?? {};
      patchYamlFile(jobYaml, { name, description });
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
        outputsMode: resolved.outputs.mode,
        workspace: resolved.workspace,
      });
    } catch (error: any) {
      if (error instanceof CustomAgentValidationError) {
        return res.status(400).json({ valid: false, error: error.message });
      }
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  // ── threads (conversation containers under a custom job) ───────────────

  router.get('/projects/:projectId/custom-agents/:agentId/jobs/:jobId/threads', (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const { projectId, agentId, jobId } = req.params;
      if (!isValidCustomId(agentId) || !isValidCustomId(jobId)) {
        return res.status(400).json({ error: 'Invalid agent/job id' });
      }
      const projectPath = deps.workspaceResolver.getProjectPath(userContext, projectId);
      const threadsDir = path.join(projectPath, 'universal', 'agents', agentId, jobId, 'threads');
      if (!fs.existsSync(threadsDir)) return res.json({ threads: [] });
      const threads = fs
        .readdirSync(threadsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && isValidCustomId(e.name))
        .map((e) => {
          const sessionPath = path.join(threadsDir, e.name, 'sessions', 'universal', 'universal.json');
          let lastActiveAt: string | null = null;
          let jobIdInSession: string | null = null;
          try {
            const stat = fs.statSync(sessionPath);
            lastActiveAt = stat.mtime.toISOString();
            jobIdInSession = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))?.state?.jobId ?? null;
          } catch { /* fresh thread without a session yet */ }
          return { threadId: e.name, lastActiveAt, jobId: jobIdInSession };
        })
        .sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''));
      res.json({ threads });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  // ── universal artifact tree (project-shared working tree, D6) ──────────

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  function artifactsRootFor(req: Request, projectId: string): string {
    const userContext = extractUserContext(req);
    return deps.workspaceResolver.getUniversalArtifactsPath(userContext, projectId);
  }

  /** Path-traversal-safe resolve inside the artifacts root. */
  function resolveArtifactPath(root: string, rel: string): string {
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Invalid artifact path: ${rel}`);
    }
    return full;
  }

  interface ArtifactTreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    children?: ArtifactTreeNode[];
  }

  function buildTree(root: string, rel = ''): ArtifactTreeNode[] {
    const abs = rel ? path.join(root, rel) : root;
    if (!fs.existsSync(abs)) return [];
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
      .map((e) => {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          return { name: e.name, path: childRel, type: 'directory' as const, children: buildTree(root, childRel) };
        }
        const size = fs.statSync(path.join(abs, e.name)).size;
        return { name: e.name, path: childRel, type: 'file' as const, size };
      });
  }

  router.get('/projects/:projectId/universal/artifacts/tree', (req: Request, res: Response) => {
    try {
      const root = artifactsRootFor(req, req.params.projectId);
      res.json({ tree: buildTree(root) });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  router.post('/projects/:projectId/universal/artifacts/upload', upload.array('files'), async (req: Request, res: Response) => {
    try {
      const root = artifactsRootFor(req, req.params.projectId);
      const dirPath = (req.body.dirPath || '').replace(/\\/g, '/');
      const files = (req.files as Express.Multer.File[]) || [];
      const rawRelPaths = req.body.relativePaths;
      const relativePaths: string[] = Array.isArray(rawRelPaths) ? rawRelPaths : rawRelPaths ? [rawRelPaths] : [];

      const uploadedFiles: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const relPath = (relativePaths[i] || files[i].originalname).replace(/\\/g, '/');
        const filePath = resolveArtifactPath(root, path.join(dirPath, relPath));
        // Byte-safe write (size + header verification) — uploads must survive
        // binary payloads unmodified (no utf-8 round-trip).
        await writeBufferVerified(filePath, files[i].buffer);
        uploadedFiles.push(path.join(dirPath, relPath).replace(/\\/g, '/'));
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
      const root = artifactsRootFor(req, req.params.projectId);
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path query param is required' });
      const full = resolveArtifactPath(root, rel);
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        return res.status(404).json({ error: `Artifact not found: ${rel}` });
      }
      res.download(full);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  router.post('/projects/:projectId/universal/artifacts/mkdir', (req: Request, res: Response) => {
    try {
      const root = artifactsRootFor(req, req.params.projectId);
      const rel = String(req.body?.path || '');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      fs.mkdirSync(resolveArtifactPath(root, rel), { recursive: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  return router;
}
