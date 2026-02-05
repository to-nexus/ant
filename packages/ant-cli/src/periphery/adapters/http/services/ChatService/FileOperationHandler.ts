/**
 * FileOperationHandler - Handles file operation notifications
 * 
 * Manages file create/edit/delete operations and streaming content updates
 * 
 * CLOUD MODE: Uses async session retrieval for Redis-backed consistency.
 * All activeFileOperations changes are persisted to Redis for cross-Pod access.
 */

import type { MessageContent, FileOperationPhase, ChatSession } from './types';
import type { SessionManager } from './SessionManager';
import type { MessageBroadcaster } from './MessageBroadcaster';
import type { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';

export class FileOperationHandler {
  constructor(
    private sessionManager: SessionManager,
    private broadcaster: MessageBroadcaster
  ) {}

  /**
   * Add file operation notification
   * 
   * CLOUD MODE: Retrieves session from Redis for cross-Pod consistency.
   * All activeFileOperations changes are persisted to Redis.
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
    // ✅ CRITICAL: Use async version to ensure session is loaded from Redis
    // In multi-Pod environments, sync getSession() may return stale or missing data
    const session = jobId 
      ? await this.sessionManager.getOrCreateSessionAsync(projectId, featureName, jobId, userContext)
      : this.sessionManager.getSession(projectId, featureName);
    
    // Validate session and current message
    if (!session) {
      logger.warn(`No session found`, { component: 'FileOperationHandler', projectId, featureName });
      return;
    }
    
    if (!session.currentMessage) {
      logger.warn(`No currentMessage in session`, { component: 'FileOperationHandler', projectId, featureName });
      return;
    }
    
    if (!phase) {
      logger.warn(`No phase provided`, { component: 'FileOperationHandler', projectId, featureName }, { filePath });
      return;
    }
    
    // Try to update existing in-progress content
    const updated = await this.tryUpdateExisting(
      projectId, 
      featureName, 
      session, 
      operation, 
      filePath, 
      content, 
      diffBefore, 
      diffAfter, 
      phase, 
      error
    );
    
    if (updated) {
      return;
    }
    
    // No existing content found - add new content
    await this.addNewFileOperation(
      projectId, 
      featureName, 
      session, 
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
   * Try to update existing file operation content
   * Persists activeFileOperations changes to Redis.
   */
  private async tryUpdateExisting(
    projectId: string,
    featureName: string,
    session: ChatSession,
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    content?: string,
    diffBefore?: string,
    diffAfter?: string,
    phase?: FileOperationPhase,
    error?: string
  ): Promise<boolean> {
    // Include BOTH in-progress AND completed types to avoid duplicates
    const allFileTypes = {
      'create': ['file_creating', 'file_writing', 'file_create'],
      'edit': ['file_editing', 'file_updating', 'file_edit'],
      'delete': ['file_deleting', 'file_delete']
    };
    
    const typesToFind = allFileTypes[operation] || [];
    
    // Try to find via activeFileOperations Map (most reliable)
    const activeOp = session.activeFileOperations?.get(filePath);
    let existingIndex = activeOp ? activeOp.contentIndex : -1;
    
    // Fallback to type-based search
    if (existingIndex === -1) {
      existingIndex = session.currentMessage!.contents.findIndex(c => 
        typesToFind.includes(c.type) && 
        c.metadata?.filePath === filePath
      );
    }
    
    if (existingIndex === -1) {
      return false;
    }
    
    // Determine new type based on phase
    const newType = this.determineContentType(operation, phase!);
    
    // Update existing content
    const existingContent = session.currentMessage!.contents[existingIndex];
    if (!existingContent) {
      logger.warn(`Content at index ${existingIndex} is undefined`, { component: 'FileOperationHandler', projectId, featureName }, { filePath });
      return false;
    }
    
    const oldContent = existingContent.content || '';
    const newContent = content !== undefined ? content : oldContent;
    
    session.currentMessage!.contents[existingIndex] = {
      type: newType,
      content: newContent,
      metadata: {
        filePath,
        diffBefore,
        diffAfter,
        reason: (phase === 'failed' && error) ? error : existingContent.metadata?.reason,
        timestamp: new Date().toISOString()
      }
    };
    
    // Broadcast incremental update for writing phase (real-time streaming)
    if (phase === 'writing' && content !== undefined && oldContent !== newContent) {
      // Calculate delta (new content that was added)
      const delta = newContent.startsWith(oldContent) ? newContent.substring(oldContent.length) : newContent;
      
      this.broadcaster.broadcast(projectId, featureName, {
        type: 'content_append',
        messageId: session.currentMessage!.id,
        contentIndex: existingIndex,
        delta: delta
      }, session.userContext);
    } else {
      // Full content update for other phases
      this.broadcaster.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage!.id,
        contentIndex: existingIndex,
        content: session.currentMessage!.contents[existingIndex]
      }, session.userContext);
    }
    
    // Track active file operations for real-time streaming
    // ✅ CRITICAL: Track ALL non-complete phases to ensure subsequent updates can find the content
    let activeFileOpsChanged = false;
    const trackablePhases = ['creating', 'writing', 'editing', 'updating', 'deleting'];
    if (trackablePhases.includes(phase!)) {
      if (!session.activeFileOperations) {
        session.activeFileOperations = new Map();
      }
      session.activeFileOperations.set(filePath, { filePath, contentIndex: existingIndex });
      activeFileOpsChanged = true;
    } else if (phase === 'complete' || phase === 'failed') {
      if (session.activeFileOperations?.has(filePath)) {
        session.activeFileOperations.delete(filePath);
        activeFileOpsChanged = true;
      }
    }
    
    // ✅ CRITICAL: Save activeFileOperations to Redis for cross-Pod consistency
    if (activeFileOpsChanged) {
      await this.sessionManager.saveSessionAsync(
        projectId, featureName, session, session.userContext
      ).catch(err => {
        logger.warn('Failed to save activeFileOperations to Redis', { 
          component: 'FileOperationHandler' 
        }, err);
      });
    }
    
    return true;
  }

  /**
   * Add new file operation content
   * Persists activeFileOperations changes to Redis.
   */
  private async addNewFileOperation(
    projectId: string,
    featureName: string,
    session: ChatSession,
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    content?: string,
    diffBefore?: string,
    diffAfter?: string,
    phase?: FileOperationPhase,
    error?: string
  ): Promise<void> {
    const type = this.determineContentType(operation, phase!);

    const messageContent: MessageContent = {
      type,
      content: content || '',
      metadata: {
        filePath,
        diffBefore,
        diffAfter,
        reason: (phase === 'failed' && error) ? error : undefined,
        timestamp: new Date().toISOString()
      }
    };

    const contentIndex = session.currentMessage!.contents.length;
    session.currentMessage!.contents.push(messageContent);

    // Broadcast new content
    this.broadcaster.broadcast(projectId, featureName, {
      type: 'content_add',
      messageId: session.currentMessage!.id,
      content: messageContent
    }, session.userContext);

    // Track active file operations for real-time streaming
    // ✅ CRITICAL: Track ALL non-complete phases to prevent duplicate content_add
    let activeFileOpsChanged = false;
    const trackablePhases = ['creating', 'writing', 'editing', 'updating', 'deleting'];
    if (trackablePhases.includes(phase!) && contentIndex !== -1) {
      if (!session.activeFileOperations) {
        session.activeFileOperations = new Map();
      }
      session.activeFileOperations.set(filePath, { filePath, contentIndex });
      activeFileOpsChanged = true;
      logger.debug(`Tracked NEW file operation @${contentIndex} (phase=${phase})`, { component: 'FileOperationHandler', projectId, featureName }, { filePath });
    }
    
    // ✅ CRITICAL: Save activeFileOperations to Redis for cross-Pod consistency
    if (activeFileOpsChanged) {
      await this.sessionManager.saveSessionAsync(
        projectId, featureName, session, session.userContext
      ).catch(err => {
        logger.warn('Failed to save activeFileOperations to Redis', { 
          component: 'FileOperationHandler' 
        }, err);
      });
    }
  }

  /**
   * Determine content type based on operation and phase
   */
  private determineContentType(operation: 'edit' | 'create' | 'delete', phase: FileOperationPhase): MessageContent['type'] {
    if (phase === 'creating') {
      return 'file_creating';
    } else if (phase === 'writing') {
      return 'file_writing';
    } else if (phase === 'editing') {
      return 'file_editing';
    } else if (phase === 'updating') {
      return 'file_updating';
    } else if (phase === 'deleting') {
      return 'file_deleting';
    } else if (phase === 'complete') {
      const typeMap = {
        edit: 'file_edit' as const,
        create: 'file_create' as const,
        delete: 'file_delete' as const
      };
      return typeMap[operation];
    } else if (phase === 'failed') {
      const typeMap = {
        edit: 'file_edit_failed' as const,
        create: 'file_create_failed' as const,
        delete: 'file_delete_failed' as const
      };
      return typeMap[operation];
    }
    
    // Fallback (legacy - no phase)
    const typeMap = {
      edit: 'file_edit' as const,
      create: 'file_create' as const,
      delete: 'file_delete' as const
    };
    return typeMap[operation];
  }
}
