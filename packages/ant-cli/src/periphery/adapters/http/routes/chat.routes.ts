import { Router, Request, Response } from 'express';
import { ChatService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { ChoiceService } from '../../../../infrastructure/choice';
import { ChoiceAction } from '../../../../agents/common/nodes/triage/types';

/**
 * Chat operations (messages, SSE, file operations, etc.)
 */
export function createChatRoutes(deps: {
  chatService?: ChatService;
  choiceService?: ChoiceService;
}): Router {
  const router = Router();
  
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

    const userContext = extractUserContext(req);
    const messages = deps.chatService.getMessages(projectId, featureName, userContext);
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

    const userContext = extractUserContext(req);
    deps.chatService.clearMessages(projectId, featureName, userContext);  // ✅ Correct method name
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

    const userContext = extractUserContext(req);
    const messageId = deps.chatService.addUserMessage(projectId, featureName, content, jobId, userContext);
    res.json({ messageId });
  });

  /**
   * GET /projects/:id/features/:feature/chat/has-active-message
   * Check if there's an active message
   * CLOUD MODE: Checks Redis for cross-Pod consistency
   */
  router.get('/projects/:id/features/:feature/chat/has-active-message', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    
    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }
    
    const userContext = extractUserContext(req);
    // Use async version for Redis check (Cloud mode cross-Pod consistency)
    const hasActive = await deps.chatService.hasActiveMessageAsync(projectId, featureName, userContext);
    res.json({ hasActive });
  });

  /**
   * POST /projects/:id/features/:feature/chat/start-message
   * Start a new assistant message
   * jobId is optional - if not provided, creates a pending message that will be associated with job later
   * CLOUD MODE: Saves currentMessage to Redis for cross-Pod consistency
   */
  router.post('/projects/:id/features/:feature/chat/start-message', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    const userContext = extractUserContext(req);
    
    // jobId is now optional - use pending jobId if not provided
    const actualJobId = jobId || `pending-${Date.now()}`;
    // Use async version for Redis storage (Cloud mode cross-Pod consistency)
    const messageId = await deps.chatService.startAssistantMessageAsync(projectId, featureName, actualJobId, userContext);
    res.json({ messageId, pendingJobId: jobId ? undefined : actualJobId });
  });

  /**
   * POST /projects/:id/features/:feature/chat/add-content
   * Add content to current message (for Chat Status Messages)
   * Returns the contentIndex for merging
   * CLOUD MODE: Recovers currentMessage from Redis if missing (cross-Pod)
   */
  router.post('/projects/:id/features/:feature/chat/add-content', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { content, jobId } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!content || !content.type) {
      res.status(400).json({ error: 'content with type is required' });
      return;
    }

    // CLOUD MODE: Ensure active message exists (cross-Pod recovery)
    // If jobId is provided and no active message, try to recover from Redis
    if (jobId) {
      const userContext = extractUserContext(req);
      const hasActive = await deps.chatService.ensureActiveMessageAsync(
        projectId, featureName, jobId, userContext
      );
      if (!hasActive) {
        // Start new message if none exists
        await deps.chatService.startAssistantMessageAsync(projectId, featureName, jobId, userContext);
      }
    }

    const contentIndex = deps.chatService.addContentToCurrentMessage(projectId, featureName, content);
    res.json({ success: true, contentIndex });
  });

  /**
   * POST /projects/:id/features/:feature/chat/llm-event
   * Handle LLM stream event
   * CLOUD MODE: Recovers currentMessage from Redis if missing (cross-Pod)
   */
  router.post('/projects/:id/features/:feature/chat/llm-event', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { event, jobId } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!event || !event.type) {
      res.status(400).json({ error: 'event with type is required' });
      return;
    }

    // CLOUD MODE: Ensure active message exists (cross-Pod recovery)
    if (jobId) {
      const userContext = extractUserContext(req);
      const hasActive = await deps.chatService.ensureActiveMessageAsync(
        projectId, featureName, jobId, userContext
      );
      if (!hasActive) {
        // Start new message if none exists
        await deps.chatService.startAssistantMessageAsync(projectId, featureName, jobId, userContext);
      }
    }

    deps.chatService.handleLLMStreamEvent(projectId, featureName, event);
    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/finalize-message
   * Finalize current streaming message
   */
  router.post('/projects/:id/features/:feature/chat/finalize-message', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { cancelled, userContext } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    try {
      await deps.chatService.finalizeCurrentMessage(projectId, featureName, cancelled || false, userContext);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to finalize message', details: String(error) });
    }
  });

  /**
   * POST /projects/:id/features/:feature/chat/file-operation
   * Add file operation notification with content
   * CLOUD MODE: Recovers currentMessage from Redis if missing (cross-Pod)
   */
  router.post('/projects/:id/features/:feature/chat/file-operation', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { operation, filePath, content, diffBefore, diffAfter, phase, error, jobId } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!operation || !filePath) {
      res.status(400).json({ error: 'operation and filePath are required' });
      return;
    }

    // CLOUD MODE: Ensure active message exists (cross-Pod recovery)
    if (jobId) {
      const userContext = extractUserContext(req);
      const hasActive = await deps.chatService.ensureActiveMessageAsync(
        projectId, featureName, jobId, userContext
      );
      if (!hasActive) {
        await deps.chatService.startAssistantMessageAsync(projectId, featureName, jobId, userContext);
      }
    }

    deps.chatService.addFileOperation(projectId, featureName, operation, filePath, content, diffBefore, diffAfter, phase, error);
    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/command-execution
   * Add command execution notification
   * CLOUD MODE: Recovers currentMessage from Redis if missing (cross-Pod)
   */
  router.post('/projects/:id/features/:feature/chat/command-execution', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { command, output, exitCode, phase, _mergeIndex, jobId } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!command) {
      res.status(400).json({ error: 'command is required' });
      return;
    }

    // CLOUD MODE: Ensure active message exists (cross-Pod recovery)
    if (jobId) {
      const userContext = extractUserContext(req);
      const hasActive = await deps.chatService.ensureActiveMessageAsync(
        projectId, featureName, jobId, userContext
      );
      if (!hasActive) {
        await deps.chatService.startAssistantMessageAsync(projectId, featureName, jobId, userContext);
      }
    }

    const contentIndex = deps.chatService.addCommandExecution(projectId, featureName, command, output, exitCode, phase, _mergeIndex);
    res.json({ success: true, contentIndex });
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
   * POST /projects/:id/features/:feature/chat/triage-choice-message
   * Add triage choice message to chat (called from agent process)
   * CLOUD MODE: Recovers currentMessage from Redis if missing (cross-Pod)
   * 
   * Request body:
   * - message: string (display message)
   * - jobId: string
   * - choiceOptions: { positive: { label, action }, negative: { label, action }, fallbackGuide? }
   * - triageResult?: TriageResult (optional, for pending choice registration)
   * - originalDirective?: string (optional, for redirect to pass to new job)
   */
  router.post('/projects/:id/features/:feature/chat/triage-choice-message', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { message, jobId, choiceOptions, triageResult, originalDirective } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!message || !jobId || !choiceOptions) {
      res.status(400).json({ error: 'message, jobId, and choiceOptions are required' });
      return;
    }

    // CLOUD MODE: Ensure active message exists (cross-Pod recovery)
    const userContext = extractUserContext(req);
    const hasActive = await deps.chatService.ensureActiveMessageAsync(
      projectId, featureName, jobId, userContext
    );
    if (!hasActive) {
      await deps.chatService.startAssistantMessageAsync(projectId, featureName, jobId, userContext);
    }

    // ✅ Register pending choice for later handling
    if (deps.choiceService && triageResult) {
      deps.choiceService.registerPendingChoice(jobId, projectId, featureName, triageResult, originalDirective);
      console.log(`[chat.routes] Registered pending choice for ${projectId}/${featureName} (directive: ${originalDirective ? 'yes' : 'no'})`);
    }

    // Add triage_choice content to current message
    deps.chatService.addContentToCurrentMessage(projectId, featureName, {
      type: 'triage_choice',
      content: message,
      metadata: {
        jobId,
        choiceOptions
      }
    });

    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/triage-choice
   * Handle user choice from triage result
   * CLOUD MODE: Recovers currentMessage from Redis if missing (cross-Pod)
   * 
   * Request body:
   * - jobId: string
   * - choice: 'proceed' | 'proceedAnyway' | 'redirect' | 'guide' | 'dismiss'
   * 
   * Response:
   * - type: 'guide' | 'continue' | 'dismiss'
   * - message?: string (for guide/dismiss)
   * - action?: string (for continue)
   */
  router.post('/projects/:id/features/:feature/chat/triage-choice', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId, choice } = req.body;

    if (!deps.choiceService) {
      res.status(503).json({ error: 'Choice service not available' });
      return;
    }

    if (!jobId || !choice) {
      res.status(400).json({ error: 'jobId and choice are required' });
      return;
    }

    // Validate choice value
    const validChoices: ChoiceAction[] = ['proceed', 'proceedAnyway', 'redirect', 'guide', 'dismiss'];
    if (!validChoices.includes(choice)) {
      res.status(400).json({ error: `Invalid choice. Must be one of: ${validChoices.join(', ')}` });
      return;
    }

    // CLOUD MODE: Ensure active message exists (cross-Pod recovery)
    const userContext = extractUserContext(req);
    if (deps.chatService) {
      const hasActive = await deps.chatService.ensureActiveMessageAsync(
        projectId, featureName, jobId, userContext
      );
      if (!hasActive) {
        await deps.chatService.startAssistantMessageAsync(projectId, featureName, jobId, userContext);
      }
    }

    try {
      const response = await deps.choiceService.handleChoice({
        jobId,
        projectId,
        featureName,
        choice
      });

      // ✅ Update triage_choice message metadata to mark as resolved
      if (deps.chatService) {
        let resolvedLabel = '';
        if (choice === 'dismiss') {
          resolvedLabel = 'Dismissed';
        } else if (choice === 'redirect' && response.suggestedJob) {
          resolvedLabel = `→ ${response.suggestedJob} job으로 전환됨`;
        } else if (choice === 'guide') {
          resolvedLabel = '가이드 제공됨';
        } else if (choice === 'proceed' || choice === 'proceedAnyway') {
          resolvedLabel = '진행됨';
        }
        
        deps.chatService.updateLastContentMetadata(
          projectId,
          featureName,
          'triage_choice',
          {
            choiceSelected: choice,
            resolvedLabel
          },
          userContext
        );
      }

      // If guide, send guide message to chat
      if (response.type === 'guide' && response.message && deps.chatService) {
        deps.chatService.addContentToCurrentMessage(projectId, featureName, {
          type: 'text',
          content: response.message
        });
      }

      res.json(response);
    } catch (error) {
      console.error('[chat.routes] triage-choice error:', error);
      res.status(500).json({ error: 'Failed to process choice' });
    }
  });

  /**
   * GET /projects/:id/features/:feature/chat/pending-choice
   * Check if there's a pending triage choice
   */
  router.get('/projects/:id/features/:feature/chat/pending-choice', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;

    if (!deps.choiceService) {
      res.status(503).json({ error: 'Choice service not available' });
      return;
    }

    const pending = deps.choiceService.getPendingChoice(projectId, featureName);
    
    if (pending) {
      res.json({
        hasPending: true,
        triageResult: pending.triageResult,
        createdAt: pending.createdAt,
        expiresAt: pending.expiresAt
      });
    } else {
      res.json({ hasPending: false });
    }
  });

  /**
   * POST /projects/:id/features/:feature/chat/cancelled-choice
   * Handle user choice for cancelled task (Resume/Dismiss)
   * 
   * Request body:
   * - jobId: string
   * - choice: 'resume' | 'dismiss'
   */
  router.post('/projects/:id/features/:feature/chat/cancelled-choice', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { jobId, choice } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!jobId || !choice) {
      res.status(400).json({ error: 'jobId and choice are required' });
      return;
    }

    const validChoices = ['resume', 'dismiss'];
    if (!validChoices.includes(choice)) {
      res.status(400).json({ error: `Invalid choice. Must be one of: ${validChoices.join(', ')}` });
      return;
    }

    const userContext = extractUserContext(req);
    const resolvedLabel = choice === 'resume' ? 'Resumed' : 'Dismissed';
    
    // Update metadata in chat.json
    deps.chatService.updateLastContentMetadata(
      projectId,
      featureName,
      'cancelled',
      { choiceSelected: choice, resolvedLabel },
      userContext
    );

    res.json({ 
      success: true, 
      choice,
      resolvedLabel
    });
  });
  
  return router;
}

