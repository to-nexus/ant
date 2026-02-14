/**
 * LLMResponseService - Main service for handling LLM responses in job workers
 * 
 * This service replaces the HTTP-based ChatAPIClient with direct Redis operations.
 * It handles:
 * - LLM stream events (text, thinking, tool_use, etc.)
 * - File operations (create, edit, delete with streaming)
 * - Command execution (start, stream, complete)
 * - Chat status messages (exploring, reading, etc.)
 * 
 * Architecture:
 * - Job Worker directly updates Redis session state
 * - Broadcasts updates via Redis Pub/Sub
 * - No HTTP roundtrip to API server needed
 */

import type { StateStorePort } from '../ports/stateStore';
import type { LLMStreamEvent } from '../ports/llm';
import type { LLMResponseEnv, ChatStatusType } from './types';

import { SessionStore } from './SessionStore';
import { LLMEventHandler } from './LLMEventHandler';
import { FileOperationHandler } from './FileOperationHandler';
import { CommandExecutionHandler } from './CommandExecutionHandler';
import { ChatStatusHandler } from './ChatStatusHandler';
import { MessageBroadcaster } from '../chat/MessageBroadcaster';
import { ContentMerger } from '../chat/ContentMerger';
import { logger } from '../../utils/logger';

export class LLMResponseService {
  private enabled: boolean;
  
  // Core components
  private sessionStore: SessionStore;
  private broadcaster: MessageBroadcaster;
  private contentMerger: ContentMerger;
  
  // Handlers
  private llmEventHandler: LLMEventHandler;
  private fileOperationHandler: FileOperationHandler;
  private commandExecutionHandler: CommandExecutionHandler;
  private chatStatusHandler: ChatStatusHandler;

  constructor(stateStore: StateStorePort, env: LLMResponseEnv) {
    // Initialize core components
    this.sessionStore = new SessionStore(stateStore, env);
    this.broadcaster = new MessageBroadcaster(stateStore);
    this.contentMerger = new ContentMerger(this.broadcaster);
    
    // Initialize handlers
    this.llmEventHandler = new LLMEventHandler(
      this.sessionStore,
      this.contentMerger,
      this.broadcaster
    );
    this.fileOperationHandler = new FileOperationHandler(
      this.sessionStore,
      this.broadcaster
    );
    this.commandExecutionHandler = new CommandExecutionHandler(
      this.sessionStore,
      this.broadcaster
    );
    this.chatStatusHandler = new ChatStatusHandler(
      this.sessionStore,
      this.contentMerger,
      this.broadcaster
    );
    
    // Enabled if all required env vars are present
    this.enabled = !!(env.projectId && env.featureName && env.jobId);
    
    if (this.enabled) {
      logger.info(`LLMResponseService initialized: ${env.projectId}/${env.featureName} (Job: ${env.jobId})`, {
        component: 'LLMResponseService'
      });
    }
  }

  // ============================================================================
  // Message Lifecycle
  // ============================================================================

  /**
   * Check if service is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if there's an active message
   */
  async hasActiveMessage(): Promise<boolean> {
    if (!this.enabled) return false;
    return this.sessionStore.hasActiveMessage();
  }

  /**
   * Start a new assistant message
   * Returns the message ID
   */
  async startMessage(): Promise<string | null> {
    if (!this.enabled) return null;

    try {
      // Ensure session is loaded
      const session = await this.sessionStore.getOrCreateSession();
      
      const messageId = await this.sessionStore.startMessage();
      const ctx = this.sessionStore.getContext();
      
      // ✅ CRITICAL: Broadcast message_start for UI to begin streaming display
      // This was missing and caused UI to not show any streaming content
      const currentMessage = this.sessionStore.getCurrentMessage();
      if (currentMessage) {
        this.broadcaster.broadcast(ctx.projectId, ctx.featureName, {
          type: 'message_start',
          message: currentMessage
        }, ctx.userContext);
      }
      
      // ✅ Auto-inject placeholder on message creation (Universal Placeholder System)
      // Every new message automatically starts with a placeholder shimmer animation.
      // ContentMerger handles placeholder → any content transition automatically:
      //   - placeholder → placeholder: in-place replacement (node transitions)
      //   - placeholder → thinking/text/file: merge (placeholder disappears)
      //   - placeholder → informational (context_loaded): add alongside (placeholder stays)
      // Individual nodes no longer need to manually call showChatStatus('placeholder')
      // as the first action — it's guaranteed from message creation.
      this.chatStatusHandler.showChatStatus('placeholder');
      
      logger.debug(`Started message: ${messageId}`, { component: 'LLMResponseService' });
      return messageId;
    } catch (error) {
      logger.error(`Failed to start message`, { component: 'LLMResponseService' }, error);
      return null;
    }
  }

  /**
   * Finalize current message
   */
  async finalizeMessage(cancelled: boolean = false): Promise<void> {
    if (!this.enabled) return;

    try {
      const session = this.sessionStore.getSession();
      const ctx = this.sessionStore.getContext();
      
      if (session) {
        // Finalize content (clean up thinking blocks, etc.)
        this.contentMerger.finalizeContent(
          ctx.projectId,
          ctx.featureName,
          session,
          cancelled
        );
        
        // Broadcast finalization
        if (session.currentMessage) {
          this.broadcaster.broadcastMessageFinalized(
            ctx.projectId,
            ctx.featureName,
            session.currentMessage.id,
            ctx.userContext
          );
        }
      }
      
      await this.sessionStore.finalizeMessage(cancelled);
      
      logger.debug(`Finalized message (cancelled=${cancelled})`, { component: 'LLMResponseService' });
    } catch (error) {
      logger.error(`Failed to finalize message`, { component: 'LLMResponseService' }, error);
    }
  }

  // ============================================================================
  // LLM Stream Events
  // ============================================================================

  /**
   * Send LLM stream event
   */
  async sendLLMEvent(event: LLMStreamEvent): Promise<void> {
    if (!this.enabled) {
      logger.warn(`LLMResponseService disabled, skipping event type '${event.type}'`, { 
        component: 'LLMResponseService' 
      });
      return;
    }

    try {
      // ✅ Ensure local session is loaded (critical for resume: new process has empty localSession)
      let session = this.sessionStore.getSession();
      if (!session) {
        // Local cache is empty - load from Redis (happens on resume when child process is new)
        session = await this.sessionStore.getOrCreateSession();
      }
      
      // Ensure message is active
      const hasActive = session?.currentMessage !== undefined;
      if (!hasActive) {
        // Auto-start message if needed
        const messageId = await this.startMessage();
        if (!messageId) {
          logger.error(`Failed to auto-start message for LLM event`, { 
            component: 'LLMResponseService' 
          });
          return;
        }
        // Refresh session after startMessage
        session = this.sessionStore.getSession();
      }
      
      if (!session) {
        logger.error(`No session in sessionStore before handleEvent`, { 
          component: 'LLMResponseService' 
        });
        return;
      }
      if (!session.currentMessage) {
        logger.error(`No currentMessage in session before handleEvent (messages: ${session.messages.length})`, { 
          component: 'LLMResponseService' 
        });
        return;
      }
      
      this.llmEventHandler.handleEvent(event);
    } catch (error) {
      logger.error(`Failed to send LLM event`, { component: 'LLMResponseService' }, error);
    }
  }

  // ============================================================================
  // Chat Status
  // ============================================================================

  /**
   * Show chat status message
   * Returns the content index
   */
  async showChatStatus(type: ChatStatusType, metadata?: Record<string, any>): Promise<number | undefined> {
    if (!this.enabled) return undefined;

    try {
      // ✅ Ensure local session is loaded (critical for resume)
      let session = this.sessionStore.getSession();
      if (!session) {
        session = await this.sessionStore.getOrCreateSession();
      }
      
      // Ensure message is active
      const hasActive = session?.currentMessage !== undefined;
      if (!hasActive) {
        const messageId = await this.startMessage();
        if (!messageId) {
          logger.error(`Failed to start message for chat status`, { 
            component: 'LLMResponseService' 
          });
          return undefined;
        }
      }
      
      const contentIndex = this.chatStatusHandler.showChatStatus(type, metadata);
      return contentIndex !== -1 ? contentIndex : undefined;
    } catch (error) {
      logger.error(`Failed to show chat status`, { component: 'LLMResponseService' }, error);
      return undefined;
    }
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  async startFileCreation(filePath: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.startFileCreation(filePath);
  }

  async streamFileContent(filePath: string, content: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.streamFileContent(filePath, content);
  }

  async completeFileCreation(filePath: string, content: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.completeFileCreation(filePath, content);
  }

  async startFileEdit(filePath: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.startFileEdit(filePath);
  }

  async streamFileDiff(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.streamFileDiff(filePath, diffBefore, diffAfter);
  }

  async completeFileEdit(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.completeFileEdit(filePath, diffBefore, diffAfter);
  }

  async startFileDeletion(filePath: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.startFileDeletion(filePath);
  }

  async completeFileDeletion(filePath: string, content?: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.completeFileDeletion(filePath, content);
  }

  async failFileEdit(filePath: string, errorMessage: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.failFileEdit(filePath, errorMessage);
  }

  // ============================================================================
  // Command Execution
  // ============================================================================

  async startCommand(command: string): Promise<number | undefined> {
    if (!this.enabled) return undefined;
    if (!await this.ensureActiveMessage()) return undefined;
    const index = await this.commandExecutionHandler.startCommand(command);
    return index !== -1 ? index : undefined;
  }

  async streamCommandOutput(command: string, output: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.commandExecutionHandler.streamCommandOutput(command, output);
  }

  async completeCommand(command: string, output: string, exitCode: number): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.commandExecutionHandler.completeCommand(command, output, exitCode);
  }

  // ============================================================================
  // Legacy API Compatibility
  // ============================================================================

  /**
   * Add file operation notification with content
   */
  async addFileOperation(
    operation: 'edit' | 'create' | 'delete', 
    filePath: string,
    content?: string,
    diffBefore?: string,
    diffAfter?: string
  ): Promise<void> {
    if (!this.enabled) return;

    switch (operation) {
      case 'create':
        await this.completeFileCreation(filePath, content || '');
        break;
      case 'edit':
        await this.completeFileEdit(filePath, diffBefore || '', diffAfter || '');
        break;
      case 'delete':
        await this.completeFileDeletion(filePath, content);
        break;
    }
  }

  /**
   * Legacy: Add command execution notification
   */
  async addCommandExecution(command: string, output?: string, exitCode?: number): Promise<void> {
    if (!this.enabled) return;
    await this.completeCommand(command, output || '', exitCode ?? 0);
  }

  /**
   * Legacy: Add exploring status
   */
  async addExploringStatus(current: number, total: number): Promise<void> {
    await this.showChatStatus('exploring', { filesCount: current, totalFiles: total });
  }

  /**
   * Legacy: Add explored result
   */
  async addExploredResult(filesCount: number, filesList?: string[]): Promise<void> {
    await this.showChatStatus('explored', { filesCount, filesList });
  }

  /**
   * Legacy: Add reading file status
   */
  async addReadingFile(filePath: string): Promise<number | undefined> {
    return this.showChatStatus('reading', { filePath });
  }

  /**
   * Legacy: Add read complete
   */
  async addReadComplete(filePath: string, readingIndex?: number, error?: string): Promise<void> {
    await this.showChatStatus('read', { filePath, error, _mergeIndex: readingIndex });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Ensure there's an active message, starting one if needed
   */
  private async ensureActiveMessage(): Promise<boolean> {
    // ✅ Ensure local session is loaded first (critical for resume)
    let session = this.sessionStore.getSession();
    if (!session) {
      session = await this.sessionStore.getOrCreateSession();
    }
    
    // Check local state (more reliable than Redis for stale message detection)
    if (session?.currentMessage) return true;

    logger.warn(`No active message, attempting to start`, { component: 'LLMResponseService' });
    const messageId = await this.startMessage();
    return messageId !== null;
  }
}
