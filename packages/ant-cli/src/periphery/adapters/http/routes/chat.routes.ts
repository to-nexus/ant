import { Router, Request, Response } from 'express';
import { ChatService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { ChoiceService } from '../../../../infrastructure/choice';
import { ChoiceAction } from '../../../../agents/common/nodes/triage/types';

/**
 * Chat operations (messages, user interactions)
 * 
 * NOTE: LLM streaming endpoints have been removed.
 * Job workers now use direct Redis via LLMResponseService instead of HTTP.
 * 
 * Removed endpoints (now handled by LLMResponseService):
 * - POST /chat/start-message
 * - POST /chat/llm-event  
 * - POST /chat/finalize-message
 * - POST /chat/add-content
 * - POST /chat/file-operation
 * - POST /chat/command-execution
 * - GET  /chat/has-active-message
 * - POST /chat/triage-choice-message
 * 
 * @see LLMResponseService for the job worker implementation
 */
export function createChatRoutes(deps: {
  chatService?: ChatService;
  choiceService?: ChoiceService;
}): Router {
  const router = Router();
  
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
    deps.chatService.clearMessages(projectId, featureName, userContext);
    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/user-message
   * Add a user message to chat history
   * Called by UI when user sends a message
   */
  router.post('/projects/:id/features/:feature/chat/user-message', async (req: Request, res: Response) => {
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
    const messageId = await deps.chatService.addUserMessage(projectId, featureName, content, jobId, userContext);
    res.json({ messageId });
  });

  /**
   * POST /projects/:id/features/:feature/chat/job-error
   * Add job error message
   * Called by API server when job fails
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
   * POST /projects/:id/features/:feature/chat/triage-choice
   * Handle user choice from triage result
   * Called by UI when user clicks a choice button
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

    const userContext = extractUserContext(req);

    try {
      const response = await deps.choiceService.handleChoice({
        jobId,
        projectId,
        featureName,
        choice
      });

      // Update triage_choice message metadata to mark as resolved
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
        
        await deps.chatService.updateLastContentMetadata(
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

      // Finalize message for terminal choices (dismiss, guide)
      if (deps.chatService && (choice === 'dismiss' || choice === 'guide')) {
        const cancelled = choice === 'dismiss';
        await deps.chatService.finalizeCurrentMessage(projectId, featureName, cancelled, userContext);
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
   * Called by UI to show pending choice UI
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
   * Called by UI when user clicks Resume or Dismiss
   * 
   * Request body:
   * - jobId: string
   * - choice: 'resume' | 'dismiss'
   */
  router.post('/projects/:id/features/:feature/chat/cancelled-choice', async (req: Request, res: Response) => {
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
    
    // Update metadata in chat.json and Redis
    await deps.chatService.updateLastContentMetadata(
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
