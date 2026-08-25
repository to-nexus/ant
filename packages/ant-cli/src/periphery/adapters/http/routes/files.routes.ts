import { Router, Request, Response, type RequestHandler } from 'express';
import { registerFeatureParamDecoders, decodeFeatureSegment } from './helpers/featureParam';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import multer from 'multer';
import archiver from 'archiver';
import { ProjectService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import type { UserContext } from '../../../../core/types/user';
import { getRealtimeBroadcastChannel } from '../../../../infrastructure/state/redisConstants';
import { getArtifactDirPolicy, validateFileForDir } from '@ant/shared';
import { writeBufferVerifiedContained, verifyBufferIntegrity } from '../../../../core/utils/binaryIntegrity';
import { toNfc } from '../../../../core/utils/unicodePath';
import { boundedMultipart } from '../middleware/boundedMultipart';
import {
  downloadRateLimiter,
  forceRefreshRateLimiter,
  treeRateLimiter,
} from '../middleware/rateLimiter';
import { acquireLock } from '../../../../core/redis/distributedLock';
import { acquireConcurrencySlot } from '../../../../core/redis/concurrencySlot';
import { assertWithinRoot } from '../../../../core/config/pathContainment';
import { resolveFeatureScopedFilePath, resolveUniversalPlaneRoot, measureArchiveInput } from './helpers/featureFiles';
import { UPLOAD_LIMITS } from '../../../../core/config/uploadLimits';
import {
  mkdirpContainedBase,
  renameContainedBase,
  toBaseRelative,
  statContainedBase,
  walkContainedBase,
  createReadStreamContainedBase,
} from '../../../../core/config/containedIo';
import { WorkspacePathResolver } from '../../../../core/config/WorkspacePathResolver';
import { SESSIONS_DIR_NAME } from '../../../../core/utils/sessionPaths';

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
/**
 * A live ZIP/raw stream re-arms its slot's 15-min TTL well before it lapses, so a
 * legitimately long download keeps COUNTING against the per-account budget instead
 * of freeing its own slot and letting the account re-admit past the limit
 * (M-NEW-027). Interval ≪ TTL.
 */
const STREAM_SLOT_HEARTBEAT_MS = 5 * 60 * 1000;
/**
 * Backstop for a socket that neither delivers nor emits `close` (a wedged proxy):
 * past this the stream is torn down so its slot cannot be pinned indefinitely. Set
 * well above any legitimate large-archive-over-slow-link download.
 */
const STREAM_SLOT_MAX_LIFETIME_MS = 60 * 60 * 1000;
/** Per-account concurrent raw file streams, cluster-wide (M-NEW-028). */
const RAW_STREAM_MAX_INFLIGHT = 4;
const RAW_STREAM_SLOT_TTL_SECONDS = 15 * 60;

/**
 * Bind a concurrency slot's lifetime to the RESPONSE, not to a `finally` after
 * `archive.finalize()`. `finalize()` resolves when the last chunk is accepted by
 * `res`, not delivered — and on a client disconnect the archiver can be left
 * undrained so `finalize()` never settles, which would pin the slot for the full
 * TTL. Releasing on `finish`/`close`/`error` (idempotent) covers every exit, and a
 * heartbeat keeps the slot counted while the stream is genuinely alive. Returns a
 * disposer for early returns taken before the response ends.
 */
function bindStreamSlotToResponse(
  res: Response,
  slot: { release: () => Promise<void>; refresh: () => Promise<boolean> },
): void {
  let released = false;
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    if (Date.now() - startedAt > STREAM_SLOT_MAX_LIFETIME_MS) {
      res.destroy();
      return;
    }
    void slot.refresh().then((alive) => {
      // The member was pruned (TTL lapsed and a concurrent reserve counted it
      // out): stop rather than run on past a budget we no longer hold.
      if (!alive) res.destroy();
    });
  }, STREAM_SLOT_HEARTBEAT_MS);
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    void slot.release();
  };
  res.on('finish', release);
  res.on('close', release);
  res.on('error', release);
}

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
   * Refuse a canonical-plane write aimed at a workspace project's universal
   * container, and answer the response when it does.
   *
   * `upload` / `directory` / `rename` anchor their target at the plane root and
   * walk it by name, so honouring the `universal` pseudo-feature here would
   * write into the phantom `features/universal` tree instead of the container.
   * The container's merged-path routing and reserved-root guards (`sessions/`,
   * `pipeline-runs/`) live in the `/projects/:id/universal/artifacts` mount,
   * which owns these three operations for workspace projects.
   */
  const refusedUniversalPlane = (
    res: Response,
    userContext: UserContext,
    projectId: string,
    featureName: string,
  ): boolean => {
    const workspaceResolver = (deps.projectService as any).workspaceResolver;
    if (!resolveUniversalPlaneRoot(workspaceResolver, userContext, projectId, featureName)) return false;
    res.status(409).json({
      code: 'universal-plane',
      error: 'Workspace projects manage files through /projects/:id/universal/artifacts',
    });
    return true;
  };

  /**
   * Refuse a generic file mutation aimed at the canonical `sessions/**`
   * namespace, and answer the response when it does.
   *
   * `sessions/{agent}/{job}.json` is job-lifecycle state, not a user artifact:
   * it has no artifact-dir policy, so `validateFileForDir` waves it through, and
   * a generic PUT/upload/rename could grow it without bound. Every canonical
   * session reader then full-reads and `JSON.parse`s it across the API and job
   * lifecycle (M-NEW-029). The only legitimate writer is the job runner, which
   * does not go through these HTTP file routes — so the whole namespace is
   * off-limits to the generic file surface. Mirrors the universal plane's
   * `reservedRootViolation` (customAgents.routes.ts).
   */
  const refusedCanonicalSessionPath = (res: Response, relativeFilePath: string): boolean => {
    const first = (relativeFilePath ?? '').replace(/\\/g, '/').replace(/^\/+/, '').split('/')[0] ?? '';
    if (first !== SESSIONS_DIR_NAME) return false;
    res.status(409).json({
      code: 'reserved-name-sessions',
      error: '"sessions" is a reserved job-state namespace and cannot be modified through the file API',
    });
    return true;
  };

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
      const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), fullPath);

      // A raw file response used to read the WHOLE file into a Buffer and
      // res.send() it — no streaming, no backpressure, no admission (M-NEW-028).
      // A 50 MiB asset (upload cap) fetched repeatedly or over a slow client
      // pinned API heap and sockets with nothing bounding concurrency. Take a
      // per-account active-stream slot before the first byte, stream with
      // pipeline backpressure, and release on the response lifecycle.
      const rawSlot = deps.stateStore
        ? await acquireConcurrencySlot(
            deps.stateStore,
            `ant:slots:raw:${userContext.organizationId}:${userContext.userId}`,
            { limit: RAW_STREAM_MAX_INFLIGHT, ttlSeconds: RAW_STREAM_SLOT_TTL_SECONDS },
          )
        : { release: async () => {}, refresh: async () => true };
      if (!rawSlot) {
        res.setHeader('Retry-After', '2');
        res.status(429).json({
          code: 'TOO_MANY_FILE_STREAMS',
          error: 'Too many file downloads in progress. Retry shortly.',
        });
        return;
      }
      bindStreamSlotToResponse(res, rawSlot);

      try {
        let source: NodeJS.ReadableStream;
        let size: number;
        if (br) {
          // Contained: the type check and the bytes bind to the same descended
          // descriptor, so a directory component swapped after resolve cannot
          // return another tenant's file as this attachment (H-017).
          const st = statContainedBase(br);
          if (!st.ok) { res.status(404).json({ error: 'File not found' }); return; }
          if (st.stat.isDirectory()) { res.status(400).json({ error: 'Path is a directory, not a file' }); return; }
          const s = createReadStreamContainedBase(br);
          if (!s.ok) { res.status(404).json({ error: 'File not found' }); return; }
          source = s.stream;
          size = s.size;
        } else {
          const stat = await fs.promises.stat(fullPath);
          if (stat.isDirectory()) {
            res.status(400).json({ error: 'Path is a directory, not a file' });
            return;
          }
          source = fs.createReadStream(fullPath);
          size = stat.size;
        }
        const mimeType = getMimeTypeFromPath(filePath);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', size);
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
        // pipeline propagates backpressure and destroys the source if the client
        // disconnects, so a slow/aborted reader cannot buffer the whole file.
        await pipeline(source, res);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          if (!res.headersSent) res.status(404).json({ error: 'File not found' });
        } else if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          // Client disconnected mid-stream — normal, slot released by lifecycle.
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
        } else if (error.code === 'FILE_TOO_LARGE') {
          res.status(413).json({ code: 'FILE_TOO_LARGE', message: error.message, size: error.size, limit: error.limit });
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

      // sessions/** is job-lifecycle state, not a user artifact — off-limits to
      // the generic file surface on BOTH planes (M-NEW-029). The first-segment
      // guard fires whether the path resolves to the canonical feature root or
      // the universal container's grafted `sessions/`, so a normal universal
      // artifact PUT (e.g. plan/*) is unaffected — only session paths are refused.
      if (refusedCanonicalSessionPath(res, filePath)) return;

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
      // The authority answers the plane root — re-deriving it from the name
      // would leave the plane it just resolved.
      const featurePath = await deps.projectService.resolveExistingFeatureForMutation(projectId, featureName, userContext);
      if (!featurePath) {
        res.status(404).json({ error: 'Feature not found' });
        return;
      }
      if (refusedUniversalPlane(res, userContext, projectId, featureName)) return;
      if (refusedCanonicalSessionPath(res, dirPath)) return;

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

      const relativePaths: string[] = (Array.isArray(rawRelPaths)
        ? rawRelPaths
        : typeof rawRelPaths === 'string'
          ? [rawRelPaths]
          : []
      ).map(toNfc);
      // NFC at ingestion: macOS browsers submit NFD filenames; storing them
      // verbatim on Linux makes every LLM-emitted (NFC) path miss the file.
      for (const f of files) f.originalname = toNfc(f.originalname);

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
        await writeBufferVerifiedContained(featurePath, destinations[i], file.buffer);
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
      const featurePath = await deps.projectService.resolveExistingFeatureForMutation(projectId, featureName, userContext);
      if (!featurePath) {
        return res.status(404).json({ error: 'Feature not found' });
      }
      if (refusedUniversalPlane(res, userContext, projectId, featureName)) return;
      if (refusedCanonicalSessionPath(res, dirPath)) return;
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
      const featurePath = await deps.projectService.resolveExistingFeatureForMutation(projectId, featureName, userContext);
      if (!featurePath) {
        return res.status(404).json({ error: 'Feature not found' });
      }
      if (refusedUniversalPlane(res, userContext, projectId, featureName)) return;
      // Neither endpoint of the rename may touch sessions/** (M-NEW-029).
      if (refusedCanonicalSessionPath(res, oldPath)) return;
      if (refusedCanonicalSessionPath(res, newPath)) return;

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
      const br = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), fullPath);

      // Existence + kind via the same descent the stream binds (H-017).
      const skipSessions = (rel: string) =>
        rel === 'sessions' || rel.startsWith('sessions/') || rel.startsWith('sessions\\');
      let isDirectory: boolean;
      let fileSize = 0;
      if (br) {
        const st = statContainedBase(br);
        if (!st.ok) return res.status(404).json({ error: 'File or directory not found' });
        isDirectory = st.stat.isDirectory();
        fileSize = Number(st.stat.size);
      } else {
        try {
          await fs.promises.access(fullPath);
        } catch {
          return res.status(404).json({ error: 'File or directory not found' });
        }
        const stat = await fs.promises.stat(fullPath);
        isDirectory = stat.isDirectory();
        fileSize = stat.size;
      }

      if (isDirectory) {
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
            let exceeded: boolean;
            if (br) {
              const walk = walkContainedBase(br, {
                maxEntries: DIRECTORY_DOWNLOAD_MAX_ENTRIES,
                maxDepth: 64,
                maxBytes: DIRECTORY_DOWNLOAD_MAX_BYTES,
                skip: skipSessions,
              });
              if (!walk.ok) return res.status(404).json({ error: 'File or directory not found' });
              exceeded = walk.truncated;
            } else {
              exceeded = (await measureArchiveInput(fullPath, {
                maxEntries: DIRECTORY_DOWNLOAD_MAX_ENTRIES,
                maxBytes: DIRECTORY_DOWNLOAD_MAX_BYTES,
              })).exceeded;
            }
            if (!exceeded) return res.status(204).end();
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
          : { release: async () => {}, refresh: async () => true };
        if (!slot) {
          return res.status(429).json({
            code: 'DIRECTORY_DOWNLOAD_IN_PROGRESS',
            error: 'Too many downloads in progress',
            message: 'Wait for your current folder downloads to finish, then try again.',
          });
        }

        // Release when the RESPONSE ends (finish/close/error), never in a finally
        // after finalize() — see bindStreamSlotToResponse (M-NEW-027). Every early
        // return below ends the response, which fires the release.
        bindStreamSlotToResponse(res, slot);

        {
          const tooLarge = () =>
            res.status(413).json({
              code: 'DIRECTORY_DOWNLOAD_LIMIT_EXCEEDED',
              error: 'Folder too large to download',
              message:
                `This folder exceeds the download limit (${DIRECTORY_DOWNLOAD_MAX_ENTRIES} files ` +
                `or ${Math.floor(DIRECTORY_DOWNLOAD_MAX_BYTES / (1024 * 1024 * 1024))} GB). ` +
                'Download a subfolder instead.',
              limit: { entries: DIRECTORY_DOWNLOAD_MAX_ENTRIES, bytes: DIRECTORY_DOWNLOAD_MAX_BYTES },
            });

          // The single enumeration that both measures AND supplies the archive.
          // A file added or swapped after this snapshot is not in the list, so it
          // cannot ride into the ZIP outside the measured budget (M-NEW-004/H-017).
          let archiveFiles: Array<{ base: string; relative: string; entryName: string }> | null = null;
          if (br) {
            const walk = walkContainedBase(br, {
              maxEntries: DIRECTORY_DOWNLOAD_MAX_ENTRIES,
              maxDepth: 64,
              maxBytes: DIRECTORY_DOWNLOAD_MAX_BYTES,
              skip: skipSessions,
            });
            if (!walk.ok) return res.status(404).json({ error: 'File or directory not found' });
            if (walk.truncated) return tooLarge();
            archiveFiles = walk.files.map((f) => ({
              base: br.base,
              relative: f.relative,
              entryName: f.relative.slice(br.relative.length + 1),
            }));
          } else {
            const measured = await measureArchiveInput(fullPath, {
              maxEntries: DIRECTORY_DOWNLOAD_MAX_ENTRIES,
              maxBytes: DIRECTORY_DOWNLOAD_MAX_BYTES,
            });
            if (measured.exceeded) return tooLarge();
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

          if (archiveFiles) {
            // Append each file from a descriptor-bound stream — never
            // archive.directory(name), which would re-walk the tree by name.
            // Open ONE descriptor at a time: wait for the archiver to finish
            // consuming (close) the current entry's stream before opening the
            // next. Opening all 20k streams up front held that many fds until
            // finalize and exhausted the shared process (EMFILE) (M-031).
            let aborted = false;
            const onAbort = () => { aborted = true; };
            res.on('close', onAbort);
            try {
              for (const f of archiveFiles) {
                if (aborted) break;
                const s = createReadStreamContainedBase({ base: f.base, relative: f.relative });
                if (!s.ok) continue; // vanished/swapped since the snapshot: skip, never follow
                const consumed = new Promise<void>((resolve) => {
                  s.stream.once('close', () => resolve());
                  s.stream.once('error', () => resolve());
                });
                archive.append(s.stream, { name: f.entryName });
                await consumed;
              }
            } finally {
              res.off('close', onAbort);
            }
          } else {
            // Out-of-base (local): the raw archive walk, sessions excluded.
            archive.directory(fullPath, false, (entry) => {
              if (entry.name === 'sessions' || entry.name.startsWith('sessions/') || entry.name.startsWith('sessions\\')) {
                return false;
              }
              return entry;
            });
          }

          await archive.finalize();
        }
      } else {
        // File: send as attachment
        const fileName = path.basename(relativePath);
        const mimeType = getMimeTypeFromPath(fullPath);

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Length', fileSize);

        if (br) {
          const s = createReadStreamContainedBase(br);
          if (!s.ok) return res.status(404).json({ error: 'File not found' });
          s.stream.pipe(res);
        } else {
          const stream = fs.createReadStream(fullPath);
          stream.pipe(res);
        }
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

