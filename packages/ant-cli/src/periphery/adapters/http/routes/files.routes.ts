import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { ProjectService } from '../services';
import { extractUserContext } from './helpers/userContext';

/**
 * File operations (read, write, delete, upload)
 */
export function createFilesRoutes(deps: {
  projectService: ProjectService;
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
      
      const tree = await deps.projectService.getFileTree(projectId, featureName, userContext);
      res.json(tree);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // ⚠️ DEPRECATED: Redirect to unified SSE endpoint
  router.get('/projects/:id/features/:feature/files/stream', (req: Request, res: Response) => {
    res.status(410).json({ 
      error: 'Endpoint deprecated',
      message: 'Use /projects/:id/features/:feature/stream instead',
      newEndpoint: `/projects/${req.params.id}/features/${req.params.feature}/stream`
    });
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
      res.status(500).json({ error: error.message });
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
      res.status(500).json({ error: error.message });
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
      const workspaceResolver = (deps.projectService as any).workspaceResolver;
      const featurePath = workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const fullPath = path.join(featurePath, filePath);
      
      console.log(`[files.routes] Creating/updating file:`);
      console.log(`   Project: ${projectId}`);
      console.log(`   Feature: ${featureName}`);
      console.log(`   File path: ${filePath}`);
      console.log(`   Full path: ${fullPath}`);
      
      // Ensure directory exists
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Write file
      await fs.promises.writeFile(fullPath, content, 'utf-8');
      
      res.json({ success: true, path: filePath });
    } catch (error: any) {
      console.error('[files.routes] Error creating/updating file:', error);
      res.status(500).json({ error: error.message });
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
      
      // Ensure directory exists
      await fs.promises.mkdir(baseDir, { recursive: true });
      
      // Write all uploaded files
      const uploadedFiles: string[] = [];
      for (const file of files) {
        const filePath = path.join(baseDir, file.originalname);
        await fs.promises.writeFile(filePath, file.buffer);
        uploadedFiles.push(file.originalname);
      }
      
      res.json({ 
        success: true, 
        uploadedFiles,
        count: uploadedFiles.length 
      });
    } catch (error: any) {
      console.error('[Upload] Error:', error);
      res.status(500).json({ error: error.message });
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
      
      // Create directory recursively
      await fs.promises.mkdir(fullPath, { recursive: true });
      
      res.json({ success: true, path: dirPath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
      
      res.json({ success: true, path: itemPath });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'File or directory not found' });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });
  
  return router;
}

