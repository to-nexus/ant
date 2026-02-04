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

// Re-export types for backward compatibility
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
   */
  addUserMessage(
    projectId: string, 
    featureName: string, 
    content: string, 
    jobId?: string, 
    userContext?: UserContext
  ): string {
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
   */
  addFileOperation(
    projectId: string,
    featureName: string,
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    content?: string,
    diffBefore?: string,
    diffAfter?: string,
    phase?: FileOperationPhase,
    error?: string
  ): void {
    this.fileOperationHandler.addFileOperation(
      projectId,
      featureName,
      operation,
      filePath,
      content,
      diffBefore,
      diffAfter,
      phase,
      error
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
   * Add cancelled message
   */
  addCancelledMessage(
    projectId: string,
    featureName: string,
    jobId: string,
    reason: string,
    message: string,
    userContext?: UserContext
  ): string {
    return this.messageManager.addCancelledMessage(
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
   * Update metadata of the last content of a specific type in the last message
   * Used to mark triage_choice as resolved after user selection
   */
  updateLastContentMetadata(
    projectId: string,
    featureName: string,
    contentType: string,
    metadataUpdate: Record<string, any>,
    userContext?: UserContext
  ): boolean {
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
          
          // Save to disk
          this.persistence.saveSession(projectId, featureName, messages, userContext);
          
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

