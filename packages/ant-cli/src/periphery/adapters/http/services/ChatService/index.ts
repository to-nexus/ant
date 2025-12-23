/**
 * ChatService - Main service for managing chat messages and SSE broadcasting
 * 
 * Handles real-time chat message streaming to frontend
 * Persists chat history to {project}/{feature}/chat.json
 * 
 * ✅ REFACTORED: Modular architecture with separated concerns
 */

import type { LLMStreamEvent } from '../../../../../core/ports/llm';
import type { SSEService } from '../SSEService';
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
    sseService?: SSEService, 
    workspaceResolver?: WorkspaceResolver
  ) {
    // Initialize modules
    this.persistence = new SessionPersistence(workspaceResolver);
    this.broadcaster = new MessageBroadcaster(sseService);
    this.sessionManager = new SessionManager(this.persistence, this.broadcaster);
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
   * Finalize current streaming message
   */
  finalizeCurrentMessage(projectId: string, featureName: string, cancelled: boolean = false): void {
    this.messageManager.finalizeCurrentMessage(projectId, featureName, cancelled);
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

