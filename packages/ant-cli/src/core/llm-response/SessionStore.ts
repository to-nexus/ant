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
import type { ChatSession, ChatMessage, FileOperationTracker } from '../chat/types';
import { getSessionKey, toRedisSession, fromRedisSession, toRedisMessage, fromRedisMessage, createAssistantMessage } from '../chat/schema';
import { logger } from '../../utils/logger';

// Base branches that don't need chat.json (learning only)
const BASE_BRANCH_NAMES = ['main', 'master', 'dev', 'develop', 'staging', 'production'];

export class SessionStore {
  private stateStore: StateStorePort;
  private context: SessionContext;
  private localSession: ChatSession | null = null;  // Local cache for hot path
  private workspacePath: string | undefined;

  constructor(stateStore: StateStorePort, env: LLMResponseEnv) {
    this.stateStore = stateStore;
    this.workspacePath = env.workspacePath;
    
    const userContext = env.userId && env.organizationId ? {
      userId: env.userId,
      organizationId: env.organizationId,
      workspacePath: env.workspacePath || ''
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
    // Return local cache if available
    if (this.localSession) {
      return this.localSession;
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
          
          // ⚠️ CRITICAL: Check if this is a stale message from a different job
          // This can happen when a previous job crashed without calling finalizeMessage()
          if (restoredMessage.jobId && restoredMessage.jobId !== this.context.jobId) {
            logger.warn(
              `Found stale currentMessage from job ${restoredMessage.jobId}, cleaning up (current job: ${this.context.jobId})`,
              { component: 'SessionStore' }
            );
            
            // Option 1: Save the incomplete message to messages array (preserve data)
            // This ensures user can see what happened in the failed job
            if (restoredMessage.contents && restoredMessage.contents.length > 0) {
              delete restoredMessage.isStreaming;
              this.localSession.messages.push(restoredMessage);
              logger.info(
                `Recovered stale message with ${restoredMessage.contents.length} contents from job ${restoredMessage.jobId}`,
                { component: 'SessionStore' }
              );
            }
            
            // Clear stale currentMessage from Redis
            await this.stateStore.setCurrentMessage(this.context.sessionKey, null);
            // Don't set it as currentMessage for this job
          } else {
            // Same job or no jobId - restore normally
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
        
        return this.localSession;
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
    return this.localSession;
  }

  /**
   * Get current session (local cache only, no Redis fetch)
   */
  getSession(): ChatSession | null {
    return this.localSession;
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
   */
  async hasActiveMessage(): Promise<boolean> {
    try {
      return await this.stateStore.hasActiveMessage(this.context.sessionKey);
    } catch (error) {
      logger.warn(`Failed to check active message`, { component: 'SessionStore' }, error);
      return this.localSession?.currentMessage !== undefined;
    }
  }

  /**
   * Start a new assistant message
   * Returns the message ID
   */
  async startMessage(): Promise<string> {
    const session = await this.getOrCreateSession();
    
    const message = createAssistantMessage(this.context.jobId);
    session.currentMessage = message;
    
    // ✅ Debug: Verify currentMessage is set on localSession
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
    return this.localSession?.currentMessage;
  }

  /**
   * Update current message in Redis (for cross-pod consistency)
   */
  async updateCurrentMessage(): Promise<void> {
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
   */
  private getChatFilePath(): string | null {
    if (!this.workspacePath) {
      return null;
    }
    
    const featurePath = path.join(
      this.workspacePath, 
      this.context.projectId, 
      this.context.featureName
    );
    return path.join(featurePath, 'sessions', 'chat.json');
  }

  /**
   * Save session to chat.json file
   */
  private saveToChatFile(): void {
    // Skip if no workspace path
    if (!this.workspacePath || !this.localSession) {
      return;
    }

    // Skip saving chat for base branches (learning only, no chat history needed)
    if (BASE_BRANCH_NAMES.includes(this.context.featureName.toLowerCase())) {
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

      // Load existing file to preserve createdAt
      let createdAt = new Date().toISOString();
      if (fs.existsSync(filePath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (existing.createdAt) {
            createdAt = existing.createdAt;
          }
        } catch {
          // Ignore parse errors, use new createdAt
        }
      }

      const sessionFile = {
        projectId: this.context.projectId,
        featureName: this.context.featureName,
        messages: this.localSession.messages.map(msg => ({
          ...msg,
          isStreaming: undefined,  // Don't persist streaming flag
          isComplete: true  // Mark as complete
        })),
        createdAt,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(filePath, JSON.stringify(sessionFile, null, 2), 'utf-8');
      logger.debug(`Saved chat.json: ${this.localSession.messages.length} messages`, { 
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
    return this.localSession?.activeFileOperations?.get(filePath);
  }

  /**
   * Clear active file operation
   */
  clearFileOperation(filePath: string): void {
    this.localSession?.activeFileOperations?.delete(filePath);
    
    // Save to Redis asynchronously
    this.saveSession().catch(err => {
      logger.warn(`Failed to clear activeFileOperations`, { component: 'SessionStore' }, err);
    });
  }
}
