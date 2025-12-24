/**
 * FileOperationHandler - Handles file operation notifications
 * 
 * Manages file create/edit/delete operations and streaming content updates
 */

import type { MessageContent, FileOperationPhase, ChatSession } from './types';
import type { SessionManager } from './SessionManager';
import type { MessageBroadcaster } from './MessageBroadcaster';

export class FileOperationHandler {
  constructor(
    private sessionManager: SessionManager,
    private broadcaster: MessageBroadcaster
  ) {}

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
    const session = this.sessionManager.getSession(projectId, featureName);
    
    // Validate session and current message
    if (!session) {
      console.error(`❌ [FileOperationHandler] No session found for ${projectId}/${featureName}`);
      return;
    }
    
    if (!session.currentMessage) {
      console.error(`❌ [FileOperationHandler] No currentMessage in session for ${projectId}/${featureName}`);
      return;
    }
    
    if (!phase) {
      console.warn(`⚠️  [FileOperationHandler] No phase provided for ${filePath}`);
      return;
    }
    
    // Try to update existing in-progress content
    const updated = this.tryUpdateExisting(
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
    this.addNewFileOperation(
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
   */
  private tryUpdateExisting(
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
  ): boolean {
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
      console.error(`[FileOperationHandler] ❌ Content at index ${existingIndex} is undefined!`);
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
      });
    } else {
      // Full content update for other phases
      this.broadcaster.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage!.id,
        contentIndex: existingIndex,
        content: session.currentMessage!.contents[existingIndex]
      });
    }
    
    // Track active file operations for real-time streaming
    if (phase === 'writing' || phase === 'updating') {
      if (!session.activeFileOperations) {
        session.activeFileOperations = new Map();
      }
      session.activeFileOperations.set(filePath, { filePath, contentIndex: existingIndex });
    } else if (phase === 'complete') {
      session.activeFileOperations?.delete(filePath);
    }
    
    return true;
  }

  /**
   * Add new file operation content
   */
  private addNewFileOperation(
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
  ): void {
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
    });

    // Track active file operations for real-time streaming
    if ((phase === 'writing' || phase === 'updating') && contentIndex !== -1) {
      if (!session.activeFileOperations) {
        session.activeFileOperations = new Map();
      }
      session.activeFileOperations.set(filePath, { filePath, contentIndex });
      console.log(`[FileOperationHandler] ✅ Tracked NEW file operation at index ${contentIndex} for: ${filePath}`);
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



