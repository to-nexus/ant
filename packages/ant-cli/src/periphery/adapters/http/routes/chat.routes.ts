import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ChatService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { ChoiceService } from '../../../../infrastructure/choice';
import { ChoiceAction } from '../../../../agents/common/nodes/triage/types';
import { getRealtimeBroadcastChannel } from '../../../../core/realtime/types';
import { chatRateLimiter } from '../middleware/rateLimiter';
import { validateBody, chatUserMessageSchema } from '../middleware/validateBody';
import { logger } from '../../../../utils/logger';

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
  workspaceResolver?: any;
  fileTreeNotifier?: { notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): void };
  stateStore?: {
    addUnseenArtifacts(userId: string, projectId: string, feature: string, paths: string[]): Promise<void>;
    getUnseenArtifacts(userId: string, projectId: string, feature: string): Promise<string[]>;
    publish(channel: string, message: any): Promise<void>;
  };
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
  router.post('/projects/:id/features/:feature/chat/user-message', chatRateLimiter, validateBody(chatUserMessageSchema), async (req: Request, res: Response) => {
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
      logger.error('Triage choice error', { component: 'Chat' }, error);
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
   * POST /projects/:id/features/:feature/chat/eval-save
   * Save evaluation report to outputs/evals/{evalType}/
   * 
   * Request body:
   * - evalType: 'prd' | 'system-design' | 'ui-design' | 'code' | 'all'
   * - content: string (markdown content of evaluation)
   */
  router.post('/projects/:id/features/:feature/chat/eval-save', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { evalType, content } = req.body;

    if (!evalType || !content) {
      res.status(400).json({ error: 'evalType and content are required' });
      return;
    }

    const validTypes = ['prd', 'system-design', 'ui-design', 'code', 'all'];
    if (!validTypes.includes(evalType)) {
      res.status(400).json({ error: `Invalid evalType. Must be one of: ${validTypes.join(', ')}` });
      return;
    }

    const userContext = extractUserContext(req);

    try {
      // Resolve feature path
      let featurePath: string;
      if (deps.workspaceResolver) {
        featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      } else {
        // Fallback for local mode
        const workspaceRoot = process.env.ANT_WORKSPACE_ROOT || process.cwd();
        featurePath = path.join(workspaceRoot, 'ant-workspaces', projectId, featureName);
      }

      // Build save path: outputs/evals/{evalType}/eval-{timestamp}.md
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const evalDir = path.join(featurePath, 'outputs', 'evals', evalType);
      const evalFilePath = path.join(evalDir, `eval-${timestamp}.md`);
      const relativePath = `outputs/evals/${evalType}/eval-${timestamp}.md`;

      // Ensure directory exists
      await fs.mkdir(evalDir, { recursive: true });

      // Write evaluation report
      await fs.writeFile(evalFilePath, content, 'utf-8');

      logger.debug(`📋 [chat.routes] Eval report saved: ${relativePath}`);

      // ✅ Notify file tree update after eval report write
      if (deps.fileTreeNotifier) {
        deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext);
      }

      // ✅ Add unseen artifact notification for eval report
      if (deps.stateStore) {
        try {
          await deps.stateStore.addUnseenArtifacts(userContext.userId, projectId, featureName, [relativePath]);
          // Broadcast updated unseen list via Redis Pub/Sub → Realtime Server → SSE
          const allUnseen = await deps.stateStore.getUnseenArtifacts(userContext.userId, projectId, featureName);
          const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
          await deps.stateStore.publish(channel, {
            projectId, featureName, type: 'unseenArtifacts',
            data: { type: 'update', paths: allUnseen },
            userContext,
          });
        } catch (e) {
          logger.warn(`[chat.routes] Failed to add unseen artifact: ${(e as Error).message}`);
        }
      }

      // Update choice card metadata to mark as saved
      // ✅ metadataFilter ensures we update the correct choice_card (eval_save, not prd_apply)
      if (deps.chatService) {
        await deps.chatService.updateLastContentMetadata(
          projectId,
          featureName,
          'choice_card',
          { choiceSelected: 'save', resolvedLabel: `Saved: ${relativePath}` },
          userContext,
          { cardType: 'eval_save' }
        );
      }

      res.json({
        success: true,
        path: relativePath,
        resolvedLabel: `Saved: ${relativePath}`
      });
    } catch (error: any) {
      logger.error('Eval save error', { component: 'Chat' }, error);
      res.status(500).json({ error: 'Failed to save evaluation report' });
    }
  });

  /**
   * POST /projects/:id/features/:feature/chat/prd-apply
   * Apply PRD draft from outputs/plan/prd-refine.md to inputs/sources/prd.md
   */
  router.post('/projects/:id/features/:feature/chat/prd-apply', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const userContext = extractUserContext(req);

    try {
      // Resolve feature path
      let featurePath: string;
      if (deps.workspaceResolver) {
        featurePath = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      } else {
        const workspaceRoot = process.env.ANT_WORKSPACE_ROOT || process.cwd();
        featurePath = path.join(workspaceRoot, 'ant-workspaces', projectId, featureName);
      }

      const sourcePath = path.join(featurePath, 'outputs', 'plan', 'prd-refine.md');
      const targetPath = path.join(featurePath, 'inputs', 'sources', 'prd.md');

      // Read the draft
      const draftContent = await fs.readFile(sourcePath, 'utf-8');

      // Ensure target directory exists
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      // Write to inputs/sources/prd.md
      await fs.writeFile(targetPath, draftContent, 'utf-8');

      // Remove staging copy (no longer needed after apply)
      try {
        await fs.unlink(sourcePath);
      } catch {
        // Non-critical — staging file may already be gone
      }

      logger.debug(`📋 [chat.routes] PRD applied: outputs/plan/prd-refine.md → inputs/sources/prd.md (staging removed)`);

      // ✅ Notify file tree update after PRD apply write
      if (deps.fileTreeNotifier) {
        deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext);
      }

      // ✅ Add unseen artifact notification for applied PRD
      if (deps.stateStore) {
        try {
          await deps.stateStore.addUnseenArtifacts(userContext.userId, projectId, featureName, ['inputs/sources/prd.md']);
          const allUnseen = await deps.stateStore.getUnseenArtifacts(userContext.userId, projectId, featureName);
          const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
          await deps.stateStore.publish(channel, {
            projectId, featureName, type: 'unseenArtifacts',
            data: { type: 'update', paths: allUnseen },
            userContext,
          });
        } catch (e) {
          logger.warn(`[chat.routes] Failed to add unseen artifact: ${(e as Error).message}`);
        }
      }

      // Update choice card metadata
      // ✅ metadataFilter ensures we update the correct choice_card (prd_apply, not eval_save)
      if (deps.chatService) {
        await deps.chatService.updateLastContentMetadata(
          projectId,
          featureName,
          'choice_card',
          { choiceSelected: 'apply', resolvedLabel: 'Applied to inputs/sources/prd.md' },
          userContext,
          { cardType: 'prd_apply' }
        );
      }

      res.json({
        success: true,
        resolvedLabel: 'Applied to inputs/sources/prd.md'
      });
    } catch (error: any) {
      logger.error('PRD apply error', { component: 'Chat' }, error);
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'PRD draft not found at outputs/plan/prd-refine.md' });
      } else {
        res.status(500).json({ error: 'Failed to apply PRD' });
      }
    }
  });

  /**
   * POST /projects/:id/features/:feature/chat/dismiss-choice
   * Unified choice persistence endpoint for ALL choice card types.
   * Persists the choice state to chat.json + Redis so it survives page refresh in multi-pod.
   * 
   * ✅ Replaces the old cancelled-choice endpoint — all choice persistence goes through here.
   * 
   * Body: { contentType: string, choiceAction: string, resolvedLabel: string, metadataFilter?: Record<string, string> }
   *   - contentType: the content.type to find (e.g. 'choice_card', 'triage_choice', 'cancelled')
   *   - choiceAction: the action to record (e.g. 'resume', 'dismiss', 'keep_draft', 'skip')
   *   - resolvedLabel: display label (e.g. 'Resumed', 'Dismissed', 'Kept as draft', 'Skipped')
   *   - metadataFilter: optional metadata fields to match for precise content targeting
   *     e.g. { cardType: 'eval_save' } for choice_card subtypes
   *     e.g. { jobId: 'xxx' } for specific cancelled message
   */
  router.post('/projects/:id/features/:feature/chat/dismiss-choice', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const userContext = extractUserContext(req);
    const { contentType, choiceAction, resolvedLabel, metadataFilter, extraMetadata } = req.body || {};

    if (!contentType || !choiceAction || !resolvedLabel) {
      return res.status(400).json({ error: 'contentType, choiceAction, and resolvedLabel are required' });
    }

    try {
      if (deps.chatService) {
        await deps.chatService.updateLastContentMetadata(
          projectId,
          featureName,
          contentType,
          { choiceSelected: choiceAction, resolvedLabel, ...(extraMetadata || {}) },
          userContext,
          metadataFilter || undefined
        );
      }

      logger.debug(`📋 [chat.routes] Choice persisted: ${contentType}${metadataFilter ? `(${JSON.stringify(metadataFilter)})` : ''} → ${choiceAction} (${resolvedLabel})`);

      res.json({ success: true, choiceAction, resolvedLabel });
    } catch (error: any) {
      logger.error('Dismiss choice error', { component: 'Chat' }, error);
      res.status(500).json({ error: 'Failed to persist choice' });
    }
  });
  
  return router;
}
