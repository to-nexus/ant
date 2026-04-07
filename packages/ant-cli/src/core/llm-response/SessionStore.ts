/**
 * SessionStore - Direct Redis session management for job workers
 * 
 * Handles chat session state directly via Redis without HTTP overhead.
 * Used by LLMResponseService for streaming LLM responses.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StateStorePort, ChatSessionData, ChatMessageData } from '../ports/stateStore';
import type { SessionContext, LLMResponseEnv } from './types';
import type { ChatSession, ChatMessage, FileOperationTracker, MessageContent } from '../chat/types';
import { getSessionKey, toRedisSession, fromRedisSession, toRedisMessage, fromRedisMessage, createAssistantMessage } from '../chat/schema';
import { logger } from '../../utils/logger';
import { getWorkerScope } from '../parallel/workerScope';

/**
 * Per-worker isolated message state.
 * Each parallel TaskWorker gets its own currentMessage and file-operation tracking,
 * preventing cross-worker interference on the shared SessionStore singleton.
 */
export interface WorkerMessageState {
  currentMessage: ChatMessage | undefined;
  activeFileOperations: Map<string, FileOperationTracker>;
  thinkingStartTime?: number;
  lastThinkingContentIndex?: number;
  sessionProxy?: ChatSession;
}

import { isBaseBranch, getBranchBase } from '../utils/branchUtils';

// Detect if this process is a resume (set by JobWorker)
const IS_RESUME = process.env.ANT_IS_RESUME === 'true';

export class SessionStore {
  private stateStore: StateStorePort;
  private context: SessionContext;
  private localSession: ChatSession | null = null;  // Local cache for hot path
  private featurePath: string | undefined;
  private workerMessages = new Map<number, WorkerMessageState>();

  constructor(stateStore: StateStorePort, env: LLMResponseEnv) {
    this.stateStore = stateStore;
    this.featurePath = env.featurePath;
    
    const userContext = env.userId && env.organizationId ? {
      userId: env.userId,
      organizationId: env.organizationId,
    } : undefined;
    
    this.context = {
      projectId: env.projectId,
      featureName: env.featureName,
      jobId: env.jobId,
      userContext,
      sessionKey: getSessionKey(env.projectId, env.featureName, userContext)
    };
    
    logger.debug(`SessionStore initialized: ${env.projectId}/${env.featureName} (Job: ${env.jobId})`, {
      component: 'SessionStore'
    });
  }

  /**
   * Get session context
   */
  getContext(): SessionContext {
    return this.context;
  }

  /**
   * Get or create session from Redis
   */
  async getOrCreateSession(): Promise<ChatSession> {
    // Return local cache if available (via getSession() for worker-scope Proxy)
    if (this.localSession) {
      return this.getSession()!;
    }

    try {
      // Try to load from Redis
      const redisSession = await this.stateStore.getChatSession(this.context.sessionKey);
      
      if (redisSession) {
        this.localSession = fromRedisSession(redisSession);
        
        // Also restore currentMessage if exists
        const currentMessage = await this.stateStore.getCurrentMessage(this.context.sessionKey);
        if (currentMessage) {
          const restoredMessage = fromRedisMessage(currentMessage);
          
          // Determine if this message is stale and should be archived:
          // 1. Different jobId → definitely stale (crash without finalize)
          // 2. Same jobId BUT this is a resume → stale from previous execution
          //    Resume reuses the same jobId, so jobId check alone is insufficient
          const isDifferentJob = restoredMessage.jobId && restoredMessage.jobId !== this.context.jobId;
          const isSameJobResume = !isDifferentJob && IS_RESUME;
          const isStale = isDifferentJob || isSameJobResume;
          
          if (isStale) {
            const reason = isDifferentJob ? 'different job' : 'resume (same jobId, new process)';
            logger.warn(
              `Found stale currentMessage (${reason}), archiving (message job: ${restoredMessage.jobId}, current: ${this.context.jobId})`,
              { component: 'SessionStore' }
            );
            
            // Archive: Save the incomplete message to messages array (preserve data)
            if (restoredMessage.contents && restoredMessage.contents.length > 0) {
              delete restoredMessage.isStreaming;
              this.localSession.messages.push(restoredMessage);
              logger.info(
                `Recovered stale message with ${restoredMessage.contents.length} contents`,
                { component: 'SessionStore' }
              );
            }
            
            // Clear stale currentMessage from Redis
            await this.stateStore.setCurrentMessage(this.context.sessionKey, null);
            // Don't set it as currentMessage for this job - startMessage() will create a new one
          } else {
            // Same job, not a resume - restore normally (e.g., process reconnect)
            this.localSession.currentMessage = restoredMessage;
          }
        }
        
        // Update jobId if different
        if (this.localSession.jobId !== this.context.jobId) {
          this.localSession.jobId = this.context.jobId;
          await this.saveSession();
        }
        
        logger.debug(`Loaded session from Redis: ${this.localSession.messages.length} messages`, {
          component: 'SessionStore'
        });
        
        return this.getSession()!;
      }
    } catch (error) {
      logger.warn(`Failed to load session from Redis`, { component: 'SessionStore' }, error);
    }

    // Create new session
    this.localSession = {
      projectId: this.context.projectId,
      featureName: this.context.featureName,
      jobId: this.context.jobId,
      messages: [],
      userContext: this.context.userContext
    };
    
    await this.saveSession();
    return this.getSession()!;
  }

  /**
   * Get current session (local cache only, no Redis fetch).
   * In worker context, returns a Proxy that redirects per-worker fields
   * (currentMessage, activeFileOperations, thinkingStartTime, lastThinkingContentIndex)
   * to the worker's isolated state. All other fields fall through to the real session.
   */
  getSession(): ChatSession | null {
    if (!this.localSession) return null;

    const scope = getWorkerScope();
    if (!scope) return this.localSession;

    const ws = this.getOrCreateWorkerState(scope.workerId);

    if (!ws.sessionProxy) {
      const target = this.localSession;
      ws.sessionProxy = new Proxy(target, {
        get(_target, prop, receiver) {
          switch (prop) {
            case 'currentMessage': return ws.currentMessage;
            case 'activeFileOperations': return ws.activeFileOperations;
            case 'thinkingStartTime': return ws.thinkingStartTime;
            case 'lastThinkingContentIndex': return ws.lastThinkingContentIndex;
            default: return Reflect.get(_target, prop, receiver);
          }
        },
        set(_target, prop, value, receiver) {
          switch (prop) {
            case 'currentMessage': ws.currentMessage = value; return true;
            case 'activeFileOperations': ws.activeFileOperations = value; return true;
            case 'thinkingStartTime': ws.thinkingStartTime = value; return true;
            case 'lastThinkingContentIndex': ws.lastThinkingContentIndex = value; return true;
            default: return Reflect.set(_target, prop, value, receiver);
          }
        }
      });
    }

    return ws.sessionProxy;
  }

  /**
   * Expose all worker message states (for sync snapshot responses).
   * Called outside AsyncLocalStorage context to collect all active worker messages.
   */
  getWorkerMessages(): ReadonlyMap<number, WorkerMessageState> {
    return this.workerMessages;
  }

  /**
   * Check if any message is active (main graph OR any worker), regardless of AsyncLocalStorage scope.
   */
  hasAnyActiveMessage(): boolean {
    if (this.localSession?.currentMessage) return true;
    for (const [, ws] of this.workerMessages) {
      if (ws.currentMessage) return true;
    }
    return false;
  }

  private getOrCreateWorkerState(workerId: number): WorkerMessageState {
    let ws = this.workerMessages.get(workerId);
    if (!ws) {
      ws = {
        currentMessage: undefined,
        activeFileOperations: new Map(),
      };
      this.workerMessages.set(workerId, ws);
    }
    return ws;
  }

  /**
   * Save session to Redis
   */
  async saveSession(): Promise<void> {
    if (!this.localSession) return;

    try {
      await this.stateStore.setChatSession(
        this.context.sessionKey, 
        toRedisSession(this.localSession)
      );
    } catch (error) {
      logger.warn(`Failed to save session to Redis`, { component: 'SessionStore' }, error);
    }
  }

  /**
   * Check if there's an active message (streaming)
   * Prioritizes local session state over Redis to avoid stale-message false positives
   * (e.g., resume process where Redis still has previous execution's currentMessage)
   */
  async hasActiveMessage(): Promise<boolean> {
    const scope = getWorkerScope();
    if (scope) {
      return this.workerMessages.get(scope.workerId)?.currentMessage !== undefined;
    }

    // Local cache is authoritative when loaded
    if (this.localSession) {
      return this.localSession.currentMessage !== undefined;
    }
    
    // Local session not loaded yet - check Redis as fallback
    try {
      return await this.stateStore.hasActiveMessage(this.context.sessionKey);
    } catch (error) {
      logger.warn(`Failed to check active message`, { component: 'SessionStore' }, error);
      return false;
    }
  }

  /**
   * Start a new assistant message
   * Returns the message ID
   */
  async startMessage(): Promise<string> {
    await this.getOrCreateSession();

    const scope = getWorkerScope();
    if (scope) {
      const message = createAssistantMessage(this.context.jobId);
      const ws = this.getOrCreateWorkerState(scope.workerId);
      ws.currentMessage = message;
      ws.activeFileOperations.clear();
      ws.thinkingStartTime = undefined;
      ws.lastThinkingContentIndex = undefined;

      logger.info(`SessionStore.startMessage (worker ${scope.workerId}): Created message ${message.id}`, {
        component: 'SessionStore'
      });
      return message.id;
    }

    // Main graph path
    const message = createAssistantMessage(this.context.jobId);
    this.localSession!.currentMessage = message;
    
    logger.info(`SessionStore.startMessage: Created message ${message.id}, localSession.currentMessage set: ${!!this.localSession?.currentMessage}`, {
      component: 'SessionStore'
    });
    
    // Save to Redis
    try {
      await this.stateStore.setCurrentMessage(
        this.context.sessionKey, 
        toRedisMessage(message)
      );
      await this.saveSession();
    } catch (error) {
      logger.warn(`Failed to save new message to Redis`, { component: 'SessionStore' }, error);
    }
    
    logger.debug(`Started message: ${message.id}`, { component: 'SessionStore' });
    return message.id;
  }

  /**
   * Get current message
   */
  getCurrentMessage(): ChatMessage | undefined {
    const scope = getWorkerScope();
    if (scope) {
      return this.workerMessages.get(scope.workerId)?.currentMessage;
    }
    return this.localSession?.currentMessage;
  }

  /**
   * Update current message in Redis (for cross-pod consistency).
   * Worker messages are in-memory only — skip Redis for workers.
   */
  async updateCurrentMessage(): Promise<void> {
    if (getWorkerScope()) return;

    if (!this.localSession?.currentMessage) return;

    try {
      await this.stateStore.setCurrentMessage(
        this.context.sessionKey,
        toRedisMessage(this.localSession.currentMessage)
      );
    } catch (error) {
      logger.warn(`Failed to update current message in Redis`, { component: 'SessionStore' }, error);
    }
  }

  /**
   * Finalize current message (move to messages array)
   */
  async finalizeMessage(cancelled: boolean = false): Promise<void> {
    const scope = getWorkerScope();

    if (scope) {
      const ws = this.workerMessages.get(scope.workerId);
      if (!ws?.currentMessage) {
        logger.warn(`No current message to finalize for worker ${scope.workerId}`, { component: 'SessionStore' });
        return;
      }

      const message = ws.currentMessage;
      delete message.isStreaming;

      // Archive to shared messages array
      this.localSession!.messages.push(message);

      // Clean up worker slot
      ws.currentMessage = undefined;
      ws.activeFileOperations.clear();
      ws.thinkingStartTime = undefined;
      ws.lastThinkingContentIndex = undefined;

      // Persist: Redis session + chat.json (NO Redis currentMessage key for workers)
      try {
        await this.saveSession();
      } catch (error) {
        logger.warn(`Failed to save session to Redis after worker finalize`, { component: 'SessionStore' }, error);
      }
      this.saveToChatFile();

      logger.debug(`Finalized worker ${scope.workerId} message: ${message.id} (${message.contents.length} contents, cancelled=${cancelled})`, {
        component: 'SessionStore'
      });
      return;
    }

    // Main graph path
    if (!this.localSession?.currentMessage) {
      logger.warn(`No current message to finalize`, { component: 'SessionStore' });
      return;
    }

    const message = this.localSession.currentMessage;
    delete message.isStreaming;
    
    // Add to messages array
    this.localSession.messages.push(message);
    this.localSession.currentMessage = undefined;
    
    // Clear active file operations
    if (this.localSession.activeFileOperations) {
      this.localSession.activeFileOperations.clear();
    }
    
    // Reset thinking tracking
    this.localSession.thinkingStartTime = undefined;
    this.localSession.lastThinkingContentIndex = undefined;

    // Save to Redis
    try {
      await this.stateStore.setCurrentMessage(this.context.sessionKey, null);
      await this.saveSession();
    } catch (error) {
      logger.warn(`Failed to finalize message in Redis`, { component: 'SessionStore' }, error);
    }

    // ✅ CRITICAL: Also save to chat.json file for persistence
    this.saveToChatFile();

    logger.debug(`Finalized message: ${message.id} (${message.contents.length} contents, cancelled=${cancelled})`, {
      component: 'SessionStore'
    });
  }

  /**
   * Get chat.json file path
   * 
   * featurePath is the full feature directory path (e.g., .../features/skeleton)
   * containing inputs/, outputs/, sessions/
   */
  private getChatFilePath(): string | null {
    if (!this.featurePath) {
      return null;
    }
    
    return path.join(this.featurePath, 'sessions', 'chat.json');
  }

  /**
   * Flush current session state to chat.json without finalizing the active message.
   * Used to persist intermediate progress during long-running tool-call loops,
   * so messages are not lost if the job is interrupted before the task completes.
   */
  flushToChatFile(): void {
    this.saveToChatFile();
  }

  /**
   * Strip heavy file content from message contents for lightweight persistence.
   * Replaces file body and diffs with line-count summaries.
   * Non-file content (command output, text, thinking, etc.) is preserved as-is.
   */
  private static stripHeavyContent(contents: MessageContent[]): MessageContent[] {
    const FILE_OP_TYPES = new Set([
      'file_creating', 'file_writing', 'file_create', 'file_create_failed',
      'file_editing', 'file_updating', 'file_edit', 'file_edit_failed',
      'file_deleting', 'file_delete', 'file_delete_failed',
      'file_conflict', 'file_conflict_retry'
    ]);

    const PLAN_TYPES = new Set(['plan_generating', 'plan']);

    return contents.map(c => {
      if (PLAN_TYPES.has(c.type)) {
        const lineCount = c.content ? c.content.split('\n').length : 0;
        return {
          type: c.type,
          content: '',
          metadata: { ...c.metadata, lineCount }
        };
      }

      if (!FILE_OP_TYPES.has(c.type)) return c;

      const lineCount = c.content ? c.content.split('\n').length : 0;
      const diffBeforeLines = c.metadata?.diffBefore ? c.metadata.diffBefore.split('\n').length : 0;
      const diffAfterLines = c.metadata?.diffAfter ? c.metadata.diffAfter.split('\n').length : 0;

      return {
        type: c.type,
        content: '',
        metadata: {
          ...c.metadata,
          diffBefore: undefined,
          diffAfter: undefined,
          lineCount,
          diffBeforeLines,
          diffAfterLines,
        }
      };
    });
  }

  /**
   * Save session to chat.json file
   * 
   * Uses read-merge-write to handle parallel workers writing to the same file.
   * Each worker's localSession only contains its own messages, so we merge
   * with existing messages from other workers using message ID deduplication.
   */
  private saveToChatFile(): void {
    // Skip if no feature path
    if (!this.featurePath || !this.localSession) {
      return;
    }

    // Skip saving chat for base branches (learning only, no chat history needed)
    if (isBaseBranch(this.context.featureName, getBranchBase())) {
      logger.debug(`Skipping chat.json save for base branch: ${this.context.featureName}`, { 
        component: 'SessionStore' 
      });
      return;
    }

    const filePath = this.getChatFilePath();
    if (!filePath) {
      return;
    }

    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Read existing file for merge (preserves createdAt and other workers' messages)
      let createdAt = new Date().toISOString();
      let existingMessages: Array<{ id?: string; [key: string]: any }> = [];
      if (fs.existsSync(filePath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (existing.createdAt) {
            createdAt = existing.createdAt;
          }
          if (Array.isArray(existing.messages)) {
            existingMessages = existing.messages;
          }
        } catch {
          // Ignore parse errors, start fresh
        }
      }

      // Merge: deduplicate by message ID, then sort by timestamp
      const localMessages = this.localSession.messages.map(msg => ({
        ...msg,
        contents: SessionStore.stripHeavyContent(msg.contents),
        isStreaming: undefined,  // Don't persist streaming flag
        isComplete: true  // Mark as complete
      }));

      // Include in-progress currentMessages so they survive interruption.
      // Main graph's currentMessage:
      const inProgressMessages: typeof localMessages = [];
      if (this.localSession.currentMessage && this.localSession.currentMessage.contents.length > 0) {
        inProgressMessages.push({
          ...this.localSession.currentMessage,
          contents: SessionStore.stripHeavyContent(this.localSession.currentMessage.contents),
          isStreaming: undefined,
          isComplete: false
        });
      }
      // Worker-scoped currentMessages:
      for (const [, ws] of this.workerMessages) {
        if (ws.currentMessage && ws.currentMessage.contents.length > 0) {
          inProgressMessages.push({
            ...ws.currentMessage,
            contents: SessionStore.stripHeavyContent(ws.currentMessage.contents),
            isStreaming: undefined,
            isComplete: false
          });
        }
      }

      const allLocalMessages = [...localMessages, ...inProgressMessages];
      const localIds = new Set(allLocalMessages.map(m => m.id));
      const mergedMessages = [
        // Keep existing messages from other workers (not in local set)
        ...existingMessages.filter(m => m.id && !localIds.has(m.id)),
        // Add all local messages + in-progress messages (authoritative for this worker)
        ...allLocalMessages,
      ].sort((a, b) => {
        const ta = a.timestamp || '';
        const tb = b.timestamp || '';
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      });

      const sessionFile = {
        projectId: this.context.projectId,
        featureName: this.context.featureName,
        messages: mergedMessages,
        createdAt,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(filePath, JSON.stringify(sessionFile, null, 2), 'utf-8');
      logger.debug(`Saved chat.json: ${mergedMessages.length} messages (${localMessages.length} local, ${existingMessages.length} existing)`, { 
        component: 'SessionStore' 
      });
    } catch (error) {
      logger.warn(`Failed to save chat.json`, { component: 'SessionStore' }, error);
    }
  }

  /**
   * Track active file operation
   */
  trackFileOperation(filePath: string, contentIndex: number): void {
    const scope = getWorkerScope();
    if (scope) {
      const ws = this.workerMessages.get(scope.workerId);
      if (!ws) return;
      ws.activeFileOperations.set(filePath, { filePath, contentIndex });
      return;
    }

    if (!this.localSession) return;
    
    if (!this.localSession.activeFileOperations) {
      this.localSession.activeFileOperations = new Map();
    }
    
    this.localSession.activeFileOperations.set(filePath, { filePath, contentIndex });
    
    // Save to Redis asynchronously
    this.saveSession().catch(err => {
      logger.warn(`Failed to save activeFileOperations`, { component: 'SessionStore' }, err);
    });
  }

  /**
   * Get active file operation
   */
  getFileOperation(filePath: string): FileOperationTracker | undefined {
    const scope = getWorkerScope();
    if (scope) {
      return this.workerMessages.get(scope.workerId)?.activeFileOperations.get(filePath);
    }
    return this.localSession?.activeFileOperations?.get(filePath);
  }

  /**
   * Clear active file operation
   */
  clearFileOperation(filePath: string): void {
    const scope = getWorkerScope();
    if (scope) {
      this.workerMessages.get(scope.workerId)?.activeFileOperations.delete(filePath);
      return;
    }

    this.localSession?.activeFileOperations?.delete(filePath);
    
    // Save to Redis asynchronously
    this.saveSession().catch(err => {
      logger.warn(`Failed to clear activeFileOperations`, { component: 'SessionStore' }, err);
    });
  }
}
