import { Router, Request, Response } from 'express';
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
import { getArtifactDirPolicy, validateFileForDir } from '../../../../core/utils/artifact-dir-policy';

/**
 * File operations (read, write, delete, upload)
 */
export function createFilesRoutes(deps: {
  projectService: ProjectService;
  stateStore?: StateStorePort;
  fileTreeNotifier?: { notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): Promise<void> };
}): Router {
  const router = Router();

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
      case '.svg':
        return 'image/svg+xml';
      default:
        return 'application/octet-stream';
    }
  };

  const resolveSafePath = (rootDir: string, relativeFilePath: string): string => {
    const root = path.resolve(rootDir);
    const full = path.resolve(rootDir, relativeFilePath);
    // Prevent path traversal: full must be inside root
    if (full === root) return full;
    if (!full.startsWith(root + path.sep)) {
      throw new Error('Invalid file path');
    }
    return full;
  };
  
  // Configure multer for file uploads (use memory storage)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max file size
    },
  });
  
  // Get file tree for a feature
  router.get('/projects/:id/features/:feature/files', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const userContext = extractUserContext(req);
      const forceRefresh = req.query.force === 'true';

      // Redis cache first (bypasses EFS/NFS attribute caching in multi-pod cloud deployments)
      // Skip cache when force=true (handles external filesystem changes not tracked by ANT)
      if (deps.stateStore && !forceRefresh) {
        try {
          const cached = await deps.stateStore.getFileTreeCache(userContext.userId, projectId, featureName);
          if (cached) {
            return res.json(cached);
          }
        } catch {
          // Fall through to EFS on Redis error
        }
      }

      const tree = await deps.projectService.getFileTree(projectId, featureName, userContext);
      if (deps.stateStore && tree) {
        deps.stateStore.setFileTreeCache(userContext.userId, projectId, featureName, tree).catch(() => {});
      }
      res.json(tree);
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
      const featureName = req.params[1];
      const filePath = req.params[2];

      if (!filePath) {
        res.status(400).json({ error: 'File path is required' });
        return;
      }

      const userContext = extractUserContext(req);
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const fullPath = resolveSafePath(featurePath, filePath);

      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
          res.status(400).json({ error: 'Path is a directory, not a file' });
          return;
        }

        const buf = await fs.promises.readFile(fullPath);
        res.setHeader('Content-Type', getMimeTypeFromPath(filePath));
        res.setHeader('Cache-Control', 'no-store');
        // Inline rendering in browser (useful for images)
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
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
  
  // Get file content
  router.get(/^\/projects\/([^\/]+)\/features\/([^\/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
    try {
      const projectId = req.params[0];
      const featureName = req.params[1];
      const filePath = req.params[2];
      
      if (!filePath) {
        res.status(400).json({ error: 'File path is required' });
        return;
      }
      
      const userContext = extractUserContext(req);
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const fullPath = resolveSafePath(featurePath, filePath);
      
      try {
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        res.json({ path: filePath, content });
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          res.status(404).json({ error: 'File not found' });
        } else if (error.code === 'EISDIR') {
          res.status(400).json({ error: 'Path is a directory, not a file' });
        } else {
          throw error;
        }
      }
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Files');
    }
  });
  
  // Update/Create file content
  router.put(/^\/projects\/([^\/]+)\/features\/([^\/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
    try {
      const projectId = req.params[0];
      const featureName = req.params[1];
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

      // Validate file extension against artifact dir policy
      const parentDir = path.dirname(filePath).replace(/\\/g, '/');
      const extCheck = validateFileForDir(parentDir, path.basename(filePath));
      if (!extCheck.valid) {
        return res.status(422).json({
          code: 'INVALID_EXTENSION',
          message: extCheck.reason,
          allowed: extCheck.allowed,
        });
      }

      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const fullPath = path.join(featurePath, filePath);

      logger.debug(`[files.routes] Creating/updating file:`);
      logger.debug(`   Project: ${projectId}`);
      logger.debug(`   Feature: ${featureName}`);
      logger.debug(`   File path: ${filePath}`);
      logger.debug(`   Full path: ${fullPath}`);
      
      // Ensure directory exists
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Write file
      await fs.promises.writeFile(fullPath, content, 'utf-8');
      
      if (deps.fileTreeNotifier) {
        try { await deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext); } catch {}
      }

      res.json({ success: true, path: filePath });
    } catch (error: any) {
      logger.error('Error creating/updating file', { component: 'Files' }, error);
      sendErrorResponse(res, 500, error, 'Files');
    }
  });

  // Upload files to a feature directory
  router.post('/projects/:id/features/:feature/upload', upload.array('files'), async (req: Request, res: Response) => {
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
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const baseDir = path.join(featurePath, dirPath);
      
      // Ensure base directory exists
      await fs.promises.mkdir(baseDir, { recursive: true });
      
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

      // Write all uploaded files
      const uploadedFiles: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relPath = relativePaths[i] || file.originalname;
        const filePath = resolveSafePath(baseDir, relPath);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, file.buffer);
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
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const fullPath = path.join(featurePath, dirPath);

      // Security: prevent path traversal (must stay within feature directory)
      if (!fullPath.startsWith(featurePath)) {
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

      // Create directory recursively
      await fs.promises.mkdir(fullPath, { recursive: true });
      
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
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);

      const fullOldPath = resolveSafePath(featurePath, oldPath);
      const fullNewPath = resolveSafePath(featurePath, newPath);

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

      // Ensure parent directory of new path exists
      await fs.promises.mkdir(path.dirname(fullNewPath), { recursive: true });
      await fs.promises.rename(fullOldPath, fullNewPath);

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
  router.get('/projects/:id/features/:feature/download', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const relativePath = req.query.path as string;

      if (!relativePath) {
        return res.status(400).json({ error: 'path query parameter is required' });
      }

      const userContext = extractUserContext(req);
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const fullPath = resolveSafePath(featurePath, relativePath);

      // Check existence
      try {
        await fs.promises.access(fullPath);
      } catch {
        return res.status(404).json({ error: 'File or directory not found' });
      }

      const stat = await fs.promises.stat(fullPath);

      if (stat.isDirectory()) {
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

