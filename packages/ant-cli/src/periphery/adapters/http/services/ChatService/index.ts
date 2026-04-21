/**
 * ChatService — Chat API façade backed by trace.jsonl SSOT.
 *
 * Session redesign §16.2 cutover: chat.json is retired. The durable chat
 * history lives in trace.jsonl + feature.jsonl and is rebuilt via
 * {@link buildChatMessagesFromTrace} when the UI asks for history.
 *
 * This service keeps a transient in-memory + Redis "streaming scratchpad"
 * so that live SSE delta broadcasts (content_add / content_update /
 * message_start / message_finalized) still flow. The scratchpad is
 * cleared on message finalize — only trace.jsonl survives process exit.
 *
 * Cloud-safe: Redis Pub/Sub drives cross-instance SSE broadcasting.
 */

import type { LLMStreamEvent } from '../../../../../core/ports/llm';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import type { UserContext } from '../../../../../core/types/user';
import type { ChatMessage, MessageContent, FileOperationPhase, CommandExecutionPhase } from './types';
import type { TraceLine } from '@ant/shared';
import { FileSessionAdapter } from '../../../session/FileSessionAdapter';
import { buildChatMessagesFromTrace } from './TraceToChatMessages';

// Module imports
import { SessionPersistence } from './SessionPersistence';
import { SessionManager } from './SessionManager';
import { MessageBroadcaster } from './MessageBroadcaster';
import { ContentMerger } from './ContentMerger';
import { MessageManager } from './MessageManager';
import { FileOperationHandler } from './FileOperationHandler';
import { LLMEventHandler } from './LLMEventHandler';
import { CommandExecutionHandler } from './CommandExecutionHandler';
import { logger } from '../../../../../utils/logger';

// Re-export types
export type { MessageContent, ChatMessage } from './types';

/**
 * ChatService - Orchestrates all chat-related operations
 */
export class ChatService {
  private persistence: SessionPersistence;
  private broadcaster: MessageBroadcaster;
  private sessionManager: SessionManager;
  private contentMerger: ContentMerger;
  private messageManager: MessageManager;
  private fileOperationHandler: FileOperationHandler;
  private llmEventHandler: LLMEventHandler;
  private commandExecutionHandler: CommandExecutionHandler;
  private defaultUserContext?: UserContext;

  constructor(
    workspaceRoot: string, 
    stateStore?: StateStorePort, 
    workspaceResolver?: WorkspaceResolver
  ) {
    // Initialize modules
    this.persistence = new SessionPersistence(workspaceResolver);
    this.broadcaster = new MessageBroadcaster(stateStore);
    // Pass stateStore to SessionManager for Redis-based session management
    this.sessionManager = new SessionManager(this.persistence, this.broadcaster, stateStore);
    this.contentMerger = new ContentMerger(this.broadcaster);
    this.messageManager = new MessageManager(
      this.sessionManager,
      this.persistence,
      this.broadcaster,
      this.contentMerger
    );
    this.fileOperationHandler = new FileOperationHandler(this.sessionManager, this.broadcaster);
    this.llmEventHandler = new LLMEventHandler(
      this.sessionManager,
      this.messageManager,
      this.broadcaster
    );
    this.commandExecutionHandler = new CommandExecutionHandler(this.messageManager);
  }

  /**
   * Set user context for subsequent operations (from Express middleware)
   */
  setUserContext(userContext: UserContext): void {
    this.defaultUserContext = userContext;
  }

  /**
   * Check if there's an active (streaming) message
   */
  hasActiveMessage(projectId: string, featureName: string): boolean {
    return this.sessionManager.hasActiveMessage(projectId, featureName);
  }

  /**
   * Check if there's an active (streaming) message (async version for Cloud mode)
   */
  async hasActiveMessageAsync(projectId: string, featureName: string, userContext?: UserContext): Promise<boolean> {
    return this.sessionManager.hasActiveMessageAsync(projectId, featureName, userContext);
  }

  /**
   * Add user message to chat history
   * CLOUD MODE: Async to ensure Redis save completes before Job starts
   */
  async addUserMessage(
    projectId: string, 
    featureName: string, 
    content: string, 
    jobId?: string, 
    userContext?: UserContext,
    actionMetadata?: import('@ant/shared').ActionMetadata,
  ): Promise<string> {
    return this.messageManager.addUserMessage(projectId, featureName, content, jobId, userContext, actionMetadata);
  }

  /**
   * Start a new assistant message (for streaming)
   */
  startAssistantMessage(
    projectId: string, 
    featureName: string, 
    jobId: string, 
    userContext?: UserContext
  ): string {
    return this.messageManager.startAssistantMessage(projectId, featureName, jobId, userContext);
  }

  /**
   * Start a new assistant message (async version for Cloud mode)
   * Uses Redis for cross-Pod consistency
   */
  async startAssistantMessageAsync(
    projectId: string, 
    featureName: string, 
    jobId: string, 
    userContext?: UserContext
  ): Promise<string> {
    return this.messageManager.startAssistantMessageAsync(projectId, featureName, jobId, userContext);
  }

  /**
   * Ensure there's an active message (for Cloud mode cross-Pod recovery)
   */
  async ensureActiveMessageAsync(
    projectId: string, 
    featureName: string, 
    jobId: string,
    userContext?: UserContext
  ): Promise<boolean> {
    return this.messageManager.ensureActiveMessageAsync(projectId, featureName, jobId, userContext);
  }

  /**
   * Reconstruct message from client-provided messageId
   * Used in multi-Pod environments when Redis replication lag causes recovery failure
   */
  async reconstructMessageFromId(
    projectId: string,
    featureName: string,
    jobId: string,
    messageId: string,
    userContext?: UserContext
  ): Promise<void> {
    return this.messageManager.reconstructMessageFromId(projectId, featureName, jobId, messageId, userContext);
  }

  /**
   * Add content to current streaming message
   */
  addContentToCurrentMessage(
    projectId: string, 
    featureName: string, 
    content: MessageContent
  ): number {
    return this.messageManager.addContentToCurrentMessage(projectId, featureName, content);
  }

  /**
   * Finalize current streaming message (async for Cloud mode)
   */
  async finalizeCurrentMessage(
    projectId: string, 
    featureName: string, 
    cancelled: boolean = false,
    userContext?: UserContext
  ): Promise<void> {
    await this.messageManager.finalizeCurrentMessageAsync(projectId, featureName, cancelled, userContext);
  }

  /**
   * Process LLM stream event and convert to chat content
   */
  handleLLMStreamEvent(
    projectId: string,
    featureName: string,
    event: LLMStreamEvent
  ): void {
    this.llmEventHandler.handleLLMStreamEvent(projectId, featureName, event);
  }

  /**
   * Add file operation notification
   * Uses Redis for cross-Pod consistency of activeFileOperations
   */
  async addFileOperation(
    projectId: string,
    featureName: string,
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    content?: string,
    diffBefore?: string,
    diffAfter?: string,
    phase?: FileOperationPhase,
    error?: string,
    jobId?: string,
    userContext?: UserContext
  ): Promise<void> {
    await this.fileOperationHandler.addFileOperation(
      projectId,
      featureName,
      operation,
      filePath,
      content,
      diffBefore,
      diffAfter,
      phase,
      error,
      jobId,
      userContext
    );
  }

  /**
   * Add command execution notification
   */
  addCommandExecution(
    projectId: string,
    featureName: string,
    command: string,
    output?: string,
    exitCode?: number,
    phase?: CommandExecutionPhase,
    _mergeIndex?: number
  ): number {
    return this.commandExecutionHandler.addCommandExecution(
      projectId,
      featureName,
      command,
      output,
      exitCode,
      phase,
      _mergeIndex
    );
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
    return this.messageManager.addJobError(projectId, featureName, jobId, errorMessage, errorDetails);
  }

  /**
   * Mark all unresolved cancelled messages for a jobId as resolved.
   * Called on resume/continue: the user chose to continue, so old choice cards are no longer actionable.
   */
  async resolveCancelledMessages(
    projectId: string,
    featureName: string,
    jobId: string,
    userContext?: UserContext
  ): Promise<number> {
    return this.messageManager.resolveCancelledMessages(projectId, featureName, jobId, userContext);
  }

  /**
   * Add cancelled message (async version - recommended)
   * ✅ Use this to prevent race conditions when session is not in cache
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
    return this.messageManager.addCancelledMessageAsync(
      projectId,
      featureName,
      jobId,
      reason,
      message,
      userContext,
      interruptionMetadata
    );
  }

  /**
   * Get all messages for a feature (async, durable + live).
   *
   * Result is the concatenation of:
   *   1. Trace-derived history from trace.jsonl + feature.jsonl (SSOT)
   *   2. The current in-memory streaming message (if any), which has not
   *      yet been flushed to trace.jsonl because its turn is still live.
   *
   * The trace-derived history already surfaces completed turns as user +
   * assistant ChatMessages (including choice_presented / choice_resolved
   * pairs). The streaming overlay is only the last partial reply.
   */
  async getMessagesAsync(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): Promise<ChatMessage[]> {
    // 1. Rebuild completed turns from trace.jsonl
    const durable = await this.loadTraceDerivedMessages(projectId, featureName, userContext);

    // 2. Overlay the streaming scratchpad's currentMessage (if any)
    const session = await this.sessionManager.getOrCreateSessionAsync(
      projectId,
      featureName,
      undefined,
      userContext,
    );

    // 2a. User messages that the UI optimistically POSTed via
    //     /chat/user-message land in session.messages BEFORE the worker
    //     starts and recordUserTurn writes the durable user_turn to
    //     trace.jsonl. Include any such pending user messages so a refresh
    //     on another pod (or the same pod, during the spawn window) still
    //     shows them. Dedup by jobId against the trace-derived set.
    const durableUserJobIds = new Set(
      durable.filter((m) => m.role === 'user' && m.jobId).map((m) => m.jobId as string),
    );
    const pendingUserMsgs = session.messages.filter(
      (m) => m.role === 'user' && m.jobId && !durableUserJobIds.has(m.jobId),
    );

    // 2b. The active streaming message is a partial view of the same turn
    //     that trace.jsonl is accumulating events for (thinking /
    //     tool_call / file_write / run_command lines are emitted as they
    //     happen, before finalize writes the terminal assistant_message).
    //     To avoid a double-render, drop the trace-derived assistant
    //     message for that same jobId and replace it with the live
    //     currentMessage (if any).
    const streamingJobId = session.currentMessage?.jobId;
    const filtered = streamingJobId
      ? durable.filter((m) => !(m.role === 'assistant' && m.jobId === streamingJobId))
      : durable;

    const streaming: ChatMessage[] = [];
    if (session.currentMessage) {
      streaming.push({ ...session.currentMessage, isStreaming: undefined });
    }

    return [...filtered, ...pendingUserMsgs, ...streaming];
  }

  /**
   * Load `ChatMessage[]` derived from the durable session log (trace.jsonl).
   * Returns `[]` when the feature path cannot be resolved or the log is empty.
   *
   * Only trace.jsonl is consulted here — breadcrumbs and user_turn_meta are
   * consumed directly by the Timeline / tier-badge surfaces (feature-log
   * slice in the UI), not by Chat rendering.
   */
  private async loadTraceDerivedMessages(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): Promise<ChatMessage[]> {
    const featurePath = this.persistence.getFeaturePath(projectId, featureName, userContext);
    if (!featurePath) return [];

    const adapter = new FileSessionAdapter(featurePath, 'architect', projectId, featureName);
    let traceLines: TraceLine[] = [];
    try {
      traceLines = await adapter.loadAllTrace();
    } catch (err) {
      logger.warn(
        `[ChatService] loadAllTrace failed for ${projectId}/${featureName}`,
        { component: 'ChatService' },
        err,
      );
    }

    return buildChatMessagesFromTrace({ traceLines });
  }

  /**
   * Update metadata of the last content of a specific type in the last message.
   * 
   * ✅ Multi-pod safe: optional `metadataFilter` ensures the correct content is updated
   * when multiple contents share the same type (e.g., choice_card with different cardType).
   * 
   * @param metadataFilter - Optional filter to match on content.metadata fields.
   *   Example: { cardType: 'eval_save' } only matches choice_card with that cardType.
   *   Example: { jobId: 'xxx' } only matches cancelled with that specific jobId.
   */
  async updateLastContentMetadata(
    projectId: string,
    featureName: string,
    contentType: string,
    metadataUpdate: Record<string, any>,
    userContext?: UserContext,
    metadataFilter?: Record<string, any>
  ): Promise<boolean> {
    // Cross-pod safety: the choice card may have been emitted by a
    // different pod, so we must rehydrate the session from Redis before
    // searching. getOrCreateSessionAsync consults Redis first and falls
    // back to local cache; the following getMessages then returns the
    // authoritative scratchpad state.
    await this.sessionManager.getOrCreateSessionAsync(
      projectId,
      featureName,
      undefined,
      userContext,
    );
    const messages = this.sessionManager.getMessages(projectId, featureName);
    
    // ✅ Strategy: Find the last ACTIONABLE content (not yet resolved via choiceSelected).
    // If multiple cancelled/choice cards exist (e.g., due to duplicates or sequential runs),
    // we must update the one the user is actually interacting with — the last unresolved one.
    // Fallback: if all are already resolved, update the last match (backward compat).
    let fallbackMsg: { message: any; contentIdx: number } | null = null;
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message.contents) continue;
      
      for (let j = message.contents.length - 1; j >= 0; j--) {
        const content = message.contents[j];
        if (content.type !== contentType) continue;
        
        // ✅ Multi-pod safety: check metadata filter if provided
        if (metadataFilter) {
          const meta = content.metadata as Record<string, any> | undefined;
          const matches = Object.entries(metadataFilter).every(
            ([key, value]) => meta?.[key] === value
          );
          if (!matches) continue;
        }
        
        // Record first (most recent) match as fallback
        if (!fallbackMsg) {
          fallbackMsg = { message, contentIdx: j };
        }
        
        // Skip already-resolved content — look for the last unresolved one
        const meta = content.metadata as Record<string, any> | undefined;
        if (meta?.choiceSelected || meta?.resolved) {
          continue;
        }
        
        // Found an unresolved match — update it
        return this.applyContentMetadataUpdate(
          projectId, featureName, messages, message, j, content, metadataUpdate, userContext
        );
      }
    }
    
    // All matches are already resolved — update the fallback (last match) for backward compat
    if (fallbackMsg) {
      const content = fallbackMsg.message.contents[fallbackMsg.contentIdx];
      return this.applyContentMetadataUpdate(
        projectId, featureName, messages, fallbackMsg.message, fallbackMsg.contentIdx, content, metadataUpdate, userContext
      );
    }
    
    return false;
  }

  /**
   * Apply metadata update to a specific content item, save to Redis and
   * mirror the choice resolution to trace.jsonl.
   */
  private async applyContentMetadataUpdate(
    projectId: string,
    featureName: string,
    _messages: ChatMessage[],
    message: ChatMessage,
    contentIndex: number,
    content: any,
    metadataUpdate: Record<string, any>,
    userContext?: UserContext
  ): Promise<boolean> {
    // Update in-memory metadata
    content.metadata = {
      ...content.metadata,
      ...metadataUpdate,
    };

    // Save streaming scratchpad to Redis (durable SSOT is the trace line below)
    const session = this.sessionManager.getSession(projectId, featureName);
    if (session) {
      await this.sessionManager
        .saveSessionAsync(projectId, featureName, session, userContext)
        .catch((err) => {
          logger.warn('Failed to save metadata update to Redis', { component: 'ChatService' }, err);
        });
    }

    // Broadcast updated content via SSE so frontend can update the card
    if (userContext) {
      this.broadcaster.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: message.id,
        contentIndex,
        content,
      }, userContext);
    }

    // Durable mirror: every metadata update that records a user choice
    // also emits a choice_resolved line. Only emit when the caller supplied
    // choiceSelected / resolvedLabel (i.e. this is a real resolution, not
    // a generic metadata bump).
    //
    // cardId resolution order:
    //   1. content.metadata.cardId  — set by ChatStatusHandler when it
    //      emitted the matching choice_presented line (triage_choice /
    //      eval_save / clarifying cards).
    //   2. message.id               — fallback for cards whose
    //      choice_presented line was emitted with the message id as the
    //      card id (cancelled cards, see MessageManager.addCancelledMessageAsync).
    const jobId = message.jobId ?? content.metadata?.jobId;
    const choiceSelected = metadataUpdate.choiceSelected;
    const resolvedLabel = metadataUpdate.resolvedLabel;
    if (jobId && choiceSelected && resolvedLabel) {
      const { choiceSelected: _unused1, resolvedLabel: _unused2, ...answer } = metadataUpdate;
      const cardId = (content.metadata?.cardId as string | undefined) ?? message.id;
      await this.persistence
        .emitChoiceResolved({
          projectId,
          featureName,
          userContext,
          jobId,
          cardId,
          choiceSelected: String(choiceSelected),
          resolvedLabel: String(resolvedLabel),
          answer: Object.keys(answer).length > 0 ? answer : undefined,
        })
        .catch((err) => {
          logger.warn(
            `Failed to emit choice_resolved trace line: ${(err as Error)?.message ?? err}`,
            { component: 'ChatService' },
          );
        });
    }

    return true;
  }

  /**
   * Clear messages for a session (fire-and-forget). Always uses Chat Clear
   * semantics (trace.jsonl only).
   *
   * Prefer {@link clearMessagesAsync} when the caller needs to observe
   * collapse completion or wants Hard Reset semantics (`scope='full'`).
   */
  clearMessages(projectId: string, featureName: string, userContext?: UserContext): void {
    this.sessionManager.clearMessages(projectId, featureName, userContext);
  }

  /**
   * Clear messages for a session (awaitable).
   *
   * Runs the same base pipeline as {@link clearMessages} — Redis session
   * delete, local cache reset, draft image cleanup, and the
   * `messages_cleared` SSE broadcast — but the jsonl collapse step varies
   * by `scope`:
   *
   * - `scope='chat'` (default, Chat Clear): only trace.jsonl is collapsed.
   *   feature.jsonl (LLM context SSOT) is preserved.
   * - `scope='full'` (§17 Hard Reset): both trace.jsonl and feature.jsonl
   *   are collapsed and a `user_reset` boundary is appended.
   *
   * This is the SSOT entry point for Reset semantics (§16.2 "Clear·Reset
   * 양방향 sync"); any new reset surface should route through here instead
   * of touching FileSessionAdapter directly, to avoid diverging cleanup.
   */
  async clearMessagesAsync(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
    scope: 'chat' | 'full' = 'chat',
  ): Promise<void> {
    await this.sessionManager.clearMessagesAsync(projectId, featureName, userContext, scope);
  }

  /**
   * Cleanup method - stop all watchers (call on server shutdown)
   */
  cleanup(): void {
    this.sessionManager.cleanup();
  }
}

