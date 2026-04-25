import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ChatService } from '../services';
import { extractUserContext } from './helpers/userContext';
import { ChoiceService } from '../../../../infrastructure/choice';
import type { ChoiceAction } from '../../../../agents/common/graph/nodes/triage/types';
import { getRealtimeBroadcastChannel } from '../../../../core/realtime/types';
import { chatRateLimiter } from '../middleware/rateLimiter';
import { validateBody, chatUserMessageSchema } from '../middleware/validateBody';
import { logger } from '../../../../utils/logger';

/**
 * Chat routes — HTTP-side façade for chat.jsonl writes + SSE.
 *
 * Phase 9 chat-SSOT collapse:
 *  - `/chat/triage-choice`, `/chat/eval-save`, `/chat/dismiss-choice`
 *    are retired. Every choice resolution now flows through the
 *    unified `POST /chat/choice-resolved` route.
 *  - `DELETE /chat/messages?cancelActive=true|false` controls whether
 *    a still-running job is also cancelled before clearing the log.
 *  - `POST /chat/job-error` emits a single `assistant_message` line via
 *    `chatService.appendAssistantMessage`.
 *  - `POST /chat/user-message` emits an optimistic `chat_event_appended`
 *    SSE only — the durable user_turn line is written by the worker's
 *    `recordUserTurn` (chat-SSOT §6).
 *
 * @see docs/architecture/31-chat-system.md
 */
export function createChatRoutes(deps: {
  chatService?: ChatService;
  choiceService?: ChoiceService;
  workspaceResolver?: any;
  fileTreeNotifier?: { notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: any): Promise<void> };
  stateStore?: {
    addUnseenArtifacts(userId: string, projectId: string, feature: string, paths: string[]): Promise<void>;
    getUnseenArtifacts(userId: string, projectId: string, feature: string): Promise<string[]>;
    publish(channel: string, message: any): Promise<void>;
  };
  /**
   * Optional terminator for a still-running job. Wired by the http
   * composition root; on `DELETE /chat/messages?cancelActive=true`
   * we route through this so the job seal pipeline runs in one
   * transaction with the chat clear.
   */
  finalizeActiveJob?: (
    projectId: string,
    featureName: string,
    userContext: { userId: string; organizationId: string },
  ) => Promise<void>;
}): Router {
  const router = Router();

  /**
   * DELETE /projects/:id/features/:feature/chat/messages
   *
   * Clear the chat log for a feature. Behaviour:
   *  - default (`?cancelActive=false`): collapses `chat.jsonl`, drops
   *    every active turn buffer, and broadcasts `events_cleared`
   *    (scope='chat'). `feature.jsonl` (LLM context) is preserved.
   *  - `?cancelActive=true`: additionally seals any still-running job
   *    via `finalizeActiveJob` (user-stopped) before clearing — used
   *    by the F5 Hard Reset flow.
   */
  router.delete('/projects/:id/features/:feature/chat/messages', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const cancelActive = req.query.cancelActive === 'true';

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    const userContext = extractUserContext(req);

    if (cancelActive && deps.finalizeActiveJob) {
      try {
        await deps.finalizeActiveJob(projectId, featureName, userContext);
      } catch (err) {
        logger.warn(`finalizeActiveJob failed during chat clear`, { component: 'Chat' }, err);
      }
    }

    await deps.chatService.clearEventsAsync(projectId, featureName, 'chat', userContext);

    // Chat clearing may delete draft images; the file tree is push-based.
    if (deps.fileTreeNotifier) {
      deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext);
    }

    res.json({ success: true });
  });

  /**
   * POST /projects/:id/features/:feature/chat/user-message
   *
   * Mints a stable `turnId` and emits the optimistic SSE echo so the
   * user's bubble appears immediately. The durable `user_turn` line is
   * written by the worker's `recordUserTurn` once the job spawns
   * (chat-SSOT §6) — both views share the same `user-{turnId}` id so
   * SSE reconnect dedupes via the FE projector.
   */
  router.post('/projects/:id/features/:feature/chat/user-message', chatRateLimiter, validateBody(chatUserMessageSchema), async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { content, actionMetadata } = req.body;

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const userContext = extractUserContext(req);
    const { generateTurnId } = await import('../../../../composition/recordUserTurn');
    const turnId = generateTurnId();

    await deps.chatService.appendUserTurn(
      projectId,
      featureName,
      content,
      turnId,
      undefined,
      userContext,
      actionMetadata,
    );

    res.json({ turnId, messageId: `user-${turnId}` });
  });

  /**
   * POST /projects/:id/features/:feature/chat/job-error
   *
   * Single `assistant_message` line carrying the failure summary.
   * Replaces the legacy `MessageManager.addJobError` path.
   */
  router.post('/projects/:id/features/:feature/chat/job-error', async (req: Request, res: Response) => {
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

    const userContext = extractUserContext(req);
    const text =
      `❌ **Job Failed**\n\n${errorMessage}` +
      (errorDetails ? `\n\nDetails:\n${JSON.stringify(errorDetails, null, 2)}` : '');

    await deps.chatService.appendAssistantMessage(projectId, featureName, text, {
      jobId,
      userContext,
    });

    res.json({ success: true });
  });

  /**
   * GET /projects/:id/features/:feature/chat/pending-choice
   *
   * Surface the pending triage choice so the UI can re-render it on
   * navigation away/back. Untouched by Phase 9.
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
        expiresAt: pending.expiresAt,
      });
    } else {
      res.json({ hasPending: false });
    }
  });

  /**
   * POST /projects/:id/features/:feature/chat/choice-resolved
   *
   * Unified choice resolution endpoint. Body:
   *   {
   *     cardId: string,
   *     choiceSelected: string,         // 'proceed' | 'dismiss' | 'save' | …
   *     resolvedLabel: string,          // user-visible label after resolve
   *     answer?: Record<string, unknown> // free-form payload (eval content,
   *                                     // clarifying answers, redirected job, …)
   *   }
   *
   * Pipeline:
   *  1. Resolve `(turnId, jobId)` from the originating `choice_presented`
   *     line via `findTurnIdByCardId`.
   *  2. cardType-specific side-effects (eval_save → file write +
   *     unseenArtifacts notification; triage_choice → ChoiceService
   *     routing decision + optional guide message).
   *  3. `appendChoiceResolved` writes `chat.jsonl choice_resolved`,
   *     broadcasts `chat_event_appended` SSE, and publishes the
   *     `ant:chat:choice-resolved:{sessionKey}` Pub/Sub envelope so a
   *     waiting worker promise resolves cross-pod.
   *
   * Idempotency lives in ChatService.appendChoiceResolved — the per-cardId
   * NX flag ensures a duplicate click no-ops at the BE layer.
   */
  router.post('/projects/:id/features/:feature/chat/choice-resolved', async (req: Request, res: Response) => {
    const projectId = req.params.id;
    const featureName = req.params.feature;
    const { cardId, choiceSelected, resolvedLabel, answer } = req.body || {};

    if (!cardId || !choiceSelected || !resolvedLabel) {
      res.status(400).json({ error: 'cardId, choiceSelected, and resolvedLabel are required' });
      return;
    }

    if (!deps.chatService) {
      res.status(503).json({ error: 'Chat service not available' });
      return;
    }

    const userContext = extractUserContext(req);

    try {
      // 1. Resolve the turn that originally presented the card. Without
      //    a matching choice_presented line we cannot append a paired
      //    choice_resolved line — surface 404 so the FE can redo the
      //    state-rebuild step instead of silently swallowing the click.
      const ctx = await deps.chatService.findTurnIdByCardId(projectId, featureName, cardId, userContext);
      if (!ctx) {
        res.status(404).json({ error: 'choice card not found', cardId });
        return;
      }

      // 2. cardType-specific side-effects. We re-read the chat.jsonl
      //    line to inspect cardType because the FE only carries cardId
      //    + choiceSelected (the legacy contract).
      const events = await deps.chatService.loadEventsAsync(projectId, featureName, userContext);
      const presented = events.find(
        (l) => l.type === 'choice_presented' && (l as any).cardId === cardId,
      ) as
        | { type: 'choice_presented'; cardType: string; payload?: Record<string, any> }
        | undefined;
      const cardType = presented?.cardType ?? '';

      let routingResponse: any = null;

      // 2a. eval_save card — persist evaluation content to disk and
      //     announce the unseen artifact. The FE's Save click sets
      //     choiceSelected='save'; other choices (dismiss / cancel)
      //     fall through to plain choice_resolved.
      if (cardType === 'eval_save' && choiceSelected === 'save' && answer) {
        const { evalType, content: evalContent } = answer as { evalType?: string; content?: string };
        if (evalType && evalContent && deps.workspaceResolver) {
          try {
            const featurePath: string = deps.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            const evalDir = path.join(featurePath, 'outputs', 'evals', evalType);
            const evalFilePath = path.join(evalDir, `eval-${timestamp}.md`);
            const relativePath = `outputs/evals/${evalType}/eval-${timestamp}.md`;

            await fs.mkdir(evalDir, { recursive: true });
            await fs.writeFile(evalFilePath, evalContent, 'utf-8');

            if (deps.fileTreeNotifier) {
              deps.fileTreeNotifier.notifyFileTreeUpdate(projectId, featureName, userContext);
            }

            if (deps.stateStore) {
              try {
                await deps.stateStore.addUnseenArtifacts(userContext.userId, projectId, featureName, [relativePath]);
                const allUnseen = await deps.stateStore.getUnseenArtifacts(userContext.userId, projectId, featureName);
                const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
                await deps.stateStore.publish(channel, {
                  projectId,
                  featureName,
                  type: 'unseenArtifacts',
                  data: { type: 'update', paths: allUnseen },
                  userContext,
                });
              } catch (e) {
                logger.warn(`Failed to add unseen artifact: ${(e as Error).message}`, { component: 'Chat' });
              }
            }

            // Inject the saved path into `answer` so the persisted
            // choice_resolved line carries the artifact reference.
            (answer as any).savedPath = relativePath;
          } catch (err) {
            logger.error('Eval save error', { component: 'Chat' }, err);
            res.status(500).json({ error: 'Failed to save evaluation report' });
            return;
          }
        }
      }

      // 2b. triage_choice card — invoke ChoiceService for routing
      //     (proceed / proceedAnyway / redirect / guide / dismiss).
      //     The response carries the BE-side decision and is forwarded
      //     to the FE so the existing UI flow keeps working until the
      //     Phase 12 FE migration.
      if (cardType === 'triage_choice' && deps.choiceService) {
        const validChoices: ChoiceAction[] = ['proceed', 'proceedAnyway', 'redirect', 'guide', 'dismiss'];
        if (!validChoices.includes(choiceSelected as ChoiceAction)) {
          res.status(400).json({ error: `Invalid choice for triage card: ${choiceSelected}` });
          return;
        }
        try {
          routingResponse = await deps.choiceService.handleChoice({
            jobId: ctx.jobId,
            projectId,
            featureName,
            choice: choiceSelected as ChoiceAction,
          });

          // Surface the guide message as an assistant_message so it
          // persists in chat.jsonl and survives reload.
          if (routingResponse?.type === 'guide' && routingResponse.message) {
            await deps.chatService.appendAssistantMessage(
              projectId,
              featureName,
              routingResponse.message,
              { jobId: ctx.jobId, turnId: ctx.turnId, userContext },
            );
          }
        } catch (err) {
          logger.error('Triage choice routing failed', { component: 'Chat' }, err);
          res.status(500).json({ error: 'Failed to process triage choice' });
          return;
        }
      }

      // 3. Single-shot choice_resolved emission (NX-guarded inside
      //    ChatService).
      const result = await deps.chatService.appendChoiceResolved(projectId, featureName, {
        jobId: ctx.jobId,
        cardId,
        choiceSelected,
        resolvedLabel,
        answer,
        userContext,
      });

      res.json({ success: true, resolved: result.resolved, ...(routingResponse ? { routing: routingResponse } : {}) });
    } catch (error: any) {
      logger.error('Choice resolution error', { component: 'Chat' }, error);
      res.status(500).json({ error: 'Failed to resolve choice' });
    }
  });

  return router;
}
