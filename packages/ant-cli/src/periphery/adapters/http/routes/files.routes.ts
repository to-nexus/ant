import { Router, Request, Response, type RequestHandler } from 'express';
import { registerFeatureParamDecoders, decodeFeatureSegment } from './helpers/featureParam';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import archiver from 'archiver';
import { ProjectService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { getRealtimeBroadcastChannel } from '../../../../infrastructure/state/redisConstants';
import { getArtifactDirPolicy, validateFileForDir } from '@ant/shared';
import { writeBufferVerifiedAbs, verifyBufferIntegrity } from '../../../../core/utils/binaryIntegrity';
import { boundedMultipart } from '../middleware/boundedMultipart';
import {
  downloadRateLimiter,
  forceRefreshRateLimiter,
  treeRateLimiter,
} from '../middleware/rateLimiter';
import { acquireLock } from '../../../../core/redis/distributedLock';
import { acquireConcurrencySlot } from '../../../../core/redis/concurrencySlot';
import { assertWithinRoot } from '../../../../core/config/pathContainment';
import { resolveFeatureScopedFilePath, measureArchiveInput } from './helpers/featureFiles';
import { UPLOAD_LIMITS } from '../../../../core/config/uploadLimits';
import { mkdirpContainedBase, renameContainedBase, toBaseRelative } from '../../../../core/config/containedIo';
import { WorkspacePathResolver } from '../../../../core/config/WorkspacePathResolver';

/**
 * `mkdir -p featurePath/relDir` bound to the physical workspace base by
 * descriptor descent, so a preview child that swaps an intermediate directory
 * (or the feature root itself) after `assertWithinRoot` cannot redirect the
 * mkdir outside the feature (M-NEW-003, M-NEW-018). Targets outside the
 * multi-tenant base (`repoType:'local'`) keep the plain recursive mkdir — the
 * single-developer trust boundary. Returns false to fail closed.
 */
async function mkdirpContainedOrLegacy(featurePath: string, relDir: string): Promise<boolean> {
  const absTarget = path.resolve(featurePath, relDir);
  const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), absTarget);
  if (br) return mkdirpContainedBase(br).ok === true;
  await fs.promises.mkdir(absTarget, { recursive: true });
  return true;
}

/**
 * Move `featurePath/oldRel` → `featurePath/newRel` bound to the physical
 * workspace base by descriptor descent on both parents (M-NEW-018). Legacy
 * name-based rename only for out-of-base (`repoType:'local'`) targets.
 */
async function renameContainedOrLegacy(featurePath: string, oldRel: string, newRel: string): Promise<boolean> {
  const base = WorkspacePathResolver.getPhysicalWorkspacesPath();
  const oldBr = toBaseRelative(base, path.resolve(featurePath, oldRel));
  const newBr = toBaseRelative(base, path.resolve(featurePath, newRel));
  if (oldBr && newBr && oldBr.base === newBr.base) {
    const parent = path.dirname(newBr.relative);
    if (parent && parent !== '.' && !mkdirpContainedBase({ base: newBr.base, relative: parent }).ok) return false;
    return renameContainedBase(oldBr.base, oldBr.relative, newBr.relative).ok === true;
  }
  await fs.promises.mkdir(path.dirname(path.resolve(featurePath, newRel)), { recursive: true });
  await fs.promises.rename(path.resolve(featurePath, oldRel), path.resolve(featurePath, newRel));
  return true;
}

/**
 * File operations (read, write, delete, upload)
 */
/** Single-flight window for a forced tree scan. Above a normal walk, below a timeout. */
const FILE_TREE_SCAN_LOCK_TTL_SECONDS = 30;
const FILE_TREE_SCAN_WAIT_MS = 250;
const FILE_TREE_SCAN_WAIT_ATTEMPTS = 8;

/**
 * The forced-refresh budget applies only to the bypass, not to normal cached reads
 * — a limiter on every tree read would throttle ordinary UI polling.
 */
const forceRefreshOnly: RequestHandler = (req, res, next) =>
  req.query.force === 'true' ? forceRefreshRateLimiter(req, res, next) : next();

/** Simultaneous directory ZIP streams per account, cluster-wide. */
const DIRECTORY_DOWNLOAD_MAX_INFLIGHT = 2;
/** Entries and raw bytes one archive may cover. */
const DIRECTORY_DOWNLOAD_MAX_ENTRIES = 20_000;
const DIRECTORY_DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export function createFilesRoutes(deps: {
  projectService: ProjectService;
  stateStore?: StateStorePort;
  fileTreeNotifier?: { notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): Promise<void> };
}): Router {
  const router = Router();
  registerFeatureParamDecoders(router);

  const getMimeTypeFromPath = (filePath: string): string => {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      case '.avif':
        return 'image/avif';
      case '.ico':
        return 'image/x-icon';
      case '.svg':
        return 'image/svg+xml';
      // Text types matter beyond cosmetics: a design handoff bundle is browsed
      // as a mini static site (screens link `../styles.css`), and a stylesheet
      // served as octet-stream is refused outright by strict MIME checking.
      case '.html':
      case '.htm':
        return 'text/html; charset=utf-8';
      case '.css':
        return 'text/css; charset=utf-8';
      case '.js':
      case '.mjs':
        return 'text/javascript; charset=utf-8';
      case '.json':
        return 'application/json; charset=utf-8';
      case '.txt':
      case '.md':
        return 'text/plain; charset=utf-8';
      case '.woff':
        return 'font/woff';
      case '.woff2':
        return 'font/woff2';
      case '.ttf':
        return 'font/ttf';
      case '.otf':
        return 'font/otf';
      default:
        return 'application/octet-stream';
    }
  };

  /**
   * Workspace HTML is LLM-authored. Serving it inline on the app origin would
   * otherwise be stored XSS, so scripts are cut at the response level — the
   * policy still allows everything a design specimen needs (sibling stylesheets,
   * inline `<style>`, svg/data images, fonts).
   */
  const HTML_PREVIEW_CSP =
    "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'self'";

  /**
   * Anchor a caller-supplied write target under `rootDir` AND under the feature
   * root. The former keeps a per-file path inside the directory the caller
   * chose; the latter is the tenancy boundary and is asserted independently.
   *
   * Uses the containment SSOT rather than a string prefix test: a symlink
   * already planted inside the feature tree passes `startsWith` but redirects
   * the write out of the workspace (H-007).
   */
  const resolveWriteTarget = (rootDir: string, featureRoot: string, relativeFilePath: string): string => {
    const full = assertWithinRoot(rootDir, relativeFilePath);
    assertWithinRoot(featureRoot, full);
    return full;
  };

  // Configure multer for file uploads (use memory storage)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: UPLOAD_LIMITS,
  });
  
  /**
   * Get file tree for a feature.
   *
   * `force=true` exists to pick up filesystem changes ANT did not make, so it must
   * keep bypassing the cache. What it must NOT keep doing is start a fresh
   * recursive scan per request with no coordination: the mutation-side
   * single-flight lives in `WorkflowBridge` and is process-local, so concurrent
   * forced reads — including across pods — each ran the whole walk (M-009).
   *
   * Two gates, both cluster-wide:
   *   - a refresh budget (`forceRefreshRateLimiter`), because each bypass is a full
   *     filesystem walk;
   *   - a Redis single-flight per `(org,user,project,feature)`: the lock owner scans
   *     and caches, and a loser waits briefly and reads the cache the owner just
   *     wrote rather than starting a second scan.
   */
  router.get('/projects/:id/features/:feature/files', treeRateLimiter, forceRefreshOnly, async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);
      const forceRefresh = req.query.force === 'true';

      // An arbitrary `:feature` slug would otherwise scan to a synthetic root
      // tree and persist a 24h Redis cache key for a feature that was never
      // created (M-NEW-008). Resolve the authoritative reference first.
      const existingFeaturePath = await deps.projectService.resolveExistingFeatureForMutation(
        projectId,
        featureName,
        userContext,
      );
      if (!existingFeaturePath) {
        return res.status(404).json({ error: 'Feature not found' });
      }

      const readCache = async () => {
        if (!deps.stateStore) return null;
        try {
          return await deps.stateStore.getFileTreeCache(userContext.userId, projectId, featureName);
        } catch {
          return null; // Fall through to EFS on Redis error
        }
      };

      // Redis cache first (bypasses EFS/NFS attribute caching in multi-pod cloud deployments)
      // Skip cache when force=true (handles external filesystem changes not tracked by ANT)
      if (!forceRefresh) {
        const cached = await readCache();
        if (cached) return res.json(cached);
      }

      const scanAndCache = async () => {
        const tree = await deps.projectService.getFileTree(projectId, featureName, userContext);
        if (deps.stateStore && tree) {
          await deps.stateStore
            .setFileTreeCache(userContext.userId, projectId, featureName, tree)
            .catch(() => {});
        }
        return tree;
      };

      if (!deps.stateStore) {
        return res.json(await scanAndCache());
      }

      // Both the cold-cache miss AND force=true reach the SAME unbounded scan
      // sink, so both go through the per-feature single-flight — otherwise a
      // cache-miss stampede (many pods, empty cache) each ran a full walk (M-009).
      const lockKey = `ant:lock:filetree:${userContext.organizationId}:${userContext.userId}:${projectId}:${featureName}`;
      const lock = await acquireLock(deps.stateStore, lockKey, FILE_TREE_SCAN_LOCK_TTL_SECONDS);
      if (lock) {
        try {
          return res.json(await scanAndCache());
        } finally {
          await lock.release();
        }
      }

      // Someone else is scanning the same scope. Wait out a short window for the
      // cache they are about to write; only then tell the client to retry. Falling
      // back to our own scan here would defeat the single-flight entirely.
      for (let attempt = 0; attempt < FILE_TREE_SCAN_WAIT_ATTEMPTS; attempt++) {
        await new Promise(resolve => setTimeout(resolve, FILE_TREE_SCAN_WAIT_MS));
        const cached = await readCache();
        if (cached) return res.json(cached);
      }
      res.setHeader('Retry-After', '2');
      return res.status(503).json({
        code: 'FILE_TREE_SCAN_IN_PROGRESS',
        error: 'File tree refresh in progress',
        message: 'A refresh for this feature is already running. Retry in a moment.',
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Files');
    }
  });
  
  /**
   * Get raw file bytes (binary-safe)
   * - Useful for images (png/jpg/webp/gif/svg) and other non-text files
   *
   * GET /projects/:id/features/:feature/files-raw/<path>
   */
  router.get(/^\/projects\/([^\/]+)\/features\/([^\/]+)\/files-raw\/(.+)$/, async (req: Request, res: Response) => {
    try {
      const projectId = req.params[0];
      const featureName = decodeFeatureSegment(req.params[1]);
      const filePath = req.params[2];

      if (!filePath) {
        res.status(400).json({ error: 'File path is required' });
        return;
      }

      const userContext = extractUserContext(req);
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      // Universal-aware seam (blob/image preview must reach the container).
      const fullPath = resolveFeatureScopedFilePath(workspaceResolver, userContext, projectId, featureName, filePath);

      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
          res.status(400).json({ error: 'Path is a directory, not a file' });
          return;
        }

        const buf = await fs.promises.readFile(fullPath);
        const mimeType = getMimeTypeFromPath(filePath);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'no-store');
        // The bytes are user- or LLM-authored and this route is same-origin, so
        // never let the browser re-sniff a type it was told.
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (mimeType.startsWith('text/html')) {
          res.setHeader('Content-Security-Policy', HTML_PREVIEW_CSP);
        }
        // SVG is an ACTIVE document: opened as a top-level navigation it runs
        // its own script/event handlers on the app origin, and the global CSP is
        // disabled. Serving it as an attachment removes that sink without
        // touching the UI's preview, which renders SVG through a blob `<img>`
        // (passive context) rather than this URL (M-001). Other image types stay
        // inline.
        const disposition = mimeType === 'image/svg+xml' ? 'attachment' : 'inline';
        res.setHeader(
          'Content-Disposition',
          `${disposition}; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
        );
        res.status(200).send(buf);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          res.status(404).json({ error: 'File not found' });
        } else {
          throw error;
        }
      }
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Files');
    }
  });
  
  // Get file content — returns FileResource (content + ground-truth meta)
  router.get(/^\/projects\/([^\/]+)\/features\/([^\/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
    try {
      const projectId = req.params[0];
      const featureName = decodeFeatureSegment(req.params[1]);
      const filePath = req.params[2];

      if (!filePath) {
        res.status(400).json({ error: 'File path is required' });
        return;
      }

      const userContext = extractUserContext(req);

      try {
        const resource = await deps.projectService.readFile(projectId, featureName, filePath, userContext);
        res.json(resource);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          res.status(404).json({ error: 'File not found' });
        } else if (error.code === 'EISDIR') {
          res.status(400).json({ error: 'Path is a directory, not a file' });
        } else if (error.code === 'BINARY_FILE') {
          res.status(422).json({ code: 'BINARY_FILE', message: error.message, size: error.size });
        } else {
          throw error;
        }
      }
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Files');
    }
  });
  
  // Update/Create file content — returns FileResource (normalized content + recomputed meta)
  router.put(/^\/projects\/([^\/]+)\/features\/([^\/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
    try {
      const projectId = req.params[0];
      const featureName = decodeFeatureSegment(req.params[1]);
      const filePath = req.params[2];
      const { content } = req.body;

      if (!filePath) {
        res.status(400).json({ error: 'File path is required' });
        return;
      }

      if (content === undefined) {
        res.status(400).json({ error: 'content is required' });
        return;
      }

      const userContext = extractUserContext(req);

      // Reject a write to a feature that was never created — otherwise the
      // recursive mkdir would materialize a ghost feature directory (M-NEW-017).
      if (!(await deps.projectService.resolveExistingFeatureForMutation(projectId, featureName, userContext))) {
        return res.status(404).json({ error: 'Feature not found' });
      }

      const parentDir = path.dirname(filePath).replace(/\\/g, '/');
      const extCheck = validateFileForDir(parentDir, path.basename(filePath));
      if (!extCheck.valid) {
        return res.status(422).json({
          code: 'INVALID_EXTENSION',
          message: extCheck.reason,
          allowed: extCheck.allowed,
        });
      }

      logger.debug(`[files.routes] Writing file: ${projectId}/${featureName}/${filePath}`);

      const resource = await deps.projectService.writeFile(
        projectId,
        featureName,
        filePath,
        content,
        userContext,
      );

      if (deps.fileTreeNotifier) {
        try { await deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext); } catch {}
      }

      res.json(resource);
    } catch (error: any) {
      if (error.code === 'BINARY_TARGET') {
        return res.status(422).json({ code: 'BINARY_TARGET', message: error.message });
      }
      logger.error('Error creating/updating file', { component: 'Files' }, error);
      sendErrorResponse(res, 500, error, 'Files');
    }
  });

  // Upload files to a feature directory
  router.post('/projects/:id/features/:feature/upload', ...boundedMultipart({ stateStore: deps.stateStore }), upload.array('files'), async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const dirPath = req.body.dirPath || '';
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files provided' });
        return;
      }
      
      const userContext = extractUserContext(req);
      if (!(await deps.projectService.resolveExistingFeatureForMutation(projectId, featureName, userContext))) {
        res.status(404).json({ error: 'Feature not found' });
        return;
      }
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      // `dirPath` is caller-supplied. `resolveWriteTarget` below anchors each
      // per-file path to `baseDir`, so an escaped baseDir would be honoured —
      // containment has to be asserted here too, against the feature root.
      let baseDir: string;
      try {
        baseDir = assertWithinRoot(featurePath, dirPath);
      } catch {
        res.status(400).json({ error: 'Invalid directory path' });
        return;
      }

      // Ensure base directory exists — descriptor-descended from the workspace
      // base so a swapped intermediate cannot redirect it (M-NEW-003).
      const baseRel = path.relative(featurePath, baseDir);
      if (!(await mkdirpContainedOrLegacy(featurePath, baseRel === '' ? '.' : baseRel))) {
        res.status(400).json({ error: 'Invalid directory path' });
        return;
      }

      // relativePaths[] preserves folder structure from drag-and-drop uploads
      const rawRelPaths = req.body.relativePaths;

      const relativePaths: string[] = Array.isArray(rawRelPaths)
        ? rawRelPaths
        : typeof rawRelPaths === 'string'
          ? [rawRelPaths]
          : [];

      // Validate file extensions against artifact dir policy
      const normalizedDirPath = dirPath.replace(/\\/g, '/').replace(/\/$/, '');
      const uploadPolicy = getArtifactDirPolicy(normalizedDirPath);
      if (uploadPolicy) {
        for (let i = 0; i < files.length; i++) {
          const relPath = (relativePaths[i] || files[i].originalname).replace(/\\/g, '/');
          if (!uploadPolicy.allowSubdirs && relPath.includes('/')) {
            return res.status(422).json({
              code: 'SUBDIRS_NOT_ALLOWED',
              message: `Subdirectories are not allowed in ${normalizedDirPath}`,
            });
          }
          const fileExtCheck = validateFileForDir(normalizedDirPath, path.basename(relPath));
          if (!fileExtCheck.valid) {
            return res.status(422).json({
              code: 'INVALID_EXTENSION',
              message: fileExtCheck.reason,
              allowed: fileExtCheck.allowed,
            });
          }
        }
      }

      // Integrity pre-validation, all-or-nothing like the policy loop above:
      // a defect found mid-write would leave earlier files already ingested.
      // A corrupted supplied file is the client's problem (422), never a 500.
      for (let i = 0; i < files.length; i++) {
        const relPath = (relativePaths[i] || files[i].originalname).replace(/\\/g, '/');
        const defect = verifyBufferIntegrity(relPath, files[i].buffer);
        if (defect) {
          const filename = path.basename(relPath);
          logger.warn(`[Upload] Rejected corrupted file ${filename}: ${defect}`);
          return res.status(422).json({
            code: 'CORRUPTED_FILE',
            message: `${filename} is corrupted and was not saved: ${defect}`,
            filename,
          });
        }
      }

      // Destination pre-validation, all-or-nothing like the two loops above: a
      // path rejected mid-write would leave earlier files already ingested.
      const destinations: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const relPath = relativePaths[i] || files[i].originalname;
        try {
          destinations.push(resolveWriteTarget(baseDir, featurePath, relPath));
        } catch {
          return res.status(400).json({ error: 'Invalid file path' });
        }
      }

      // Write all uploaded files (shared byte-safe core: size + GLB header verification)
      const uploadedFiles: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relPath = relativePaths[i] || file.originalname;
        await writeBufferVerifiedAbs(featurePath, destinations[i], file.buffer);
        uploadedFiles.push(relPath);
      }
      
      // Add unseen artifact notifications for uploaded files
      if (deps.stateStore) {
        try {
          const featureRelPaths = uploadedFiles.map(f =>
            path.join(dirPath, f).replace(/\\/g, '/')
          );
          await deps.stateStore.addUnseenArtifacts(
            userContext.userId, projectId, featureName, featureRelPaths
          );
          const allUnseen = await deps.stateStore.getUnseenArtifacts(
            userContext.userId, projectId, featureName
          );
          const channel = getRealtimeBroadcastChannel(
            userContext.organizationId, userContext.userId
          );
          await deps.stateStore.publish(channel, {
            projectId, featureName, type: 'unseenArtifacts',
            data: { type: 'update', paths: allUnseen }, userContext,
          });
        } catch (e) {
          logger.warn(`[Upload] Failed to add unseen artifacts: ${(e as Error).message}`);
        }
      }
      
      if (deps.fileTreeNotifier) {
        try { await deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext); } catch {}
      }

      res.json({
        success: true,
        uploadedFiles,
        count: uploadedFiles.length
      });
    } catch (error: any) {
      // Backstop: the pre-validation above should have caught this, but a
      // corrupted supplied file must never surface as a server error.
      if (error?.code === 'CORRUPTED_FILE') {
        return res.status(422).json({
          code: 'CORRUPTED_FILE',
          message: error.message,
          filename: error.filename,
        });
      }
      logger.error('Upload error', { component: 'Files' }, error);
      sendErrorResponse(res, 500, error, 'Files');
    }
  });

  // Create directory in a feature
  router.post('/projects/:id/features/:feature/directory', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { path: dirPath } = req.body;
      
      if (!dirPath) {
        return res.status(400).json({ error: 'Directory path is required' });
      }
      
      const userContext = extractUserContext(req);
      if (!(await deps.projectService.resolveExistingFeatureForMutation(projectId, featureName, userContext))) {
        return res.status(404).json({ error: 'Feature not found' });
      }
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      // Security: must stay within the feature directory. A bare `startsWith`
      // compares no separator, so `../<feature>-escaped` normalizes to a sibling
      // that still shares the prefix — the shared helper compares by segment and
      // also realpaths the nearest existing ancestor.
      let fullPath: string;
      try {
        fullPath = assertWithinRoot(featurePath, dirPath);
      } catch {
        return res.status(400).json({ error: 'Invalid directory path' });
      }

      // Validate subdirectory creation against artifact dir policy
      const normalizedNewDir = dirPath.replace(/\\/g, '/').replace(/\/$/, '');
      const lastSlash = normalizedNewDir.lastIndexOf('/');
      if (lastSlash >= 0) {
        const parentDir = normalizedNewDir.slice(0, lastSlash);
        const parentPolicy = getArtifactDirPolicy(parentDir);
        if (parentPolicy && !parentPolicy.allowSubdirs) {
          return res.status(422).json({
            code: 'SUBDIRS_NOT_ALLOWED',
            message: `Subdirectories are not allowed in ${parentDir}`,
          });
        }
      }

      // Create directory recursively — descriptor-descended from the workspace
      // base (M-NEW-018); a swapped intermediate fails closed rather than
      // creating a directory outside the feature.
      if (!(await mkdirpContainedOrLegacy(featurePath, path.relative(featurePath, fullPath)))) {
        return res.status(400).json({ error: 'Invalid directory path' });
      }

      if (deps.fileTreeNotifier) {
        try { await deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext); } catch {}
      }

      res.json({ success: true, path: dirPath });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Files');
    }
  });

  // Rename file or directory in a feature
  router.patch('/projects/:id/features/:feature/rename', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { oldPath, newPath } = req.body;

      if (!oldPath || !newPath) {
        return res.status(400).json({ error: 'oldPath and newPath are required' });
      }

      const userContext = extractUserContext(req);
      if (!(await deps.projectService.resolveExistingFeatureForMutation(projectId, featureName, userContext))) {
        return res.status(404).json({ error: 'Feature not found' });
      }
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      let fullOldPath: string;
      let fullNewPath: string;
      try {
        fullOldPath = resolveWriteTarget(featurePath, featurePath, oldPath);
        fullNewPath = resolveWriteTarget(featurePath, featurePath, newPath);
      } catch {
        return res.status(400).json({ error: 'Invalid file path' });
      }

      try {
        await fs.promises.access(fullOldPath);
      } catch {
        return res.status(404).json({ error: 'Source file or directory not found' });
      }

      // Validate extension policy for the new path
      const newRelPath = newPath.replace(/\\/g, '/');
      const extCheck = validateFileForDir(path.dirname(newRelPath), path.basename(newRelPath));
      if (!extCheck.valid) {
        return res.status(422).json({
          code: 'INVALID_EXTENSION',
          message: extCheck.reason,
          allowed: extCheck.allowed,
        });
      }

      // Move descriptor-descended from the workspace base on both parents, so a
      // swapped intermediate cannot land the rename outside the feature
      // (M-NEW-018). Parent of the destination is created the same way.
      if (!(await renameContainedOrLegacy(
        featurePath,
        path.relative(featurePath, fullOldPath),
        path.relative(featurePath, fullNewPath),
      ))) {
        return res.status(400).json({ error: 'Invalid file path' });
      }

      if (deps.fileTreeNotifier) {
        try { await deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext); } catch {}
      }

      res.json({ success: true, oldPath, newPath });
    } catch (error: any) {
      logger.error('Rename error', { component: 'Files' }, error);
      sendErrorResponse(res, 500, error, 'Files');
    }
  });

  // Delete file or directory in a feature
  router.delete('/projects/:id/features/:feature/item', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { path: itemPath } = req.body;
      
      if (!itemPath) {
        return res.status(400).json({ error: 'Item path is required' });
      }
      
      const userContext = extractUserContext(req);
      await deps.projectService.deleteFile(projectId, featureName, itemPath, userContext);
      
      if (deps.fileTreeNotifier) {
        try { await deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext); } catch {}
      }

      // Broadcast kanban reset when session files/directories are deleted via file tree
      const isSessionRelated = itemPath === 'sessions' || itemPath.startsWith('sessions/');
      if (isSessionRelated && deps.stateStore && userContext?.organizationId && userContext?.userId) {
        try {
          const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
          await deps.stateStore.publish(channel, {
            projectId, featureName,
            type: 'kanban',
            data: {
              jobId: null, todo: [], inProgress: [], completed: [],
              interruption: null, isEstimating: false, dataSource: 'session',
              recursionCount: 0, recursionLimit: 200, jobTiming: null, tokenUsage: null,
            },
            userContext
          });
          logger.debug(`[Files] ✅ Broadcast kanban reset after session file delete: ${itemPath}`);
        } catch (broadcastError) {
          logger.warn('Failed to broadcast kanban reset after session file delete', { component: 'Files' }, broadcastError);
        }
      }

      res.json({ success: true, path: itemPath });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'File or directory not found' });
      } else {
        sendErrorResponse(res, 500, error, 'Files');
      }
    }
  });
  
  // ============================================
  // Download file or directory (local download)
  // ============================================

  /**
   * GET /projects/:id/features/:feature/download?path=<relativePath>
   * 
   * - File: sends as attachment (binary)
   * - Directory: sends as zip stream (sessions/ excluded)
   */
  router.get('/projects/:id/features/:feature/download', downloadRateLimiter, async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const relativePath = req.query.path as string;

      if (!relativePath) {
        return res.status(400).json({ error: 'path query parameter is required' });
      }

      const userContext = extractUserContext(req);
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      // Universal-aware seam (download must reach the container).
      const fullPath = resolveFeatureScopedFilePath(workspaceResolver, userContext, projectId, featureName, relativePath);

      // Check existence
      try {
        await fs.promises.access(fullPath);
      } catch {
        return res.status(404).json({ error: 'File or directory not found' });
      }

      const stat = await fs.promises.stat(fullPath);

      if (stat.isDirectory()) {
        // Preflight: answer only whether the archive is within budget. The browser
        // starts a folder download as a navigation, so a 413 body would render as
        // raw JSON in a new tab; the UI asks here first and shows a real message.
        // The bounded walk still opens the whole tree, so it takes the SAME
        // cluster-wide per-account slot as the ZIP stream — otherwise repeated
        // preflights bypass the admission the stream enforces (M-NEW-004).
        if (req.query.preflight === '1') {
          const preflightSlot = deps.stateStore
            ? await acquireConcurrencySlot(
                deps.stateStore,
                `ant:slots:zip:${userContext.organizationId}:${userContext.userId}`,
                { limit: DIRECTORY_DOWNLOAD_MAX_INFLIGHT, ttlSeconds: 60 },
              )
            : { release: async () => {} };
          if (!preflightSlot) {
            res.setHeader('Retry-After', '2');
            return res.status(429).json({
              code: 'TOO_MANY_ARCHIVE_REQUESTS',
              error: 'Too many folder downloads in progress. Retry shortly.',
            });
          }
          try {
            const probe = await measureArchiveInput(fullPath, {
              maxEntries: DIRECTORY_DOWNLOAD_MAX_ENTRIES,
              maxBytes: DIRECTORY_DOWNLOAD_MAX_BYTES,
            });
            if (!probe.exceeded) return res.status(204).end();
            return res.status(413).json({
              code: 'DIRECTORY_DOWNLOAD_LIMIT_EXCEEDED',
              error: 'Folder too large to download',
              limit: { entries: DIRECTORY_DOWNLOAD_MAX_ENTRIES, bytes: DIRECTORY_DOWNLOAD_MAX_BYTES },
            });
          } finally {
            await preflightSlot.release();
          }
        }

        // A directory ZIP reads the whole tree, compresses it at zlib level 6 and
        // holds a response socket open for as long as that takes. Ownership and path
        // containment say WHOSE tree it is, never how much work it is — so one
        // account could run these in parallel and occupy the shared API process's
        // filesystem, CPU and sockets (M-NEW-004). Two gates before the first byte:
        // a cluster-wide per-account stream budget, and an explicit size preflight.
        const slot = deps.stateStore
          ? await acquireConcurrencySlot(
              deps.stateStore,
              `ant:slots:zip:${userContext.organizationId}:${userContext.userId}`,
              { limit: DIRECTORY_DOWNLOAD_MAX_INFLIGHT, ttlSeconds: 15 * 60 },
            )
          : { release: async () => {} };
        if (!slot) {
          return res.status(429).json({
            code: 'DIRECTORY_DOWNLOAD_IN_PROGRESS',
            error: 'Too many downloads in progress',
            message: 'Wait for your current folder downloads to finish, then try again.',
          });
        }

        try {
          const measured = await measureArchiveInput(fullPath, {
            maxEntries: DIRECTORY_DOWNLOAD_MAX_ENTRIES,
            maxBytes: DIRECTORY_DOWNLOAD_MAX_BYTES,
          });
          if (measured.exceeded) {
            // Explicit refusal, never a silent partial ZIP: a truncated archive that
            // looks complete is worse than a clear error.
            return res.status(413).json({
              code: 'DIRECTORY_DOWNLOAD_LIMIT_EXCEEDED',
              error: 'Folder too large to download',
              message:
                `This folder exceeds the download limit (${DIRECTORY_DOWNLOAD_MAX_ENTRIES} files ` +
                `or ${Math.floor(DIRECTORY_DOWNLOAD_MAX_BYTES / (1024 * 1024 * 1024))} GB). ` +
                'Download a subfolder instead.',
              limit: { entries: DIRECTORY_DOWNLOAD_MAX_ENTRIES, bytes: DIRECTORY_DOWNLOAD_MAX_BYTES },
            });
          }

          // Directory: zip streaming
          const dirName = path.basename(relativePath) || featureName;
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(dirName)}.zip"`);

          const archive = archiver('zip', { zlib: { level: 6 } });

          archive.on('error', (err: Error) => {
            logger.error('Archive error', { component: 'Files' }, err);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Archive creation failed' });
            }
          });

          archive.pipe(res);

          // Add directory contents, excluding sessions/
          archive.directory(fullPath, false, (entry) => {
            // Exclude sessions/ directory and its contents
            if (entry.name === 'sessions' || entry.name.startsWith('sessions/') || entry.name.startsWith('sessions\\')) {
              return false;
            }
            return entry;
          });

          await archive.finalize();
        } finally {
          await slot.release();
        }
      } else {
        // File: send as attachment
        const fileName = path.basename(relativePath);
        const mimeType = getMimeTypeFromPath(fullPath);
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Length', stat.size);

        const stream = fs.createReadStream(fullPath);
        stream.pipe(res);
      }
    } catch (error: any) {
      if (!res.headersSent) {
        sendErrorResponse(res, 500, error, 'Files');
      }
    }
  });

  // ============================================
  // Unseen Artifacts (badge notification)
  // ============================================

  /**
   * GET /projects/:id/features/:feature/unseen-artifacts
   * Get list of unseen artifact paths for the current user
   */
  router.get('/projects/:id/features/:feature/unseen-artifacts', async (req: Request, res: Response) => {
    try {
      if (!deps.stateStore) {
        return res.json({ paths: [] });
      }

      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);

      const paths = await deps.stateStore.getUnseenArtifacts(
        userContext.userId,
        projectId,
        featureName
      );

      res.json({ paths });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Files');
    }
  });

  /**
   * POST /projects/:id/features/:feature/mark-seen
   * Mark artifact paths as seen (remove from unseen set)
   * Body: { paths: string[] }
   */
  router.post('/projects/:id/features/:feature/mark-seen', async (req: Request, res: Response) => {
    try {
      if (!deps.stateStore) {
        return res.json({ success: true });
      }

      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { paths } = req.body;
      const userContext = extractUserContext(req);

      if (!Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ error: 'paths array is required' });
      }

      await deps.stateStore.removeUnseenArtifacts(
        userContext.userId,
        projectId,
        featureName,
        paths
      );

      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Files');
    }
  });

  return router;
}

