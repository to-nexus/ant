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
import type { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
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
    userContext?: UserContext
  ): Promise<string> {
    return this.messageManager.addUserMessage(projectId, featureName, content, jobId, userContext);
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
    userContext?: UserContext
  ): Promise<string> {
    return this.messageManager.addCancelledMessageAsync(
      projectId,
      featureName,
      jobId,
      reason,
      message,
      userContext
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
   * Update metadata of the last content of a specific type in the last message
   * Used to mark triage_choice as resolved after user selection
   */
  async updateLastContentMetadata(
    projectId: string,
    featureName: string,
    contentType: string,
    metadataUpdate: Record<string, any>,
    userContext?: UserContext
  ): Promise<boolean> {
    const messages = this.getMessages(projectId, featureName, userContext);
    
    // Find the last message with content of the specified type
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message.contents) continue;
      
      for (let j = message.contents.length - 1; j >= 0; j--) {
        const content = message.contents[j];
        if (content.type === contentType) {
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
              contentIndex: j,
              content
            }, userContext);
          }
          
          return true;
        }
      }
    }
    
    return false;
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

