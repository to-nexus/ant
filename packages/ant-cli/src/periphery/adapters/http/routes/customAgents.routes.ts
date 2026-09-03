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
import { isReservedSessionRelativePath } from '../../../../core/utils/sessionPaths';
import * as yaml from 'js-yaml';
import multer from 'multer';
import { writeBufferVerifiedContained } from '../../../../core/utils/binaryIntegrity';
import { isBinaryPath, sniffBufferKind, SNIFF_BYTES } from '../../../../core/utils/binaryExtensions';
import { detectImageMimeFromBuffer } from '../../../../core/utils/imageMime';
import { toNfc } from '../../../../core/utils/unicodePath';
import { boundedMultipart } from '../middleware/boundedMultipart';
import { treeRateLimiter } from '../middleware/rateLimiter';
import { acquireConcurrencySlot } from '../../../../core/redis/concurrencySlot';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { isValidCustomId, UNIVERSAL_FEATURE } from '@ant/shared';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import { WorkspacePathResolver } from '../../../../core/config/WorkspacePathResolver';
import {
  toBaseRelative,
  statContainedBase,
  rmrfContainedBase,
  clearContainedBase,
  createExclusiveContainedBase,
  mkdirpContainedBase,
  renameContainedBase,
  type BaseRelative,
} from '../../../../core/config/containedIo';
import type { OrganizationRepositoryPort } from '../../../../core/ports/organizationRepository';
import { deriveCustomAgentScopeRootsForTenant } from '../../../../core/customAgents/scopeRoots';
import {
  UNIVERSAL_ARTIFACT_CANONICAL_DIRS,
  UNIVERSAL_SESSIONS_NODE,
  UNIVERSAL_PIPELINE_RUNS_NODE,
  UNIVERSAL_AGENTS_NODE,
  buildUniversalMergedTree,
  resolveUniversalMergedPath,
  type UniversalTreeNode,
  buildUniversalMergedTreeResult,
} from '../../../../core/customAgents/universalContainer';
import {
  discoverAgents,
  findCreateCollision,
  loadCustomJob,
  type CustomAgentScopeRoot,
} from '../../../../core/customAgents/CustomAgentLoader';
import { CustomAgentValidationError } from '../../../../core/customAgents/types';
import {
  createCollisionMessage,
  decorateOrgAgentSummaries,
  findWritableAgent,
  patchYamlFile,
  scaffoldAgent,
  scaffoldJob,
} from './helpers/customAgentHandlers';
import { createOrgGateResolver, readOrgAgentAcl, updateOrgAgentAcl } from './helpers/orgAclStore';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';
import { UPLOAD_LIMITS } from '../../../../core/config/uploadLimits';

export function createCustomAgentRoutes(deps: {
  workspaceResolver: WorkspaceResolver;
  organizationRepository: OrganizationRepositoryPort;
  /** Same shape as `files.routes.ts` — one type, no drift. */
  fileTreeNotifier?: { notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): Promise<void> };
  /** Backs the per-account concurrency budget on the tree scan. */
  stateStore?: StateStorePort;
}): Router {
  const router = Router();

  function scopeRootsFor(req: Request): CustomAgentScopeRoot[] {
    // Definitions are account/org-owned — the projectId in the URL scopes the
    // container endpoints below, never the definition roots. Local-mode
    // tenant resolution (including project-id inference) is extractUserContext's job.
    const userContext = extractUserContext(req);
    return deriveCustomAgentScopeRootsForTenant({
      workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(),
      userId: userContext.userId,
      organizationId: userContext.organizationId,
      organizationKind: userContext.organizationKind ?? 'local',
    });
  }

  /** Request-memoized org write gate — mirrors the account mount (no drift). */
  const orgGateFor = createOrgGateResolver(
    {
      organizationRepository: deps.organizationRepository,
      workspacesPath: deps.workspaceResolver.getPhysicalWorkspacesPath(),
    },
    readOrgAgentAcl,
  );

  // ── agents ─────────────────────────────────────────────────────────────

  router.get('/projects/:projectId/custom-agents', async (req: Request, res: Response) => {
    try {
      const scopeRoots = scopeRootsFor(req);
      let agents = discoverAgents(scopeRoots);
      if (extractUserContext(req).organizationKind === 'team') {
        agents = decorateOrgAgentSummaries(agents, scopeRoots, await orgGateFor(req)());
      }
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
      const scopeRoots = scopeRootsFor(req);
      const collision = findCreateCollision(scopeRoots, id);
      if (collision) {
        return res.status(409).json({ error: createCollisionMessage(id, collision) });
      }
      // Definitions are account-owned: creation always targets the writable user root.
      const root = scopeRoots.find((r) => r.scope === 'user' && !r.readonly)!;
      const agentDir = path.join(root.root, id);
      scaffoldAgent(agentDir, id, name || id);
      logger.info(`Custom agent scaffolded: ${id} (scope: user)`, { component: 'CustomAgents' });
      res.status(201).json({ id, name: name || id, scope: 'user', readonly: false, jobs: [] });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.patch('/projects/:projectId/custom-agents/:agentId', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const { name } = req.body ?? {};
      patchYamlFile(path.join(found.agentDir, 'agent.yaml'), { name });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.delete('/projects/:projectId/custom-agents/:agentId', async (req: Request, res: Response) => {
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
      logger.info(`Custom agent deleted: ${req.params.agentId}`, { component: 'CustomAgents' });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  // ── jobs (agent context only) ──────────────────────────────────────────

  router.get('/projects/:projectId/custom-agents/:agentId/jobs', (req: Request, res: Response) => {
    try {
      const scopeRoots = scopeRootsFor(req);
      const agents = discoverAgents(scopeRoots);
      const agent = agents.find((a) => a.id === req.params.agentId);
      if (!agent) return res.status(404).json({ error: `Custom agent not found: ${req.params.agentId}` });
      res.json({ jobs: agent.jobs });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.post('/projects/:projectId/custom-agents/:agentId/jobs', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
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

  router.patch('/projects/:projectId/custom-agents/:agentId/jobs/:jobId', async (req: Request, res: Response) => {
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
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  router.delete('/projects/:projectId/custom-agents/:agentId/jobs/:jobId', async (req: Request, res: Response) => {
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
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  // ── job validation (dry check — surfaces loader 400s before a run) ─────

  router.get('/projects/:projectId/custom-agents/:agentId/jobs/:jobId/validate', (req: Request, res: Response) => {
    try {
      const scopeRoots = scopeRootsFor(req);
      const resolved = loadCustomJob(scopeRoots, req.params.agentId, req.params.jobId);
      const advisories = resolved.advisories ?? [];
      res.json({
        // Advisories (H9-class) load fine but fail validation — see the
        // account-agents validate route for the rationale.
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
      sendErrorResponse(res, 500, error, 'CustomAgents');
    }
  });

  // ── universal artifact tree (project-shared working tree, D6) ──────────

  const upload = multer({ storage: multer.memoryStorage(), limits: UPLOAD_LIMITS });

  /** Reserved top-level node name — the grafted sessions folder (see tree). */
  const SESSIONS_NODE = UNIVERSAL_SESSIONS_NODE;
  /** Reserved top-level node name — grafted pipeline run logs (read-only). */
  const PIPELINE_RUNS_NODE = UNIVERSAL_PIPELINE_RUNS_NODE;

  /**
   * First segment of the NORMALIZED path. `artifacts/../sessions` has a first
   * segment of `artifacts` but resolves into the grafted reserved tree, and the
   * merged-path resolver normalizes before writing — so the verdict has to be
   * taken on the same shape the write lands on (M-NEW-029).
   */
  function firstSegment(rel: string): string {
    const cleaned = (rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (cleaned === '') return '';
    return path.posix.normalize(cleaned).split('/')[0] ?? '';
  }

  /** 400 body for a mutation aimed at a reserved grafted root, or null. */
  function reservedRootViolation(rel: string): { error: string; code: string } | null {
    const first = firstSegment(rel);
    // Sessions verdict has one owner across both planes (files.routes.ts uses
    // the same predicate for the canonical feature root).
    if (isReservedSessionRelativePath(rel) || first === SESSIONS_NODE) {
      return { error: `"${SESSIONS_NODE}" is a reserved name at the workspace root`, code: 'reserved-name-sessions' };
    }
    if (first === PIPELINE_RUNS_NODE) {
      return { error: `"${PIPELINE_RUNS_NODE}" is a read-only pipeline run-log folder`, code: 'reserved-name-pipeline-runs' };
    }
    if (first === UNIVERSAL_AGENTS_NODE) {
      return { error: `"${UNIVERSAL_AGENTS_NODE}" is the read-only agent-definition mount`, code: 'reserved-name-agents' };
    }
    return null;
  }

  /** Account scope for the cluster-wide concurrency budget. */
  function accountSlotKey(req: Request): string {
    const ctx = extractUserContext(req);
    return `${ctx.organizationId}:${ctx.userId}`;
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

  /**
   * Base-relative descent handle for a merged artifact path, so every mutation
   * below (delete/create/rename/mkdir) binds to the descent instead of
   * re-opening the resolved name — a reparented container root cannot redirect
   * the mutation to another tenant's tree (H-017). `undefined` out-of-base
   * (repoType:local) → caller keeps the raw fs op.
   */
  function mergedBaseRel(req: Request, projectId: string, rel: string): BaseRelative | undefined {
    return toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), resolveMergedPath(req, projectId, rel));
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

  // One sub-router for the whole artifacts mount so the tree notify has a
  // single owner. `files.routes.ts` hand-copies its notify at five call sites;
  // a mount-level hook means a seventh route cannot be added without it.
  // `mergeParams` is REQUIRED — without it `req.params.projectId` is undefined
  // and the notify silently addresses a bogus project.
  const artifacts = Router({ mergeParams: true });
  router.use('/projects/:projectId/universal/artifacts', artifacts);

  artifacts.use((req: Request, res: Response, next) => {
    if (req.method === 'GET') return next();
    // `finish` fires after the response, so the broadcast never adds latency to
    // the mutation. The initiating tab already refetches on its own; this is
    // what reaches every OTHER client of the workspace.
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      void deps.fileTreeNotifier
        ?.notifyFileTreeUpdate(req.params.projectId, UNIVERSAL_FEATURE, extractUserContext(req))
        .catch(() => {});
    });
    next();
  });

  artifacts.get('/tree', treeRateLimiter, async (req: Request, res: Response) => {
    // One scan at a time per account, cluster-wide. The enumeration budget bounds a
    // single scan; without this an account simply runs many bounded scans in
    // parallel and occupies the shared pod anyway (H-008).
    const stateStore = deps.stateStore;
    const slot = stateStore
      ? await acquireConcurrencySlot(stateStore, `ant:slots:tree:${accountSlotKey(req)}`, {
          limit: 2,
          ttlSeconds: 60,
        })
      : { release: async () => {} };
    if (!slot) {
      return res.status(429).json({
        code: 'TREE_SCAN_IN_PROGRESS',
        error: 'Too many concurrent file-tree scans',
        message: 'A file-tree scan is already running for your account. Try again shortly.',
      });
    }

    try {
      // Assembly SSOT — universalContainer.buildUniversalMergedTreeResult (shared
      // with FileOperationService.getFileTree; single implementation, no drift).
      const tree = buildUniversalMergedTreeResult(containerRootFor(req, req.params.projectId));
      res.json({
        tree: tree.nodes.map(toApiNode),
        // Additive: only present when the artifacts root itself was cut short.
        ...(tree.truncated ? { truncated: true } : {}),
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    } finally {
      await slot.release();
    }
  });

  artifacts.post('/upload', ...boundedMultipart(), upload.array('files'), async (req: Request, res: Response) => {
    try {
      const dirPath = (req.body.dirPath || '').replace(/\\/g, '/');
      const files = (req.files as Express.Multer.File[]) || [];
      const rawRelPaths = req.body.relativePaths;
      const relativePaths: string[] = Array.isArray(rawRelPaths) ? rawRelPaths : rawRelPaths ? [rawRelPaths] : [];

      const uploadedFiles: string[] = [];
      const rejected: Array<{ path: string; reason: string }> = [];
      for (let i = 0; i < files.length; i++) {
        // NFC at ingestion — see files.routes.ts upload route.
        const relPath = toNfc(relativePaths[i] || files[i].originalname).replace(/\\/g, '/');
        const effectiveRel = path.join(dirPath, relPath).replace(/\\/g, '/');
        const uploadViolation = reservedRootViolation(effectiveRel);
        if (uploadViolation) return res.status(400).json(uploadViolation);

        // Consumability gate — a file is admitted iff the agent plane has a
        // channel that consumes it, and the BYTES decide (extensions never):
        //   text  (utf-8)                      → read_file / search_files
        //   image (magic bytes png/jpeg/webp/gif, the vision SSOT) → vision
        // Everything else has no channel and is refused loudly at ingress
        // instead of riding along as dead weight; a folder upload sheds only
        // the unconsumable members and names each one.
        const buf = files[i].buffer;
        const head = buf.subarray(0, SNIFF_BYTES);
        const isImage = detectImageMimeFromBuffer(head) !== null;
        if (!isImage) {
          const kind = isBinaryPath(effectiveRel) ? 'binary' : sniffBufferKind(head, buf.length > head.length);
          if (kind !== 'text') {
            rejected.push({
              path: effectiveRel,
              reason:
                kind === 'binary'
                  ? 'binary file — agents cannot read it; convert to a text format (CSV / Markdown / JSON). Images are accepted as PNG / JPEG / WebP / GIF.'
                  : 'not valid UTF-8 text — re-save with UTF-8 encoding (e.g. Excel "CSV UTF-8")',
            });
            continue;
          }
        }

        const filePath = resolveMergedPath(req, req.params.projectId, effectiveRel);
        // Byte-safe write (size + header verification) — admitted text must
        // land exactly as sent. The container root is the boundary the write
        // descends from.
        await writeBufferVerifiedContained(containerRootFor(req, req.params.projectId), filePath, files[i].buffer);
        uploadedFiles.push(effectiveRel);
      }
      if (uploadedFiles.length === 0 && rejected.length > 0) {
        return res.status(415).json({
          code: 'UNREADABLE_FILES',
          message: 'No file was uploaded: none is consumable by the agent (UTF-8 text, or a PNG / JPEG / WebP / GIF image).',
          uploadedFiles,
          count: 0,
          rejected,
        });
      }
      res.json({
        success: true,
        uploadedFiles,
        count: uploadedFiles.length,
        ...(rejected.length > 0 && { rejected }),
      });
    } catch (error: any) {
      if (error?.code === 'CORRUPTED_FILE') {
        return res.status(422).json({ code: 'CORRUPTED_FILE', message: error.message, filename: error.filename });
      }
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  // Download has one owner: GET /projects/:id/features/:feature/download
  // (files.routes.ts) — it resolves the universal pseudo-feature through the
  // same merged-view SSOT and zip-streams directories.

  artifacts.delete('/file', (req: Request, res: Response) => {
    try {
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path query param is required' });
      // Run logs are never deletable — not even root-clear (history SSOT).
      if (firstSegment(rel) === PIPELINE_RUNS_NODE) {
        return res.status(400).json({
          error: `"${PIPELINE_RUNS_NODE}" is a read-only pipeline run-log folder`,
          code: 'reserved-name-pipeline-runs',
        });
      }
      const full = resolveMergedPath(req, req.params.projectId, rel);
      const br = mergedBaseRel(req, req.params.projectId, rel);
      const isCanonicalRoot =
        rel === SESSIONS_NODE || (UNIVERSAL_ARTIFACT_CANONICAL_DIRS as readonly string[]).includes(rel);
      if (br) {
        if (!statContainedBase(br).ok) return res.status(404).json({ error: `Artifact not found: ${rel}` });
        // Canonical roots are clearable, never removable (codespace parity).
        if (isCanonicalRoot) {
          const cleared = clearContainedBase(br);
          if (!cleared.ok) return res.status(500).json({ error: `Clear failed: ${cleared.reason}` });
          return res.json({ success: true, cleared: true });
        }
        const removed = rmrfContainedBase(br);
        if (!removed.ok) return res.status(500).json({ error: `Delete failed: ${removed.reason}` });
        return res.json({ success: true });
      }
      if (!fs.existsSync(full)) {
        return res.status(404).json({ error: `Artifact not found: ${rel}` });
      }
      if (isCanonicalRoot) {
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

  artifacts.post('/create-file', (req: Request, res: Response) => {
    try {
      const rel = String(req.body?.path || '').replace(/\\/g, '/');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      const createViolation = reservedRootViolation(rel);
      if (createViolation) return res.status(400).json(createViolation);
      const full = resolveMergedPath(req, req.params.projectId, rel);
      const br = mergedBaseRel(req, req.params.projectId, rel);
      if (br) {
        if (statContainedBase(br).ok) return res.status(409).json({ error: `Already exists: ${rel}` });
        const created = createExclusiveContainedBase(br);
        if (!created.ok) return res.status(500).json({ error: `Create failed: ${created.reason}` });
        return res.json({ success: true });
      }
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

  artifacts.post('/rename', (req: Request, res: Response) => {
    try {
      const rel = String(req.body?.path || '').replace(/\\/g, '/');
      const newName = String(req.body?.newName || '');
      if (!rel || !newName) return res.status(400).json({ error: 'path and newName are required' });
      if (newName.includes('/') || newName.includes('\\') || newName.startsWith('.')) {
        return res.status(400).json({ error: `Invalid name: ${newName}` });
      }
      if (reservedRootViolation(rel) || (UNIVERSAL_ARTIFACT_CANONICAL_DIRS as readonly string[]).includes(rel)) {
        return res.status(400).json({ error: `"${rel}" cannot be renamed` });
      }
      const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (!parentRel && (newName === SESSIONS_NODE || newName === PIPELINE_RUNS_NODE || (UNIVERSAL_ARTIFACT_CANONICAL_DIRS as readonly string[]).includes(newName))) {
        return res.status(400).json({ error: `"${newName}" is a reserved name at the workspace root`, code: 'reserved-name-sessions' });
      }
      const toRel = parentRel ? `${parentRel}/${newName}` : newName;
      const from = resolveMergedPath(req, req.params.projectId, rel);
      const to = resolveMergedPath(req, req.params.projectId, toRel);
      const brFrom = mergedBaseRel(req, req.params.projectId, rel);
      const brTo = mergedBaseRel(req, req.params.projectId, toRel);
      if (brFrom && brTo && brFrom.base === brTo.base) {
        if (!statContainedBase(brFrom).ok) return res.status(404).json({ error: `Artifact not found: ${rel}` });
        if (statContainedBase(brTo).ok) return res.status(409).json({ error: `Already exists: ${newName}` });
        const moved = renameContainedBase(brFrom.base, brFrom.relative, brTo.relative);
        if (!moved.ok) return res.status(500).json({ error: `Rename failed: ${moved.reason}` });
        return res.json({ success: true });
      }
      if (!fs.existsSync(from)) return res.status(404).json({ error: `Artifact not found: ${rel}` });
      if (fs.existsSync(to)) return res.status(409).json({ error: `Already exists: ${newName}` });
      fs.renameSync(from, to);
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  artifacts.post('/mkdir', (req: Request, res: Response) => {
    try {
      const rel = String(req.body?.path || '');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      const mkdirViolation = reservedRootViolation(rel);
      if (mkdirViolation) return res.status(400).json(mkdirViolation);
      const br = mergedBaseRel(req, req.params.projectId, rel);
      if (br) {
        const made = mkdirpContainedBase(br);
        if (!made.ok) return res.status(500).json({ error: `mkdir failed: ${made.reason}` });
        return res.json({ success: true });
      }
      fs.mkdirSync(resolveMergedPath(req, req.params.projectId, rel), { recursive: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'UniversalArtifacts');
    }
  });

  return router;
}
