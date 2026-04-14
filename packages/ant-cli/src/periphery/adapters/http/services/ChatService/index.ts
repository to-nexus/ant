/**
 * ChatService - Main service for managing chat messages and Redis Pub/Sub broadcasting
 * 
 * Handles real-time chat message streaming to frontend via Redis Pub/Sub
 * Persists chat history to {project}/{feature}/chat.json
 * 
 * Cloud-safe: Uses Redis Pub/Sub for cross-instance SSE broadcasting
 */

import type { LLMStreamEvent } from '../../../../../core/ports/llm';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import type { UserContext } from '../../../../../core/types/user';
import type { ChatMessage, MessageContent, FileOperationPhase, CommandExecutionPhase } from './types';

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
   * Get or create a chat session
   */
  getOrCreateSession(
    projectId: string, 
    featureName: string, 
    jobId?: string, 
    userContext?: UserContext
  ) {
    return this.sessionManager.getOrCreateSession(projectId, featureName, jobId, userContext);
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
   * Get all messages for a session
   */
  getMessages(projectId: string, featureName: string, userContext?: UserContext): ChatMessage[] {
    // Use getOrCreateSession to ensure file is loaded
    this.sessionManager.getOrCreateSession(projectId, featureName, undefined, userContext);
    return this.sessionManager.getMessages(projectId, featureName);
  }

  /**
   * Get all messages for a session (async version - ensures file is loaded)
   * Use this when you need guaranteed message loading from file/Redis
   */
  async getMessagesAsync(projectId: string, featureName: string, userContext?: UserContext): Promise<ChatMessage[]> {
    // Use async version to ensure file/Redis is fully loaded before returning
    await this.sessionManager.getOrCreateSessionAsync(projectId, featureName, undefined, userContext);
    return this.sessionManager.getMessages(projectId, featureName);
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
    const messages = this.getMessages(projectId, featureName, userContext);
    
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
   * Apply metadata update to a specific content item, save, and broadcast.
   */
  private async applyContentMetadataUpdate(
    projectId: string,
    featureName: string,
    messages: ChatMessage[],
    message: ChatMessage,
    contentIndex: number,
    content: any,
    metadataUpdate: Record<string, any>,
    userContext?: UserContext
  ): Promise<boolean> {
    // Update metadata
    content.metadata = {
      ...content.metadata,
      ...metadataUpdate
    };
    
    // Save to disk AND Redis
    this.persistence.saveSession(projectId, featureName, messages, userContext);
    const session = this.sessionManager.getSession(projectId, featureName);
    if (session) {
      await this.sessionManager.saveSessionAsync(projectId, featureName, session, userContext).catch(err => {
        logger.warn('Failed to save metadata update to Redis', { component: 'ChatService' }, err);
      });
    }
    
    // Broadcast updated content via SSE so frontend can update the card
    if (userContext) {
      this.broadcaster.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: message.id,
        contentIndex,
        content
      }, userContext);
    }
    
    return true;
  }

  /**
   * Clear messages for a session
   */
  clearMessages(projectId: string, featureName: string, userContext?: UserContext): void {
    this.sessionManager.clearMessages(projectId, featureName, userContext);
  }

  /**
   * Cleanup method - stop all watchers (call on server shutdown)
   */
  cleanup(): void {
    this.sessionManager.cleanup();
  }
}

