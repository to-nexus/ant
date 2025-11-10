import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { ProjectService } from '../services';

/**
 * Project and feature management routes
 * Handles CRUD operations for projects, features, files, and configs
 */
export function createProjectRoutes(deps: {
  projectService: ProjectService;
  workspaceRoot: string;
  fileTreeSSE?: Map<string, Set<Response>>;
}): Router {
  const router = Router();
  
  // Configure multer for file uploads (use memory storage)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max file size
    },
  });
  
  // Health check
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  // Get available agents
  router.get('/agents', (_req: Request, res: Response) => {
    res.json([
      { 
        value: 'architect', 
        label: 'Architect', 
        enabled: true,
        tasks: [
          { value: 'design', label: 'Design' },
          { value: 'code', label: 'Code' },
          { value: 'learn', label: 'Learn' },
        ]
      },
      { 
        value: 'reviewer', 
        label: 'Reviewer', 
        enabled: false,
        tasks: [
          { value: 'review', label: 'Review' },
        ]
      },
      { 
        value: 'planner', 
        label: 'Planner', 
        enabled: false,
        tasks: [
          { value: 'plan', label: 'Plan' },
        ]
      },
      { 
        value: 'doc', 
        label: 'Doc', 
        enabled: false,
        tasks: [
          { value: 'doc', label: 'Document' },
        ]
      },
    ]);
  });
  
  // List projects
  router.get('/projects', async (_req: Request, res: Response) => {
    try {
      const projects = await deps.projectService.listProjects();
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Create a new project
  router.post('/projects', async (req: Request, res: Response) => {
    try {
      const { id } = req.body;
      
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Project ID is required and must be a string' });
      }
      
      await deps.projectService.createProject(id);
      res.json({ success: true, id });
    } catch (error: any) {
      if (error.message === 'Project already exists') {
        res.status(409).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Delete a project
  router.delete('/projects/:id', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      await deps.projectService.deleteProject(projectId);
      res.json({ success: true, message: `Project ${projectId} deleted` });
    } catch (error: any) {
      if (error.message === 'Project not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Get project config
  router.get('/projects/:id/config', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const config = await deps.projectService.getProjectConfig(projectId);
      res.json(config);
    } catch (error: any) {
      if (error.message === 'Config file not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Update project config
  router.put('/projects/:id/config', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const config = req.body;
      await deps.projectService.updateProjectConfig(projectId, config);
      
      // Return the saved config for immediate UI update
      const savedConfig = await deps.projectService.getProjectConfig(projectId);
      res.json(savedConfig);
    } catch (error: any) {
      if (error.message.includes('Missing required fields')) {
        res.status(400).json({ error: error.message });
      } else if (error.message === 'Config file not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Get session for a project (skeleton)
  router.get('/projects/:id/session', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const sessionData = await deps.projectService.getSession(projectId, 'skeleton');
      res.json(sessionData);
    } catch (error: any) {
      if (error.message === 'Session file not found') {
        res.json(null);
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Get features for a project
  router.get('/projects/:id/features', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const features = await deps.projectService.listFeatures(projectId);
      
      // Format for API response
      const formattedFeatures = features.map(name => ({
        name,
        path: path.join(deps.workspaceRoot, projectId, name)
      }));
      
      res.json(formattedFeatures);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Create a new feature
  router.post('/projects/:id/features', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const { featureName } = req.body;
      
      if (!featureName) {
        res.status(400).json({ error: 'featureName is required' });
        return;
      }
      
      const featurePath = path.join(deps.workspaceRoot, projectId, featureName);
      
      // Create feature directory structure
      await fs.promises.mkdir(path.join(featurePath, 'inputs/directives/code'), { recursive: true });
      await fs.promises.mkdir(path.join(featurePath, 'inputs/directives/design'), { recursive: true });
      await fs.promises.mkdir(path.join(featurePath, 'inputs/directives/learn'), { recursive: true });
      await fs.promises.mkdir(path.join(featurePath, 'inputs/sources'), { recursive: true });
      await fs.promises.mkdir(path.join(featurePath, 'outputs/design'), { recursive: true });
      await fs.promises.mkdir(path.join(featurePath, 'outputs/reports'), { recursive: true });
      await fs.promises.mkdir(path.join(featurePath, 'sessions'), { recursive: true });  // ✅ Add sessions directory
      
      // Create empty directive.md files
      await fs.promises.writeFile(
        path.join(featurePath, 'inputs/directives/code/directive.md'),
        '# Code Directive\n\nDescribe what you want to build here.\n'
      );
      await fs.promises.writeFile(
        path.join(featurePath, 'inputs/directives/design/directive.md'),
        '# Design Directive\n\nDescribe the design requirements here.\n'
      );
      await fs.promises.writeFile(
        path.join(featurePath, 'inputs/directives/learn/directive.md'),
        '# Learn Directive\n\nDescribe what you want to learn here.\n'
      );
      
      // ✅ Note: Session files (design.json, code.json, learn.json) are created
      // automatically when jobs run, not at feature creation time.
      
      res.json({ success: true, featureName, path: featurePath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Delete a feature
  router.delete('/projects/:id/features/:feature', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      
      const featurePath = path.join(deps.workspaceRoot, projectId, featureName);
      
      // Check if feature exists
      const exists = await fs.promises.access(featurePath)
        .then(() => true)
        .catch(() => false);
      
      if (!exists) {
        res.status(404).json({ error: 'Feature not found' });
        return;
      }
      
      // Delete feature directory recursively
      await fs.promises.rm(featurePath, { recursive: true, force: true });
      
      res.json({ success: true, message: `Feature ${featureName} deleted` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get session for a specific feature
  router.get('/projects/:id/features/:feature/session', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const job = (req.query.job as 'design' | 'code' | 'learn') || 'code';  // ✅ Get job from query param
      
      const sessionPath = path.join(
        deps.workspaceRoot,
        projectId,
        featureName,
        `sessions/${job}.json`  // ✅ Use job-specific path
      );
      
      // Check if session file exists
      const exists = await fs.promises.access(sessionPath)
        .then(() => true)
        .catch(() => false);
      
      if (!exists) {
        res.json(null);
        return;
      }
      
      try {
        const sessionData = await fs.promises.readFile(sessionPath, 'utf-8');
        
        // Handle empty file
        if (!sessionData || sessionData.trim() === '') {
          res.json(null);
          return;
        }
        
        const parsedData = JSON.parse(sessionData);
        res.json(parsedData);
      } catch (parseError) {
        console.error(`[API] Error parsing session file: ${sessionPath}`, parseError);
        res.status(500).json({ error: 'Invalid JSON in session file' });
      }
    } catch (error: any) {
      console.error(`[API] Error reading session file:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Reset job state (remove jobId and jobTiming)
  router.post('/projects/:id/features/:feature/reset-job', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const job = (req.body.job || req.query.job as 'design' | 'code' | 'learn') || 'code';
      
      console.log(`\n🔄 [API] Reset job state request:`);
      console.log(`   Project: ${projectId}`);
      console.log(`   Feature: ${featureName}`);
      console.log(`   Job: ${job}`);
      
      await deps.projectService.resetJobState(projectId, featureName, job);
      
      console.log(`   ✅ Job state reset successfully\n`);
      
      res.json({ 
        success: true, 
        message: 'Job state reset successfully' 
      });
    } catch (error: any) {
      console.error(`[API] Error resetting job state:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get file tree for a feature
  router.get('/projects/:id/features/:feature/files', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const featurePath = path.join(deps.workspaceRoot, projectId, featureName);
      
      const buildFileTree = async (dirPath: string, relativePath: string = ''): Promise<any[]> => {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const nodes = await Promise.all(
          entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name);
            const relPath = path.join(relativePath, entry.name);
            
            if (entry.isDirectory()) {
              const children = await buildFileTree(fullPath, relPath);
              return {
                name: entry.name,
                path: relPath,
                type: 'directory',
                children
              };
            } else {
              return {
                name: entry.name,
                path: relPath,
                type: 'file'
              };
            }
          })
        );
        return nodes;
      };
      
      const tree = await buildFileTree(featurePath);
      res.json(tree);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // SSE stream for file tree updates
  router.get('/projects/:id/features/:feature/files/stream', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const key = `${projectId}/${featureName}`;
    
    if (!deps.fileTreeSSE) {
      res.status(500).json({ error: 'SSE not configured' });
      return;
    }
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    // Add client to SSE map
    if (!deps.fileTreeSSE.has(key)) {
      deps.fileTreeSSE.set(key, new Set());
    }
    deps.fileTreeSSE.get(key)!.add(res);
    
    
    // Send initial data (current file tree)
    try {
      const featurePath = path.join(deps.workspaceRoot, projectId, featureName);
      
      const buildFileTree = async (dirPath: string, relativePath: string = ''): Promise<any[]> => {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const nodes = await Promise.all(
          entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name);
            const relPath = path.join(relativePath, entry.name);
            
            if (entry.isDirectory()) {
              const children = await buildFileTree(fullPath, relPath);
              return {
                name: entry.name,
                path: relPath,
                type: 'directory',
                children
              };
            } else {
              return {
                name: entry.name,
                path: relPath,
                type: 'file'
              };
            }
          })
        );
        return nodes;
      };
      
      const tree = await buildFileTree(featurePath);
      res.write(`data: ${JSON.stringify({ type: 'initial', fileTree: tree })}\n\n`);
    } catch (error) {
      console.error(`[FileTree SSE] Error sending initial data:`, error);
    }
    
    // Handle client disconnect
    req.on('close', () => {
      const clients = deps.fileTreeSSE!.get(key);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) {
          deps.fileTreeSSE!.delete(key);
        }
      }
    });
  });
  
  // Get file content (using regex pattern for catch-all)
  router.get(/^\/projects\/([^\/]+)\/features\/([^\/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
    try {
      const projectId = req.params[0];
      const featureName = req.params[1];
      const filePath = req.params[2];
      
      if (!filePath) {
        res.status(400).json({ error: 'File path is required' });
        return;
      }
      
      const fullPath = path.join(
        deps.workspaceRoot,
        projectId,
        featureName,
        filePath
      );
      
      // Check if file exists
      const exists = await fs.promises.access(fullPath)
        .then(() => true)
        .catch(() => false);
      
      if (!exists) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      
      const stats = await fs.promises.stat(fullPath);
      if (stats.isDirectory()) {
        res.status(400).json({ error: 'Path is a directory, not a file' });
        return;
      }
      
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      res.json({ path: filePath, content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update file content (using regex pattern for catch-all)
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
      
      const fullPath = path.join(
        deps.workspaceRoot,
        projectId,
        featureName,
        filePath
      );
      
      // Create directory if it doesn't exist
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      
      // Write file
      await fs.promises.writeFile(fullPath, content, 'utf-8');
      
      res.json({ success: true, path: filePath });
    } catch (error: any) {
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
      
      // Base directory for uploads
      const baseDir = path.join(
        deps.workspaceRoot,
        projectId,
        featureName,
        dirPath
      );
      
      // Ensure directory exists
      await fs.promises.mkdir(baseDir, { recursive: true });
      
      // Write all uploaded files
      const uploadedFiles: string[] = [];
      for (const file of files) {
        const filePath = path.join(baseDir, file.originalname);
        await fs.promises.writeFile(filePath, file.buffer);
        uploadedFiles.push(file.originalname);
      }
      
      // Broadcast file tree update via SSE
      if (deps.fileTreeSSE) {
        const key = `${projectId}/${featureName}`;
        const clients = deps.fileTreeSSE.get(key);
        if (clients) {
          clients.forEach(client => {
            client.write(`data: ${JSON.stringify({ type: 'update' })}\n\n`);
          });
        }
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
      const { path: dirPath } = req.body;
      
      if (!dirPath) {
        return res.status(400).json({ error: 'Directory path is required' });
      }
      
      const projectPath = path.join(deps.workspaceRoot, projectId);
      const fullPath = path.join(projectPath, dirPath);
      
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
      
      // Build full path: workspace/project/feature/itemPath
      const featurePath = path.join(deps.workspaceRoot, projectId, featureName);
      const fullPath = path.join(featurePath, itemPath);
      
      // Check if path exists
      const stats = await fs.promises.stat(fullPath);
      
      if (stats.isDirectory()) {
        // Remove directory recursively
        await fs.promises.rm(fullPath, { recursive: true, force: true });
      } else {
        // Remove file
        await fs.promises.unlink(fullPath);
      }
      
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

