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
import { getChatSyncChannel } from '../constants/redis';
import { logger } from '../../utils/logger';
import { ChatLogAppender } from './ChatLogAppender';
import { setChatLogAppender, clearChatLogAppender } from './chatLogAppenderRegistry';

export class LLMResponseService {
  private enabled: boolean;
  
  // Core components
  private stateStore: StateStorePort;
  private sessionStore: SessionStore;
  private broadcaster: MessageBroadcaster;
  private contentMerger: ContentMerger;
  
  // Handlers
  private llmEventHandler: LLMEventHandler;
  private fileOperationHandler: FileOperationHandler;
  private commandExecutionHandler: CommandExecutionHandler;
  private chatStatusHandler: ChatStatusHandler;

  // Sync channel subscription (for reconnect snapshot)
  private syncUnsubscribe: (() => Promise<void>) | null = null;

  // chat.jsonl writer (session redesign §16.2 SSOT)
  private chatLogAppender: ChatLogAppender | null = null;

  constructor(stateStore: StateStorePort, env: LLMResponseEnv) {
    this.stateStore = stateStore;
    // Initialize core components
    this.sessionStore = new SessionStore(stateStore, env);
    this.broadcaster = new MessageBroadcaster(stateStore);
    this.contentMerger = new ContentMerger(this.broadcaster);

    // Register a ChatLogAppender whenever we have the minimum env to write
    // chat.jsonl (featurePath + jobId + jobType). Initial turnId is unset —
    // the orchestrator calls setTurnId() after recordUserTurn returns.
    if (env.featurePath && env.jobId && env.jobType) {
      this.chatLogAppender = new ChatLogAppender({
        featurePath: env.featurePath,
        jobId: env.jobId,
        jobType: env.jobType,
        agent: env.agent,
        projectId: env.projectId,
        featureName: env.featureName,
      });
      setChatLogAppender(this.chatLogAppender);
    }
    
    // Initialize handlers
    this.llmEventHandler = new LLMEventHandler(
      this.sessionStore,
      this.contentMerger,
      this.broadcaster
    );
    this.fileOperationHandler = new FileOperationHandler(
      this.sessionStore,
      this.broadcaster,
      this.contentMerger
    );
    this.commandExecutionHandler = new CommandExecutionHandler(
      this.sessionStore,
      this.broadcaster,
      this.contentMerger
    );
    this.chatStatusHandler = new ChatStatusHandler(
      this.sessionStore,
      this.contentMerger,
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
      this.chatStatusHandler.showChatStatus('placeholder');
      
      // Subscribe to sync channel so SSE API Pod can request a fresh snapshot on reconnect
      await this.subscribeSyncChannel();
      
      logger.debug(`Started message: ${messageId}`, { component: 'LLMResponseService' });
      return messageId;
    } catch (error) {
      logger.error(`Failed to start message`, { component: 'LLMResponseService' }, error);
      return null;
    }
  }

  /**
   * Update the active turnId for chat.jsonl appends. Called by the
   * orchestrator after `recordUserTurn` resolves — before that point
   * there is no turnId to attach to trace lines.
   */
  setTurnId(turnId: string | null): void {
    if (this.chatLogAppender) {
      this.chatLogAppender.setTurnId(turnId);
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

      // Emit assistant_message to chat.jsonl before finalization so the UI
      // has a durable record of the reply text (cancelled / non-cancelled).
      if (this.chatLogAppender && session?.currentMessage && !cancelled) {
        const text = collectAssistantText(session.currentMessage.contents);
        if (text.trim().length > 0) {
          this.chatLogAppender.appendAssistantMessage(text);
        }
      }

      if (session) {
        this.contentMerger.finalizeContent(
          ctx.projectId,
          ctx.featureName,
          session,
          cancelled
        );
        
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
      
      // Only unsubscribe when no active messages remain (main + all workers)
      if (!this.sessionStore.hasAnyActiveMessage()) {
        await this.unsubscribeSyncChannel();
      }
      
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

  /**
   * Remove a chat status UI element by its content index
   */
  removeChatStatus(contentIndex: number, expectedType?: string): void {
    if (!this.enabled) return;
    this.chatStatusHandler.removeChatStatus(contentIndex, expectedType);
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

  async completeFileCreation(
    filePath: string,
    content: string,
    stats?: { diffBeforeLines?: number },
  ): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.completeFileCreation(filePath, content, stats);
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

  async failFileCreation(filePath: string, errorMessage: string): Promise<void> {
    if (!this.enabled) return;
    if (!await this.ensureActiveMessage()) return;
    await this.fileOperationHandler.failFileCreation(filePath, errorMessage);
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

  /**
   * Drain all pending broadcast publishes before process exit.
   */
  async drainBroadcaster(): Promise<void> {
    await this.broadcaster.drain();
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Ensure there's an active message, starting one if needed
   */
  private async ensureActiveMessage(): Promise<boolean> {
    let session = this.sessionStore.getSession();
    if (!session) {
      session = await this.sessionStore.getOrCreateSession();
    }
    
    if (session?.currentMessage) return true;

    logger.warn(`No active message, attempting to start`, { component: 'LLMResponseService' });
    const messageId = await this.startMessage();
    return messageId !== null;
  }

  // ============================================================================
  // Chat Sync (reconnect snapshot)
  // ============================================================================

  private async subscribeSyncChannel(): Promise<void> {
    if (this.syncUnsubscribe) return;
    try {
      const channel = getChatSyncChannel(this.sessionStore.getContext().sessionKey);
      this.syncUnsubscribe = await this.stateStore.subscribe(channel, () => {
        this.handleSyncRequest();
      }) as () => Promise<void>;
      logger.debug(`Subscribed to sync channel: ${channel}`, { component: 'LLMResponseService' });
    } catch (error) {
      logger.warn(`Failed to subscribe to sync channel`, { component: 'LLMResponseService' }, error);
    }
  }

  private async unsubscribeSyncChannel(): Promise<void> {
    if (!this.syncUnsubscribe) return;
    try {
      await this.syncUnsubscribe();
    } catch (error) {
      logger.warn(`Failed to unsubscribe sync channel`, { component: 'LLMResponseService' }, error);
    } finally {
      this.syncUnsubscribe = null;
    }
  }

  /**
   * Respond to a sync_request from SSE API Pod by broadcasting
   * a full snapshot of all active messages (main + workers).
   */
  private handleSyncRequest(): void {
    try {
      const ctx = this.sessionStore.getContext();

      // Main graph currentMessage
      const mainMessage = this.sessionStore.getCurrentMessage();
      if (mainMessage) {
        this.broadcaster.broadcast(ctx.projectId, ctx.featureName, {
          type: 'message_snapshot',
          messageId: mainMessage.id,
          contents: mainMessage.contents,
          contentsCount: mainMessage.contents.length,
        }, ctx.userContext);
      }

      // All parallel workers' currentMessages
      for (const [, ws] of this.sessionStore.getWorkerMessages()) {
        if (ws.currentMessage) {
          this.broadcaster.broadcast(ctx.projectId, ctx.featureName, {
            type: 'message_snapshot',
            messageId: ws.currentMessage.id,
            contents: ws.currentMessage.contents,
            contentsCount: ws.currentMessage.contents.length,
          }, ctx.userContext);
        }
      }

      logger.debug(`Handled sync request: sent snapshot`, { component: 'LLMResponseService' });
    } catch (error) {
      logger.error(`Failed to handle sync request`, { component: 'LLMResponseService' }, error);
    }
  }

  /**
   * Tear down process-scoped trace writer registration. Intended for tests
   * that create multiple LLMResponseService instances in the same process.
   * Production workers exit immediately after the job finishes.
   */
  disposeChatLogAppender(): void {
    if (this.chatLogAppender) {
      clearChatLogAppender();
      this.chatLogAppender = null;
    }
  }
}

/**
 * Collapse assistant-visible text content into a single chat.jsonl
 * `assistant_message` line.
 *
 * Intentionally conservative: we collect only `type === 'text'` blocks
 * in order. Tool status, file, and command cards are persisted as
 * separate `chat_status` lines by `ChatStatusHandler` /
 * `FileOperationHandler` / `CommandExecutionHandler`; rolling them into
 * the assistant_message would double-render on replay.
 */
function collectAssistantText(
  contents: Array<{ type: string; content: string }>,
): string {
  const parts: string[] = [];
  for (const c of contents) {
    if (!c || typeof c.content !== 'string') continue;
    if (c.type === 'text') {
      parts.push(c.content);
    }
  }
  return parts.join('\n').trim();
}
