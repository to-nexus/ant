/**
 * FileOperationHandler - Handles file operation notifications in job workers
 * 
 * Manages file create/edit/delete operations and streaming content updates.
 * Direct Redis updates for real-time streaming.
 */

import type { SessionStore } from './SessionStore';
import type { MessageBroadcaster } from '../chat/MessageBroadcaster';
import type { ContentMerger } from '../chat/ContentMerger';
import type { MessageContent, ChatSession } from '../chat/types';
import type { FileOperationPhase } from './types';
import { logger } from '../../utils/logger';
import { getTraceAppender } from './traceAppenderRegistry';

export class FileOperationHandler {
  constructor(
    private sessionStore: SessionStore,
    private broadcaster: MessageBroadcaster,
    private contentMerger?: ContentMerger
  ) {}

  /**
   * Start file creation (header only, no content yet)
   */
  async startFileCreation(filePath: string): Promise<void> {
    await this.addFileOperation('create', filePath, 'creating');
  }

  /**
   * Stream file content during writing (real-time updates)
   */
  async streamFileContent(filePath: string, content: string): Promise<void> {
    await this.addFileOperation('create', filePath, 'writing', { content });
  }

  /**
   * Complete file creation (final state, collapsible)
   */
  async completeFileCreation(filePath: string, content: string): Promise<void> {
    await this.addFileOperation('create', filePath, 'complete', { content });
  }

  /**
   * Start file edit (header only)
   */
  async startFileEdit(filePath: string): Promise<void> {
    await this.addFileOperation('edit', filePath, 'editing');
  }

  /**
   * Stream file diff during update (real-time)
   */
  async streamFileDiff(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    await this.addFileOperation('edit', filePath, 'updating', { diffBefore, diffAfter });
  }

  /**
   * Complete file edit (final state, collapsible)
   */
  async completeFileEdit(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    await this.addFileOperation('edit', filePath, 'complete', { diffBefore, diffAfter });
  }

  /**
   * Start file deletion
   */
  async startFileDeletion(filePath: string): Promise<void> {
    await this.addFileOperation('delete', filePath, 'deleting');
  }

  /**
   * Complete file deletion
   */
  async completeFileDeletion(filePath: string, content?: string): Promise<void> {
    await this.addFileOperation('delete', filePath, 'complete', { content });
  }

  /**
   * Fail file edit (error occurred)
   */
  async failFileEdit(filePath: string, errorMessage: string): Promise<void> {
    await this.addFileOperation('edit', filePath, 'failed', { error: errorMessage });
  }

  /**
   * Fail file creation (error occurred)
   */
  async failFileCreation(filePath: string, errorMessage: string): Promise<void> {
    await this.addFileOperation('create', filePath, 'failed', { error: errorMessage });
  }

  /**
   * Core method: Add file operation notification
   */
  private async addFileOperation(
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    phase: FileOperationPhase,
    options?: {
      content?: string;
      diffBefore?: string;
      diffAfter?: string;
      error?: string;
    }
  ): Promise<void> {
    const ctx = this.sessionStore.getContext();

    // ✅ Ensure local session is loaded (critical for resume: new process has empty localSession)
    let session = this.sessionStore.getSession();
    if (!session) {
      session = await this.sessionStore.getOrCreateSession();
    }

    if (!session || !session.currentMessage) {
      logger.warn(`No active message for file operation`, { 
        component: 'FileOperationHandler',
        projectId: ctx.projectId,
        featureName: ctx.featureName
      });
      return;
    }

    // Try to update existing in-progress content
    const updated = await this.tryUpdateExisting(session, operation, filePath, phase, options);

    if (!updated) {
      // No existing content found - add new content
      await this.addNewFileOperation(session, operation, filePath, phase, options);
    }

    // Terminal phases (complete / failed) are the SSOT for the chat log
    // `file_write` emission — chat SSE and the durable chat log share one
    // call site. Also emits a `chat_status` line carrying the same
    // `(statusType, metadata)` the live path used so replay reproduces
    // the card via `generateChatStatusContent` without a separate builder.
    if (phase === 'complete' || phase === 'failed') {
      this.emitFileWriteTrace(operation, filePath, phase, options);
      this.emitFileChatStatus(operation, filePath, phase, options);
    }
  }

  /**
   * Mirror a terminal file-op onto the chat log as a legacy
   * `file_write` line. Fire-and-forget — the appender internally swallows
   * I/O errors so chat streaming is never blocked. Skips when the trace
   * appender is not initialised (tests, processes without a recorded
   * user_turn).
   *
   * This path stays wired during the migration so pre-existing feature
   * folders (whose readers depend on `file_write`) keep rendering. A
   * follow-up commit removes it once the chat_status path has soaked.
   */
  private emitFileWriteTrace(
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    phase: FileOperationPhase,
    options?: {
      content?: string;
      diffBefore?: string;
      diffAfter?: string;
      error?: string;
    },
  ): void {
    const appender = getTraceAppender();
    if (!appender) return;
    const traceOp: 'create' | 'update' | 'delete' =
      operation === 'edit' ? 'update' : operation;
    const payload: {
      content?: string;
      diffBefore?: string;
      diffAfter?: string;
      error?: string;
    } = {};
    if (phase === 'failed') {
      payload.error = options?.error;
    } else {
      if (operation === 'create' || operation === 'delete') {
        payload.content = options?.content;
      } else {
        payload.diffBefore = options?.diffBefore;
        payload.diffAfter = options?.diffAfter;
      }
    }
    appender.appendFileWrite(traceOp, filePath, payload);
  }

  /**
   * Emit a `chat_status` line for a terminal file-op so replay
   * reproduces the FileCard via `generateChatStatusContent(statusType,
   * metadata)` — the exact same function the live path called through
   * `ChatStatusHandler.showChatStatus`. Uses the same metadata keys the
   * live FileCard reads (`filePath`, `content`, `diffBefore`, `diffAfter`,
   * `reason`) so the UI branch stays shared across broadcast and replay.
   */
  private emitFileChatStatus(
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    phase: FileOperationPhase,
    options?: {
      content?: string;
      diffBefore?: string;
      diffAfter?: string;
      error?: string;
    },
  ): void {
    const appender = getTraceAppender();
    if (!appender) return;
    const statusType =
      phase === 'failed'
        ? (operation === 'create'
            ? 'file_create_failed'
            : operation === 'delete'
              ? 'file_delete_failed'
              : 'file_edit_failed')
        : (operation === 'create'
            ? 'file_create'
            : operation === 'delete'
              ? 'file_delete'
              : 'file_edit');
    const metadata: Record<string, unknown> = { filePath };
    if (phase === 'failed') {
      metadata.reason = options?.error;
    } else if (operation === 'create' || operation === 'delete') {
      metadata.content = options?.content;
    } else {
      metadata.diffBefore = options?.diffBefore;
      metadata.diffAfter = options?.diffAfter;
    }
    appender.appendChatStatus(statusType, metadata);
  }

  /**
   * Try to update existing file operation content
   */
  private async tryUpdateExisting(
    session: ChatSession,
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    phase: FileOperationPhase,
    options?: {
      content?: string;
      diffBefore?: string;
      diffAfter?: string;
      error?: string;
    }
  ): Promise<boolean> {
    const ctx = this.sessionStore.getContext();
    
    // Only search for IN-PROGRESS types in fallback (never completed types).
    // Including completed types (file_edit, file_create, file_delete) would cause
    // multi-edit scenarios to update an already-completed card instead of the new one.
    const inProgressFileTypes = {
      'create': ['file_creating', 'file_writing'],
      'edit': ['file_editing', 'file_updating'],
      'delete': ['file_deleting']
    };
    
    const typesToFind = inProgressFileTypes[operation] || [];
    
    // Try to find via activeFileOperations Map (most reliable)
    const activeOp = this.sessionStore.getFileOperation(filePath);
    let existingIndex = activeOp ? activeOp.contentIndex : -1;
    
    // Fallback to type-based REVERSE search (find most recent in-progress card, not first)
    if (existingIndex === -1) {
      const contents = session.currentMessage!.contents;
      for (let i = contents.length - 1; i >= 0; i--) {
        if (typesToFind.includes(contents[i].type) && 
            contents[i].metadata?.filePath === filePath) {
          existingIndex = i;
          break;
        }
      }
    }
    
    if (existingIndex === -1) {
      return false;
    }
    
    // Determine new type based on phase
    const newType = this.determineContentType(operation, phase);
    
    // Update existing content
    const existingContent = session.currentMessage!.contents[existingIndex];
    if (!existingContent) {
      logger.warn(`Content at index ${existingIndex} is undefined`, { 
        component: 'FileOperationHandler',
        projectId: ctx.projectId,
        featureName: ctx.featureName
      });
      return false;
    }
    
    const oldContent = existingContent.content || '';
    const newContent = options?.content !== undefined ? options.content : oldContent;
    
    session.currentMessage!.contents[existingIndex] = {
      type: newType,
      content: newContent,
      metadata: {
        filePath,
        diffBefore: options?.diffBefore,
        diffAfter: options?.diffAfter,
        reason: (phase === 'failed' && options?.error) ? options.error : existingContent.metadata?.reason,
        timestamp: new Date().toISOString()
      }
    };
    
    // Broadcast incremental update for writing phase (real-time streaming)
    if (phase === 'writing' && options?.content !== undefined && oldContent !== newContent) {
      // Calculate delta (new content that was added)
      const delta = newContent.startsWith(oldContent) ? newContent.substring(oldContent.length) : newContent;
      
      this.broadcaster.broadcast(ctx.projectId, ctx.featureName, {
        type: 'content_append',
        messageId: session.currentMessage!.id,
        contentIndex: existingIndex,
        delta: delta
      }, ctx.userContext);
    } else {
      // Full content update for other phases
      this.broadcaster.broadcastContentUpdate(
        ctx.projectId,
        ctx.featureName,
        session.currentMessage!.id,
        existingIndex,
        session.currentMessage!.contents[existingIndex],
        ctx.userContext
      );
    }
    
    // Track active file operations for real-time streaming
    const trackablePhases = ['creating', 'writing', 'editing', 'updating', 'deleting'];
    if (trackablePhases.includes(phase)) {
      this.sessionStore.trackFileOperation(filePath, existingIndex);
    } else if (phase === 'complete' || phase === 'failed') {
      this.sessionStore.clearFileOperation(filePath);
    }
    
    // Update Redis asynchronously
    this.sessionStore.updateCurrentMessage().catch(err => {
      logger.warn(`Failed to update current message in Redis`, { 
        component: 'FileOperationHandler' 
      }, err);
    });
    
    return true;
  }

  /**
   * Add new file operation content
   */
  private async addNewFileOperation(
    session: ChatSession,
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    phase: FileOperationPhase,
    options?: {
      content?: string;
      diffBefore?: string;
      diffAfter?: string;
      error?: string;
    }
  ): Promise<void> {
    const ctx = this.sessionStore.getContext();
    const type = this.determineContentType(operation, phase);

    const messageContent: MessageContent = {
      type,
      content: options?.content || '',
      metadata: {
        filePath,
        diffBefore: options?.diffBefore,
        diffAfter: options?.diffAfter,
        reason: (phase === 'failed' && options?.error) ? options.error : undefined,
        timestamp: new Date().toISOString()
      }
    };

    // Use ContentMerger to properly handle placeholder removal.
    // Without this, placeholders injected by startMessage() persist alongside file cards
    // because direct contents.push() bypasses the Universal Placeholder System.
    let contentIndex: number;
    if (this.contentMerger) {
      contentIndex = this.contentMerger.addContent(
        ctx.projectId, ctx.featureName, session, messageContent
      );
    } else {
      // Fallback: direct push (should not happen in normal flow)
      contentIndex = session.currentMessage!.contents.length;
      session.currentMessage!.contents.push(messageContent);
      this.broadcaster.broadcastContentAdd(
        ctx.projectId,
        ctx.featureName,
        session.currentMessage!.id,
        messageContent,
        ctx.userContext
      );
    }

    // Track active file operations for real-time streaming
    const trackablePhases = ['creating', 'writing', 'editing', 'updating', 'deleting'];
    if (trackablePhases.includes(phase)) {
      this.sessionStore.trackFileOperation(filePath, contentIndex);
      logger.debug(`Tracked NEW file operation @${contentIndex} (phase=${phase})`, { 
        component: 'FileOperationHandler',
        projectId: ctx.projectId,
        featureName: ctx.featureName
      });
    }
    
    // Update Redis asynchronously
    this.sessionStore.updateCurrentMessage().catch(err => {
      logger.warn(`Failed to update current message in Redis`, { 
        component: 'FileOperationHandler' 
      }, err);
    });
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
