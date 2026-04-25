/**
 * MessageManager - Manages chat messages
 * 
 * Handles user/assistant message creation and lifecycle
 * CLOUD MODE: Uses Redis for cross-Pod consistency of currentMessage
 */

import type { ChatMessage, MessageContent, ChatSession } from './types';
import type { SessionManager } from './SessionManager';
import type { SessionPersistence } from './SessionPersistence';
import type { MessageBroadcaster } from './MessageBroadcaster';
import type { ContentMerger } from './ContentMerger';
import type { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';

export class MessageManager {
  constructor(
    private sessionManager: SessionManager,
    private persistence: SessionPersistence,
    private broadcaster: MessageBroadcaster,
    private contentMerger: ContentMerger
  ) {}

  /**
   * Add user message to chat history
   * CLOUD MODE: Waits for Redis save to ensure message order consistency
   */
  /**
   * Append a user message to the live SSE stream with a STABLE id derived
   * from the supplied `turnId`. The id `user-{turnId}` matches the durable
   * id assigned by `ChatLogToMessages.toUserMessage` when chat.jsonl is
   * later rebuilt — so optimistic + durable views collapse to a single
   * entry on reconnect (eliminates the "two user messages on tab switch"
   * defect).
   *
   * The caller (typically `chat.routes.ts` `/chat/user-message`) is
   * responsible for generating the turnId and forwarding it to the worker
   * via `executeJob({ seedTurnId })`. The worker reuses the id when
   * recording the durable user_turn line.
   *
   * `jobId` is intentionally accepted but rarely populated at the API
   * tier — it becomes known only after enqueue, and the durable
   * `chat.jsonl` user_turn line carries the authoritative jobId.
   */
  async addUserMessage(
    projectId: string,
    featureName: string,
    content: string,
    turnId: string,
    jobId?: string,
    userContext?: UserContext,
    actionMetadata?: import('@ant/shared').ActionMetadata,
  ): Promise<string> {
    const session = this.sessionManager.getOrCreateSession(projectId, featureName, jobId, userContext);

    const messageId = `user-${turnId}`;
    const userMessage: ChatMessage = {
      id: messageId,
      role: 'user',
      contents: [{
        type: 'text',
        content
      }],
      timestamp: new Date().toISOString(),
      jobId,
      ...(actionMetadata && Object.keys(actionMetadata).length > 0 && { actionMetadata }),
    };

    // De-dup at the scratchpad level: if the same turnId was already
    // pushed (e.g. /chat/user-message retried by network layer), skip the
    // second push so SSE consumers don't render twice.
    const alreadyPresent = session.messages.some((m) => m.id === messageId);
    if (!alreadyPresent) {
      session.messages.push(userMessage);
    }

    // ✅ CRITICAL: Wait for Redis save to ensure message order in Cloud mode
    // Without this, Job Worker may start before user message is in Redis,
    // causing assistant message to appear before user message.
    // Durable user_turn record is written by orchestrator.recordUserTurn
    // against chat.jsonl — this scratchpad only drives live SSE delivery.
    try {
      await this.sessionManager.saveSessionAsync(projectId, featureName, session, userContext);
    } catch (err) {
      logger.warn('Failed to save session to Redis', { component: 'MessageManager' }, err);
    }

    // Broadcast new user message (idempotent — frontend dedups by id).
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'user_message',
      message: userMessage
    }, session.userContext);

    return messageId;
  }

  /**
   * Start a new assistant message (for streaming)
   * CLOUD MODE: Saves currentMessage to Redis for cross-Pod consistency
   */
  startAssistantMessage(
    projectId: string, 
    featureName: string, 
    jobId: string, 
    userContext?: UserContext
  ): string {
    const session = this.sessionManager.getOrCreateSession(projectId, featureName, jobId, userContext);
    
    // If there's already a current message being streamed, reuse it
    if (session.currentMessage && session.currentMessage.isStreaming) {
      return session.currentMessage.id;
    }
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const newMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [],
      timestamp: new Date().toISOString(),
      jobId,
      isStreaming: true
    };

    session.currentMessage = newMessage;
    
    // Save currentMessage to Redis for cross-Pod consistency
    this.sessionManager.setCurrentMessageAsync(
      projectId, 
      featureName, 
      newMessage, 
      userContext
    ).catch(err => {
      logger.warn('Failed to save currentMessage to Redis', { component: 'MessageManager' }, err);
    });
    
    // Broadcast message start
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'message_start',
      message: newMessage
    }, session.userContext);

    return messageId;
  }

  /**
   * Start assistant message (async version for Cloud mode)
   */
  async startAssistantMessageAsync(
    projectId: string, 
    featureName: string, 
    jobId: string, 
    userContext?: UserContext
  ): Promise<string> {
    const session = await this.sessionManager.getOrCreateSessionAsync(projectId, featureName, jobId, userContext);
    
    // Check Redis for existing streaming message (cross-Pod)
    const existingMessage = await this.sessionManager.getCurrentMessageAsync(
      projectId, featureName, userContext
    );
    
    if (existingMessage && existingMessage.isStreaming) {
      // Update local session
      session.currentMessage = existingMessage;
      return existingMessage.id;
    }
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const newMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [],
      timestamp: new Date().toISOString(),
      jobId,
      isStreaming: true
    };

    session.currentMessage = newMessage;
    
    // Save to Redis
    await this.sessionManager.setCurrentMessageAsync(projectId, featureName, newMessage, userContext);
    
    // Broadcast message start
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'message_start',
      message: newMessage
    }, session.userContext);

    return messageId;
  }

  /**
   * Add content to current streaming message
   * Returns the actual content index used (important for MERGE cases)
   * 
   * IMPORTANT: In multi-Pod environments, call ensureActiveMessageAsync() first
   * to ensure session is restored from Redis before calling this sync method.
   */
  addContentToCurrentMessage(
    projectId: string, 
    featureName: string, 
    content: MessageContent
  ): number {
    const session = this.sessionManager.getSession(projectId, featureName);
    if (!session) {
      // ✅ CRITICAL: This should NOT happen if ensureActiveMessageAsync() was called first
      // If this occurs in multi-Pod, it means session was not properly restored from Redis
      logger.error(`No session found for content type '${content.type}' - ensureActiveMessageAsync() may not have been called`, { 
        component: 'MessageManager', 
        projectId, 
        featureName
      });
      return -1;
    }

    if (!session.currentMessage) {
      // ✅ CRITICAL: No active message - this can happen if message was finalized
      logger.error(`No currentMessage for content type '${content.type}' - message may have been finalized`, { 
        component: 'MessageManager', 
        projectId, 
        featureName
      });
      return -1;
    }

    const result = this.contentMerger.addContent(projectId, featureName, session, content);
    
    // CRITICAL: Save currentMessage to Redis EVERY time for cross-Pod consistency
    // In multi-Pod environments, any request can hit any Pod, and the next request
    // needs to see the latest contents to properly append (not add new)
    if (session.currentMessage) {
      this.sessionManager.setCurrentMessageAsync(
        projectId, featureName, session.currentMessage, session.userContext
      ).catch(err => {
        logger.warn('Failed to sync currentMessage to Redis', { component: 'MessageManager' }, err);
      });
    }
    
    return result;
  }

  /**
   * Ensure session has an active message (for Cloud mode cross-Pod recovery)
   * Call this before addContentToCurrentMessage if message might be on different Pod
   * 
   * CRITICAL: Uses async version to restore FULL session from Redis,
   * including activeFileOperations, thinkingStartTime, etc.
   */
  async ensureActiveMessageAsync(
    projectId: string, 
    featureName: string, 
    jobId: string,
    userContext?: UserContext
  ): Promise<boolean> {
    // ✅ CRITICAL: Use async version to restore FULL session from Redis
    // This ensures activeFileOperations, thinkingStartTime, etc. are restored
    // Without this, file cards fail in multi-Pod environments
    const session = await this.sessionManager.getOrCreateSessionAsync(
      projectId, featureName, jobId, userContext
    );
    
    if (session.currentMessage) {
      return true;
    }
    
    // Try to recover currentMessage from Redis if not in session
    const redisMessage = await this.sessionManager.getCurrentMessageAsync(
      projectId, featureName, userContext
    );
    
    if (redisMessage) {
      // Restore currentMessage to session
      session.currentMessage = redisMessage;
      return true;
    }
    
    // No active message found
    return false;
  }

  /**
   * Reconstruct message from client-provided messageId
   * Used in multi-Pod environments when Redis replication lag causes recovery failure
   * Creates a minimal message structure that can receive streaming content
   */
  async reconstructMessageFromId(
    projectId: string,
    featureName: string,
    jobId: string,
    messageId: string,
    userContext?: UserContext
  ): Promise<void> {
    const session = await this.sessionManager.getOrCreateSessionAsync(
      projectId, featureName, jobId, userContext
    );
    
    // Create a minimal message structure using the provided ID
    // This ensures content is added to the SAME message that client started
    const reconstructedMessage: ChatMessage = {
      id: messageId,  // ✅ Use client's message ID
      role: 'assistant',
      contents: [],  // Will be populated by subsequent content adds
      timestamp: new Date().toISOString(),
      jobId,
      isStreaming: true
    };
    
    session.currentMessage = reconstructedMessage;
    
    // Save to Redis for subsequent requests
    await this.sessionManager.setCurrentMessageAsync(
      projectId, featureName, reconstructedMessage, userContext
    );
    
    logger.debug(`Reconstructed message ${messageId} from client ID`, {
      component: 'MessageManager',
      projectId,
      featureName
    });
  }

  /**
   * Finalize current streaming message
   * Sync version - tries local session first
   */
  finalizeCurrentMessage(projectId: string, featureName: string, cancelled: boolean = false): void {
    const session = this.sessionManager.getSession(projectId, featureName);
    
    if (!session || !session.currentMessage) {
      logger.warn(`No current message to finalize (sync): ${projectId}/${featureName}`, { 
        component: 'MessageManager' 
      });
      return;
    }

    this.doFinalizeMessage(projectId, featureName, session, cancelled);
  }

  /**
   * Finalize current streaming message (async version for Cloud mode)
   * Recovers currentMessage from Redis if not in local session
   */
  async finalizeCurrentMessageAsync(
    projectId: string, 
    featureName: string, 
    cancelled: boolean = false,
    userContext?: UserContext
  ): Promise<void> {
    let session = this.sessionManager.getSession(projectId, featureName);
    
    // Try to recover currentMessage from Redis if not in local session
    if (!session?.currentMessage) {
      const redisMessage = await this.sessionManager.getCurrentMessageAsync(
        projectId, featureName, userContext
      );
      
      if (redisMessage) {
        session = this.sessionManager.getOrCreateSession(projectId, featureName, redisMessage.jobId, userContext);
        session.currentMessage = redisMessage;
      }
    }
    
    if (!session || !session.currentMessage) {
      logger.warn(`No current message to finalize (async): ${projectId}/${featureName}`, { 
        component: 'MessageManager' 
      });
      
      // ✅ SAFETY NET: Even if no local currentMessage found, explicitly clear Redis
      // This prevents stale currentMessage from being restored on SSE reconnect
      // (e.g., when worker stored it under a different key path that we couldn't find)
      try {
        await this.sessionManager.setCurrentMessageAsync(
          projectId, featureName, null, userContext
        );
      } catch (err) {
        logger.warn('Failed to clear stale currentMessage from Redis', { component: 'MessageManager' }, err);
      }
      
      return;
    }

    this.doFinalizeMessage(projectId, featureName, session, cancelled);
  }

  /**
   * Internal: Actually finalize the message
   */
  private doFinalizeMessage(
    projectId: string, 
    featureName: string, 
    session: ChatSession, 
    cancelled: boolean
  ): void {
    if (!session.currentMessage) {
      return;
    }

    const messageId = session.currentMessage.id;

    // Finalize content (thinking blocks, in-progress work, file operations)
    this.contentMerger.finalizeContent(projectId, featureName, session, cancelled);

    session.currentMessage.isStreaming = false;
    session.messages.push(session.currentMessage);

    // Durable mirror: the server-side finalize path handles cases that the
    // worker cannot — e.g. triage-choice "guide" response where the server
    // appends a text block and then finalizes the message without the
    // worker running to completion. Emit the accumulated text to trace so
    // the response survives refresh. Worker-side LLMResponseService also
    // finalizes independently and emits its own assistant_message; the two
    // don't double-emit because only one of them owns `currentMessage` at
    // any moment (worker clears it on finalize, server path runs only when
    // worker is paused for user choice).
    if (!cancelled && session.currentMessage.jobId) {
      const text = collectAssistantText(session.currentMessage.contents);
      if (text.trim().length > 0) {
        this.persistence
          .emitAssistantMessageLine({
            projectId,
            featureName,
            userContext: session.userContext,
            jobId: session.currentMessage.jobId,
            text,
          })
          .catch((err) => {
            logger.warn(
              `Failed to emit finalize trace line: ${(err as Error)?.message ?? err}`,
              { component: 'MessageManager' },
            );
          });
      }
    }

    // Save streaming scratchpad to Redis (durable SSOT is chat.jsonl,
    // written incrementally by LLMResponseService + ChatLogAppender).
    this.sessionManager.saveSessionAsync(projectId, featureName, session, session.userContext).catch(err => {
      logger.warn('Failed to save session to Redis', { component: 'MessageManager' }, err);
    });
    
    // Clear currentMessage from Redis
    this.sessionManager.setCurrentMessageAsync(
      projectId, featureName, null, session.userContext
    ).catch(err => {
      logger.warn('Failed to clear currentMessage from Redis', { component: 'MessageManager' }, err);
    });
    
    // Broadcast message complete
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'message_complete',
      messageId
    }, session.userContext);

    session.currentMessage = undefined;
  }

  /**
   * Add job error message
   */
  addJobError(
    projectId: string,
    featureName: string,
    jobId: string,
    errorMessage: string,
    errorDetails?: any
  ): string {
    const session = this.sessionManager.getOrCreateSession(projectId, featureName, jobId);
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const textContent = `❌ **Job Failed**\n\n${errorMessage}${errorDetails ? `\n\nDetails:\n${JSON.stringify(errorDetails, null, 2)}` : ''}`;
    const errorMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [{
        type: 'text',
        content: textContent,
      }],
      timestamp: new Date().toISOString(),
      jobId
    };
    
    session.messages.push(errorMsg);

    // Save streaming scratchpad to Redis (durable mirror is emitted to
    // chat.jsonl as an assistant_message below).
    this.sessionManager.saveSessionAsync(projectId, featureName, session).catch(err => {
      logger.warn('Failed to save error message to Redis', { component: 'MessageManager' }, err);
    });
    
    // Broadcast error message
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'error_message',
      message: errorMsg
    }, session.userContext);

    // Mirror to chat.jsonl so the Activity tab picks up the error without
    // needing to read chat.json. Fire-and-forget — never block the HTTP
    // response just because the log write is slow.
    this.persistence
      .emitAssistantMessageLine({
        projectId,
        featureName,
        userContext: session.userContext,
        jobId,
        text: textContent,
      })
      .catch((err) => {
        logger.warn(
          `Failed to emit error trace line: ${(err as Error)?.message ?? err}`,
          { component: 'MessageManager' },
        );
      });

    return messageId;
  }

  /**
   * Add cancelled message (for job interruptions)
   * ✅ CRITICAL: Use async version to ensure existing messages are loaded before adding
   * This prevents overwriting existing chat history with only the cancelled message
   */
  async addCancelledMessageAsync(
    projectId: string,
    featureName: string,
    jobId: string,
    reason: string,
    message: string,
    userContext?: UserContext,
    interruptionMetadata?: Record<string, any>
  ): Promise<string> {
    // ✅ Use async version to ensure file/Redis is fully loaded
    const session = await this.sessionManager.getOrCreateSessionAsync(projectId, featureName, jobId, userContext);

    // chat SSOT §8 — server-restart-proof idempotency.
    //
    // The legacy scratchpad-based dedup (`session.messages.find`) only
    // works when the same process emitted the prior cancelled message.
    // After a server restart the in-memory + Redis scratchpad are empty,
    // so a second pause source (StaleJobRecovery, BullMQ stalled handler,
    // …) would write a duplicate `choice_presented` line.
    //
    // The Redis NX flag below survives restarts and the multi-pod fan-out;
    // it is paired with `pauseJob`'s entry-level lock to provide
    // belt-and-suspenders coverage against the "two cancelled cards in
    // a row" defect.
    const { getInfrastructureFactory } = await import('../../../../../infrastructure/adapters/InfrastructureFactory');
    const stateStore = getInfrastructureFactory().getStateStore();
    const cancelledNxKey = `ant:chat:cancelled-emitted:job:${jobId}`;
    const nxAcquired = await stateStore.acquireLock(cancelledNxKey, 24 * 60 * 60).catch(() => true);
    if (!nxAcquired) {
      logger.info(`Idempotency NX miss for job ${jobId} — cancelled card already emitted; skipping`, { component: 'MessageManager' });
      // Try to return the existing scratchpad message id so callers that
      // expect a string still get something useful.
      const stalePresent = session.messages.find(
        (m: ChatMessage) => m.jobId === jobId && m.contents?.some(
          (c: any) => c.type === 'cancelled'
        )
      );
      return stalePresent?.id ?? '';
    }

    // ✅ In-process scratchpad dedup remains as a fast-path: callers that
    //   loop in the same process never hit Redis twice in a row.
    const existing = session.messages.find(
      (m: ChatMessage) => m.jobId === jobId && m.contents?.some(
        (c: any) => c.type === 'cancelled' && !c.metadata?.resolved && !c.metadata?.choiceSelected
      )
    );
    if (existing) {
      logger.info(`Idempotency: cancelled message already exists for job ${jobId}, skipping`, { component: 'MessageManager' });
      return existing.id;
    }
    
    // ✅ Resolve ALL existing unresolved cancelled messages (from any jobId) before creating a new one.
    // This prevents orphaned choice cards from previous runs accumulating in the chat.
    const staleResolutions: Array<{ cardId: string; originalJobId: string }> = [];
    for (const msg of session.messages) {
      if (!msg.contents) continue;
      for (const content of msg.contents) {
        if (content.type === 'cancelled' && !content.metadata?.resolved && !content.metadata?.choiceSelected) {
          content.metadata = { ...content.metadata, resolved: true };
          staleResolutions.push({ cardId: msg.id, originalJobId: msg.jobId ?? jobId });
        }
      }
    }
    if (staleResolutions.length > 0) {
      logger.info(
        `Auto-resolved ${staleResolutions.length} stale cancelled message(s) before creating new one for job ${jobId}`,
        { component: 'MessageManager' },
      );
      // Mirror to chat.jsonl so the durable log stays consistent with the
      // scratchpad (otherwise a subsequent refresh would re-show the cards
      // as actionable).
      for (const { cardId, originalJobId } of staleResolutions) {
        this.persistence
          .emitChoiceResolved({
            projectId,
            featureName,
            userContext,
            jobId: originalJobId,
            cardId,
            choiceSelected: 'auto_stale',
            resolvedLabel: 'Superseded',
          })
          .catch((err) => {
            logger.warn(
              `Failed to emit stale choice_resolved: ${(err as Error)?.message ?? err}`,
              { component: 'MessageManager' },
            );
          });
      }
    }
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const cancelledMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [{
        type: 'cancelled',
        content: message,
        metadata: {
          jobId,
          reason,
          ...(interruptionMetadata?.designErrorType && { designErrorType: interruptionMetadata.designErrorType }),
        }
      }],
      timestamp: new Date().toISOString(),
      jobId
    };
    
    session.messages.push(cancelledMsg);

    // Save streaming scratchpad to Redis (durable SSOT is the trace line below)
    await this.sessionManager.saveSessionAsync(projectId, featureName, session, userContext);

    // Broadcast cancelled message (SSE)
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'cancelled_message',
      message: cancelledMsg
    }, session.userContext);

    // Durable SSOT: emit a choice_presented line so the card reappears on
    // refresh without chat.json. Payload carries the free-form data the
    // UI needs to render the Resume / Dismiss buttons.
    this.persistence
      .emitChoicePresented({
        projectId,
        featureName,
        userContext,
        jobId,
        cardId: messageId,
        cardType: 'cancelled',
        prompt: message,
        payload: {
          reason,
          jobId,
          ...(interruptionMetadata?.designErrorType && { designErrorType: interruptionMetadata.designErrorType }),
        },
      })
      .catch((err) => {
        logger.warn(
          `Failed to emit cancelled choice_presented: ${(err as Error)?.message ?? err}`,
          { component: 'MessageManager' },
        );
      });

    return messageId;
  }

  /**
   * Mark all unresolved cancelled messages for a jobId as resolved.
   * Called on resume/continue: the user chose to continue, so old choice cards are no longer actionable.
   * Returns the number of messages resolved.
   */
  async resolveCancelledMessages(
    projectId: string,
    featureName: string,
    jobId: string,
    userContext?: UserContext
  ): Promise<number> {
    const session = await this.sessionManager.getOrCreateSessionAsync(projectId, featureName, jobId, userContext);

    // Track only the newly-resolved cards so we don't re-emit
    // choice_resolved for cards that were already resolved in prior calls.
    const newlyResolvedCardIds: string[] = [];
    for (const msg of session.messages) {
      if (msg.jobId !== jobId || !msg.contents) continue;
      for (const content of msg.contents) {
        if (content.type === 'cancelled' && !content.metadata?.resolved) {
          content.metadata = { ...content.metadata, resolved: true };
          newlyResolvedCardIds.push(msg.id);
        }
      }
    }

    if (newlyResolvedCardIds.length > 0) {
      await this.sessionManager.saveSessionAsync(projectId, featureName, session, userContext);
      // Mirror the resolution to chat.jsonl so the durable log stays in
      // sync with the in-memory scratchpad. addCancelledMessageAsync emits
      // choice_presented with cardId=messageId, so the same cardId pairs
      // the presented + resolved lines.
      for (const cardId of newlyResolvedCardIds) {
        this.persistence
          .emitChoiceResolved({
            projectId,
            featureName,
            userContext,
            jobId,
            cardId,
            choiceSelected: 'resume',
            resolvedLabel: 'Resumed',
          })
          .catch((err) => {
            logger.warn(
              `Failed to emit resume choice_resolved: ${(err as Error)?.message ?? err}`,
              { component: 'MessageManager' },
            );
          });
      }
      logger.info(
        `[MessageManager] Resolved ${newlyResolvedCardIds.length} cancelled message(s) for job: ${jobId}`,
        { component: 'MessageManager' },
      );

      // chat SSOT §8 — release the per-job NX flag so a future pause of
      // this same job (after the user resumed) can emit a fresh cancelled
      // card. The flag's natural 24h TTL would otherwise block a legitimate
      // re-pause within the same session.
      try {
        const { getInfrastructureFactory } = await import('../../../../../infrastructure/adapters/InfrastructureFactory');
        const stateStore = getInfrastructureFactory().getStateStore();
        await stateStore.releaseLock(`ant:chat:cancelled-emitted:job:${jobId}`);
      } catch (err) {
        logger.warn('Failed to release cancelled-emitted NX flag', { component: 'MessageManager' }, err as Error);
      }
    }

    return newlyResolvedCardIds.length;
  }
}

/**
 * Collapse assistant-visible text content into a single chat.jsonl line.
 * Only `type: 'text'` content blocks are concatenated — thinking / tool /
 * file / command cards stay in their own trace line types so they are not
 * duplicated in the assistant_message text.
 */
function collectAssistantText(
  contents: Array<{ type: string; content: string }>,
): string {
  const parts: string[] = [];
  for (const c of contents) {
    if (!c || typeof c.content !== 'string') continue;
    if (c.type === 'text') parts.push(c.content);
  }
  return parts.join('\n').trim();
}
