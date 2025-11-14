import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { ProjectService, ChatService } from '../services';

// ✅ Request with user context (for Cloud Mode auth)
interface RequestWithUser extends Request {
  user?: {
    id: string;
    email: string;
    organizationId: string;
  };
  organization?: {
    id: string;
    name: string;
  };
}

/**
 * Project and feature management routes
 * Handles CRUD operations for projects, features, files, and configs
 */
export function createProjectRoutes(deps: {
  projectService: ProjectService;
  workspaceRoot: string;
  chatService?: ChatService;
  mode?: 'local' | 'cloud';  // ✅ Add mode for conditional logic
}): Router {
  const router = Router();
  
  // ✅ Middleware: Set workspace path for Cloud Mode users
  router.use((req: RequestWithUser, _res, next) => {
    if (deps.mode === 'cloud' && req.user && req.organization) {
      const userWorkspacePath = path.join(
        deps.workspaceRoot,
        req.organization.id,
        req.user.id
      );
      deps.projectService.setWorkspacePath(userWorkspacePath);
    } else {
      deps.projectService.resetWorkspacePath();
    }
    next();
  });
  
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
  
  // List projects (workspace path is set by middleware)
  router.get('/projects', async (req: RequestWithUser, res: Response) => {
    try {
      const projects = await deps.projectService.listProjects();
      
      if (deps.mode === 'cloud' && req.user) {
        console.log(`[Projects] Listed ${projects.length} projects for ${req.user.id}@${req.organization?.id}`);
      }
      
      res.json(projects);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Create a new project (workspace path is set by middleware)
  router.post('/projects', async (req: RequestWithUser, res: Response) => {
    try {
      const { id } = req.body;
      
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Project ID is required and must be a string' });
      }
      
      // ✅ Ensure user workspace exists (Cloud Mode)
      if (deps.mode === 'cloud' && req.user && req.organization) {
        const userWorkspacePath = path.join(
          deps.workspaceRoot,
          req.organization.id,
          req.user.id
        );
        await fs.promises.mkdir(userWorkspacePath, { recursive: true });
        console.log(`[Projects] Creating project '${id}' for ${req.user.id}@${req.organization.id}`);
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
      
      // Format for API response (path not needed, frontend uses name)
      const formattedFeatures = features.map(name => ({ name }));
      
      res.json(formattedFeatures);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Create a new feature (workspace path is set by middleware)
  router.post('/projects/:id/features', async (req: RequestWithUser, res: Response) => {
    try {
      const projectId = req.params.id;
      const { featureName } = req.body;
      
      if (!featureName) {
        res.status(400).json({ error: 'featureName is required' });
        return;
      }
      
      // ✅ Use ProjectService.createFeature (respects currentWorkspacePath)
      await deps.projectService.createFeature(projectId, featureName);
      
      if (deps.mode === 'cloud' && req.user) {
        console.log(`[Features] Created feature '${featureName}' for ${req.user.id}@${req.organization?.id}`);
      }
      
      res.json({ success: true, featureName });
    } catch (error: any) {
      if (error.message === 'Feature already exists') {
        res.status(409).json({ error: error.message });
      } else {
      res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Delete a feature (workspace path is set by middleware)
  router.delete('/projects/:id/features/:feature', async (req: RequestWithUser, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      
      // ✅ Use ProjectService.deleteFeature (respects currentWorkspacePath)
      await deps.projectService.deleteFeature(projectId, featureName);
      
      if (deps.mode === 'cloud' && req.user) {
        console.log(`[Features] Deleted feature '${featureName}' for ${req.user.id}@${req.organization?.id}`);
      }
      
      res.json({ success: true, message: `Feature ${featureName} deleted` });
    } catch (error: any) {
      if (error.message === 'Feature not found') {
        res.status(404).json({ error: error.message });
      } else {
      res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Get session for a specific feature (workspace path is set by middleware)
  router.get('/projects/:id/features/:feature/session', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const job = (req.query.job as 'design' | 'code' | 'learn') || 'code';
      
      // ✅ Use ProjectService.getSession (respects currentWorkspacePath)
      const sessionData = await deps.projectService.getSession(projectId, featureName, job);
      res.json(sessionData);
    } catch (error: any) {
      if (error.message === 'Session file not found' || error.message.includes('not found')) {
        res.json(null);
      } else {
        res.status(500).json({ error: error.message });
      }
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
  
  // Get file tree for a feature (workspace path is set by middleware)
  router.get('/projects/:id/features/:feature/files', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      
      // ✅ Use ProjectService.getFileTree (respects currentWorkspacePath)
      const tree = await deps.projectService.getFileTree(projectId, featureName);
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
  
  // Get file content (workspace path is set by middleware)
  router.get(/^\/projects\/([^\/]+)\/features\/([^\/]+)\/files\/(.+)$/, async (req: Request, res: Response) => {
    try {
      const projectId = req.params[0];
      const featureName = req.params[1];
      const filePath = req.params[2];
      
      if (!filePath) {
        res.status(400).json({ error: 'File path is required' });
        return;
      }
      
      // ✅ Use ProjectService.readFile (respects currentWorkspacePath)
      const content = await deps.projectService.readFile(projectId, featureName, filePath);
      res.json({ path: filePath, content });
    } catch (error: any) {
      if (error.message.includes('not found') || error.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
      } else if (error.message.includes('directory')) {
        res.status(400).json({ error: 'Path is a directory, not a file' });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  });
  
  // Update file content (workspace path is set by middleware)
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
      
      // ✅ Use ProjectService.writeFile (respects currentWorkspacePath)
      await deps.projectService.writeFile(projectId, featureName, filePath, content);
      
      res.json({ success: true, path: filePath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Upload files to a feature directory (workspace path is set by middleware)
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
      
      // ✅ Use ProjectService.getWorkspacePath() (respects currentWorkspacePath)
      const baseDir = path.join(
        deps.projectService.getWorkspacePath(),
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
      
      // Note: File tree update is now handled by SSEService via notifyFileTreeUpdate
      
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

  // Create directory in a feature (workspace path is set by middleware)
  router.post('/projects/:id/features/:feature/directory', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const { path: dirPath } = req.body;
      
      if (!dirPath) {
        return res.status(400).json({ error: 'Directory path is required' });
      }
      
      // ✅ Use ProjectService.getWorkspacePath() (respects currentWorkspacePath)
      const projectPath = path.join(deps.projectService.getWorkspacePath(), projectId);
      const fullPath = path.join(projectPath, dirPath);
      
      // Create directory recursively
      await fs.promises.mkdir(fullPath, { recursive: true });
      
      res.json({ success: true, path: dirPath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete file or directory in a feature (workspace path is set by middleware)
  router.delete('/projects/:id/features/:feature/item', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const { path: itemPath } = req.body;
      
      if (!itemPath) {
        return res.status(400).json({ error: 'Item path is required' });
      }
      
      // ✅ Use ProjectService.getWorkspacePath() (respects currentWorkspacePath)
      const featurePath = path.join(deps.projectService.getWorkspacePath(), projectId, featureName);
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

  // ===================================================================
  // Chat SSE - Real-time AI chat messages
  // ===================================================================
  
  /**
   * GET /projects/:id/features/:feature/chat/stream
   * SSE endpoint for real-time chat messages
   * ⚠️ DEPRECATED: Use unified SSE endpoint /projects/:id/features/:feature/stream instead
   */
  // ⚠️ DEPRECATED: Redirect to unified SSE endpoint
  router.get('/projects/:id/features/:feature/chat/stream', (req: Request, res: Response) => {
    res.status(410).json({ 
      error: 'Endpoint deprecated',
      message: 'Use /projects/:id/features/:feature/stream instead',
      newEndpoint: `/projects/${req.params.id}/features/${req.params.feature}/stream`
    });
  });

  /**
   * GET /projects/:id/features/:feature/chat/messages
   * Get all chat messages for a feature
   */
  router.get('/projects/:id/features/:feature/chat/messages', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    const messages = deps.chatService.getMessages(projectId, featureName);
    res.json({ messages });
  });

  /**
   * DELETE /projects/:id/features/:feature/chat/messages
   * Clear all chat messages for a feature
   */
  router.delete('/projects/:id/features/:feature/chat/messages', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    deps.chatService.clearMessages(projectId, featureName);
    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/user-message
   * Add a user message to chat history
   */
  router.post('/projects/:id/features/:feature/chat/user-message', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { content, jobId } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const messageId = deps.chatService.addUserMessage(projectId, featureName, content, jobId);
    res.json({ messageId });
  });

  /**
   * POST /projects/:id/features/:feature/chat/start-message
   * Start a new assistant message
   * jobId is optional - if not provided, creates a pending message that will be associated with job later
   */
  router.post('/projects/:id/features/:feature/chat/start-message', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    // ✅ jobId is now optional - use pending jobId if not provided
    const actualJobId = jobId || `pending-${Date.now()}`;
    const messageId = deps.chatService.startAssistantMessage(projectId, featureName, actualJobId);
    res.json({ messageId, pendingJobId: jobId ? undefined : actualJobId });
  });

  /**
   * POST /projects/:id/features/:feature/chat/add-content
   * Add content to current message (for Chat Status Messages)
   */
  router.post('/projects/:id/features/:feature/chat/add-content', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { content } = req.body;

    // Add content to chat service

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!content || !content.type) {
      res.status(400).json({ error: 'content with type is required' });
      return;
    }

    deps.chatService.addContentToCurrentMessage(projectId, featureName, content);
    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/llm-event
   * Handle LLM stream event
   */
  router.post('/projects/:id/features/:feature/chat/llm-event', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { event } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!event || !event.type) {
      res.status(400).json({ error: 'event with type is required' });
      return;
    }

    deps.chatService.handleLLMStreamEvent(projectId, featureName, event);
    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/finalize-message
   * Finalize current streaming message
   */
  router.post('/projects/:id/features/:feature/chat/finalize-message', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    deps.chatService.finalizeCurrentMessage(projectId, featureName);
    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/file-operation
   * Add file operation notification with content
   */
  router.post('/projects/:id/features/:feature/chat/file-operation', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { operation, filePath, content, diffBefore, diffAfter, phase } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!operation || !filePath) {
      res.status(400).json({ error: 'operation and filePath are required' });
      return;
    }

    deps.chatService.addFileOperation(projectId, featureName, operation, filePath, content, diffBefore, diffAfter, phase);
    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/command-execution
   * Add command execution notification
   */
  router.post('/projects/:id/features/:feature/chat/command-execution', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { command, output, exitCode, phase } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!command) {
      res.status(400).json({ error: 'command is required' });
      return;
    }

    deps.chatService.addCommandExecution(projectId, featureName, command, output, exitCode, phase);
    res.json({ success: true });
  });



  /**
   * POST /projects/:id/features/:feature/chat/job-error
   * Add job error message
   */
  router.post('/projects/:id/features/:feature/chat/job-error', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId, errorMessage, errorDetails } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!jobId || !errorMessage) {
      res.status(400).json({ error: 'jobId and errorMessage are required' });
      return;
    }

    const messageId = deps.chatService.addJobError(projectId, featureName, jobId, errorMessage, errorDetails);
    res.json({ messageId });
  });

  /**
   * DELETE /projects/:id/features/:feature/session
   * Clear session data for a specific job type
   */
  router.delete('/projects/:id/features/:feature/session', async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      const featureName = req.params.feature;
      const jobType = (req.query.job as 'design' | 'code' | 'learn') || 'code';
      
      // ✅ Use ProjectService.getWorkspacePath() (respects currentWorkspacePath)
      const sessionPath = path.join(
        deps.projectService.getWorkspacePath(),
        projectId,
        featureName,
        `sessions/${jobType}.json`
      );
      
      // Check if session file exists
      const exists = await fs.promises.access(sessionPath)
        .then(() => true)
        .catch(() => false);
      
      if (!exists) {
        console.log(`[Session] No session file to clear: ${sessionPath}`);
        return res.json({ success: true, message: 'No session data to clear' });
      }
      
      // Read existing session
      const sessionData = JSON.parse(await fs.promises.readFile(sessionPath, 'utf-8'));
      
      // Clear job-related data but keep structure
      const clearedSession = {
        ...sessionData,
        state: {
          taskQueue: [],
          completedTasks: [],
          completedTasksDetails: [],
          currentTask: null,
          jobId: undefined,
          jobTiming: undefined,
          recursionCount: 0,
          recursionLimit: sessionData.state?.recursionLimit || 50,
          interruption: undefined
        }
      };
      
      // Write cleared session
      await fs.promises.writeFile(sessionPath, JSON.stringify(clearedSession, null, 2), 'utf-8');
      
      console.log(`[Session] ✅ Cleared session data: ${projectId}/${featureName}/${jobType}.json`);
      res.json({ success: true, message: 'Session data cleared' });
    } catch (error: any) {
      console.error('[Session] ❌ Error clearing session:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
}

