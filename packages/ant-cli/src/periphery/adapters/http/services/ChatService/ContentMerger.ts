/**
 * ContentMerger - Handles content merging logic for chat messages
 * 
 * Manages the complex logic of merging, appending, and updating message content
 * Based on Cursor/Copilot style unified chat status handling
 */

import type { MessageContent, ChatSession } from './types';
import { CHAT_STATUS_TYPES, COMPLETED_CHAT_STATUS_TYPES } from './types';
import type { MessageBroadcaster } from './MessageBroadcaster';
import { logger } from '../../../../../utils/logger';

export class ContentMerger {
  constructor(private broadcaster?: MessageBroadcaster) {}

  /**
   * Add content to current streaming message with intelligent merging
   * Returns the actual content index used (important for MERGE cases)
   */
  addContent(
    projectId: string,
    featureName: string,
    session: ChatSession,
    content: MessageContent
  ): number {
    if (!session.currentMessage) {
      logger.warn(`No currentMessage in session for ${projectId}/${featureName}, content type: ${content.type}`, {
        component: 'ContentMerger'
      });
      return -1;
    }

    const existingContents = session.currentMessage.contents;
    const lastContent = existingContents.length > 0 
      ? existingContents[existingContents.length - 1] 
      : undefined;
    const lastContentIndex = existingContents.length - 1;

    // Check content types
    const isLastChatStatus = lastContent && CHAT_STATUS_TYPES.has(lastContent.type);
    const isNewChatStatus = CHAT_STATUS_TYPES.has(content.type);
    const isLastPlaceholder = lastContent?.type === 'placeholder';
    const isNewPlaceholder = content.type === 'placeholder';
    const isNewThinkingBlock = content.type === 'thinking' && content.metadata?.blockStart === true;

    // Case 1: Placeholder → Placeholder (node transition)
    if (isLastPlaceholder && isNewPlaceholder && lastContent) {
      return this.replaceContent(projectId, featureName, session, lastContentIndex, content);
    }

    // Case 2: Placeholder → anything (merge with placeholder)
    if (isLastPlaceholder && lastContent) {
      return this.mergeWithPlaceholder(projectId, featureName, session, lastContentIndex, content);
    }

    // Case 3: Explicit _mergeIndex (direct merge)
    if (content.metadata?._mergeIndex !== undefined) {
      return this.mergeByIndex(projectId, featureName, session, content);
    }

    // Case 4: Fallback merge (completion states)
    const fallbackIndex = this.tryFallbackMerge(projectId, featureName, session, content);
    if (fallbackIndex !== -1) {
      return fallbackIndex;
    }

    // Case 5: Direct duplicate of completed status = IGNORE
    if (this.shouldIgnoreDuplicate(lastContent, content)) {
      logger.debug(`IGNORED duplicate: ${content.type}`, { component: 'ContentMerger', projectId, featureName });
      return lastContentIndex;
    }

    // Case 6: Handle thinking block tracking
    this.handleThinkingBlockTransition(projectId, featureName, session, content);

    // Case 7: Streaming - same type content appending
    const canAppend = this.canAppendContent(lastContent, content, isNewThinkingBlock);
    
    if (canAppend) {
      return this.appendContent(projectId, featureName, session, lastContentIndex, content);
    }

    // Case 8: File operations - find and update in-progress content
    const fileOpIndex = this.handleFileOperation(projectId, featureName, session, content);
    if (fileOpIndex !== -1) {
      return fileOpIndex;
    }

    // Default: Add as new content block
    return this.addNewContent(projectId, featureName, session, content, isNewThinkingBlock);
  }

  /**
   * Replace content at index (placeholder → placeholder)
   */
  private replaceContent(
    projectId: string,
    featureName: string,
    session: ChatSession,
    index: number,
    content: MessageContent
  ): number {
    logger.debug('Node transition: placeholder -> placeholder', { component: 'ContentMerger', projectId, featureName });
    
    const target = session.currentMessage!.contents[index];
    target.type = content.type;
    target.content = content.content;
    target.metadata = { ...target.metadata, ...content.metadata };
    
    this.broadcaster?.broadcast(projectId, featureName, {
      type: 'content_update',
      messageId: session.currentMessage!.id,
      contentIndex: index,
      content: target
    }, session.userContext);
    
    return index;
  }

  /**
   * Merge with placeholder (placeholder → any content)
   */
  private mergeWithPlaceholder(
    projectId: string,
    featureName: string,
    session: ChatSession,
    placeholderIndex: number,
    content: MessageContent
  ): number {
    const target = session.currentMessage!.contents[placeholderIndex];
    logger.debug(`MERGED (placeholder): ${target.type} -> ${content.type}`, { component: 'ContentMerger', projectId, featureName });
    
    target.type = content.type;
    // Special case: placeholder → thinking = clear placeholder content
    if (content.type === 'thinking') {
      target.content = '';  // Clear placeholder, wait for LLM thinking
    } else {
      target.content = content.content;
    }
    target.metadata = { ...target.metadata, ...content.metadata };
    
    // Start tracking thinking block duration if applicable
    if (content.type === 'thinking' && content.metadata?.blockStart) {
      session.thinkingStartTime = Date.now();
      session.lastThinkingContentIndex = placeholderIndex;
    }
    
    this.broadcaster?.broadcast(projectId, featureName, {
      type: 'content_update',
      messageId: session.currentMessage!.id,
      contentIndex: placeholderIndex,
      content: target
    }, session.userContext);
    
    return placeholderIndex;
  }

  /**
   * Merge by explicit _mergeIndex
   */
  private mergeByIndex(
    projectId: string,
    featureName: string,
    session: ChatSession,
    content: MessageContent
  ): number {
    const targetIndex = content.metadata!._mergeIndex!;
    const existingContents = session.currentMessage!.contents;
    
    if (targetIndex >= 0 && targetIndex < existingContents.length) {
      const target = existingContents[targetIndex];
        logger.debug(`MERGED (explicit): ${target.type} -> ${content.type} @${targetIndex}`, { component: 'ContentMerger', projectId, featureName });
      
      target.type = content.type;
      target.content = content.content;
      target.metadata = { ...target.metadata, ...content.metadata };
      delete target.metadata._mergeIndex;  // Clean up
      
      this.broadcaster?.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage!.id,
        contentIndex: targetIndex,
        content: target
      }, session.userContext);
      
      return targetIndex;
    }
    
    return -1;
  }

  /**
   * Try fallback merge (completion states)
   */
  private tryFallbackMerge(
    projectId: string,
    featureName: string,
    session: ChatSession,
    content: MessageContent
  ): number {
    const completionToInProgress: Record<string, string> = {
      explored: 'exploring',
      retrieved: 'retrieving',
      grepped: 'grepping',
      read: 'reading',
      indexed: 'indexing',
      analyzed: 'analyzing',
      stored: 'storing',
      learned: 'learning',
      searched_code: 'searching_code',
      listed_files: 'listing_files',
      searched_reference: 'searching_reference',
      command: 'command_running'
    };
    
    const inProgressForCompletion = completionToInProgress[content.type];
    if (!inProgressForCompletion) {
      return -1;
    }

    const existingContents = session.currentMessage!.contents;
    
    // Reverse search: find the most recent matching in-progress status
    for (let i = existingContents.length - 1; i >= 0; i--) {
      if (existingContents[i]?.type === (inProgressForCompletion as any)) {
        const target = existingContents[i];
        logger.debug(`MERGED (fallback): ${target.type} -> ${content.type} @${i}`, { component: 'ContentMerger', projectId, featureName });
        
        target.type = content.type as any;
        target.content = content.content;
        target.metadata = { ...target.metadata, ...content.metadata };
        if (target.metadata) {
          delete (target.metadata as any)._mergeIndex;
        }
        
        this.broadcaster?.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage!.id,
          contentIndex: i,
          content: target as any
        }, session.userContext);
        
        return i;
      }
    }
    
    return -1;
  }

  /**
   * Check if should ignore duplicate
   */
  private shouldIgnoreDuplicate(lastContent: MessageContent | undefined, content: MessageContent): boolean {
    return !!(
      lastContent &&
      COMPLETED_CHAT_STATUS_TYPES.has(lastContent.type) &&
      lastContent.type === content.type
    );
  }

  /**
   * Handle thinking block transitions (track duration)
   */
  private handleThinkingBlockTransition(
    projectId: string,
    featureName: string,
    session: ChatSession,
    content: MessageContent
  ): void {
    if (!session.thinkingStartTime || session.lastThinkingContentIndex === undefined) {
      return;
    }

    // End previous thinking block if:
    // 1. New non-thinking content arrives, OR
    // 2. New thinking block starts (blockStart: true)
    const isEndingThinkingBlock = 
      content.type !== 'thinking' || 
      content.metadata?.blockStart;
    
    if (isEndingThinkingBlock) {
      const durationMs = Date.now() - session.thinkingStartTime;
      const thinkingContent = session.currentMessage!.contents[session.lastThinkingContentIndex];
      
      if (thinkingContent && thinkingContent.type === 'thinking') {
        // Update duration metadata
        thinkingContent.metadata = {
          ...thinkingContent.metadata,
          durationMs
        };
        
        // Broadcast duration update
        this.broadcaster?.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage!.id,
          contentIndex: session.lastThinkingContentIndex,
          content: thinkingContent
        }, session.userContext);
        
        // Broadcast collapse signal
        this.broadcaster?.broadcast(projectId, featureName, {
          type: 'thinking_collapse',
          messageId: session.currentMessage!.id,
          contentIndex: session.lastThinkingContentIndex,
          durationMs
        }, session.userContext);
      }
      
      // Reset tracking
      session.thinkingStartTime = undefined;
      session.lastThinkingContentIndex = undefined;
    }
  }

  /**
   * Check if content can be appended (streaming)
   */
  private canAppendContent(
    lastContent: MessageContent | undefined,
    content: MessageContent,
    isNewThinkingBlock: boolean
  ): boolean {
    if (!lastContent || lastContent.type !== content.type) {
      return false;
    }

    const isTextOrThinking = content.type === 'text' || content.type === 'thinking';
    const isTaskResponseStreaming = content.type === 'task_response';
    const isFileStreaming = 
      content.type === 'file_writing' ||
      content.type === 'file_updating' ||
      content.type === 'file_creating' ||
      content.type === 'file_editing' ||
      content.type === 'file_deleting';
    
    // For files, check if it's the same file
    const isSameFile = !!(lastContent.metadata?.filePath && 
                       content.metadata?.filePath &&
                       lastContent.metadata.filePath === content.metadata.filePath);
    
    return (
      (isTextOrThinking && !isNewThinkingBlock) ||  // text/thinking (not new block)
      isTaskResponseStreaming ||                     // task_response (always append)
      (isFileStreaming && isSameFile)               // file (same file only!)
    );
  }

  /**
   * Append content to last content (streaming)
   */
  private appendContent(
    projectId: string,
    featureName: string,
    session: ChatSession,
    lastIndex: number,
    content: MessageContent
  ): number {
    const target = session.currentMessage!.contents[lastIndex];
    target.content += content.content;
    target.metadata = { ...target.metadata, ...content.metadata };

    this.broadcaster?.broadcast(projectId, featureName, {
      type: 'content_update',
      messageId: session.currentMessage!.id,
      contentIndex: lastIndex,
      content: target
    }, session.userContext);
    
    return lastIndex;
  }

  /**
   * Handle file operation content updates
   */
  private handleFileOperation(
    projectId: string,
    featureName: string,
    session: ChatSession,
    content: MessageContent
  ): number {
    if (!content.metadata?.filePath) {
      return -1;
    }

    const completionTypes = ['file_create', 'file_edit', 'file_delete', 
                             'file_create_failed', 'file_edit_failed', 'file_delete_failed'];
    
    if (!completionTypes.includes(content.type)) {
      return -1;
    }

    const inProgressTypes: Record<string, string[]> = {
      'file_create': ['file_creating', 'file_writing'],
      'file_edit': ['file_editing', 'file_updating'],
      'file_delete': ['file_deleting'],
      'file_create_failed': ['file_creating', 'file_writing'],
      'file_edit_failed': ['file_editing', 'file_updating'],
      'file_delete_failed': ['file_deleting']
    };
    
    const typesToFind = inProgressTypes[content.type] || [];
    
    // Try to find via activeFileOperations (most reliable)
    let existingIndex = -1;
    if (session.activeFileOperations) {
      const activeOp = session.activeFileOperations.get(content.metadata.filePath);
      if (activeOp) {
        existingIndex = activeOp.contentIndex;
        logger.debug(`Found file card via activeFileOperations @${existingIndex}`, { component: 'ContentMerger', projectId, featureName }, { filePath: content.metadata.filePath });
      }
    }
    
    // Fallback to type-based search
    if (existingIndex === -1) {
      existingIndex = session.currentMessage!.contents.findIndex(c => 
        typesToFind.includes(c.type) && 
        c.metadata?.filePath === content.metadata?.filePath
      );
    }
    
    if (existingIndex !== -1) {
      // Update existing in-progress content
      session.currentMessage!.contents[existingIndex] = content;
      
      // Clear from activeFileOperations if it's a final state
      if (session.activeFileOperations) {
        const isFinalState = content.type.includes('_failed') || 
                            (content.type === 'file_create' || content.type === 'file_edit' || content.type === 'file_delete');
        if (isFinalState) {
          session.activeFileOperations.delete(content.metadata.filePath!);
          logger.debug(`Removed from activeFileOperations (final=${content.type})`, { component: 'ContentMerger', projectId, featureName }, { filePath: content.metadata.filePath });
        }
      }
      
      // Broadcast content update
      this.broadcaster?.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage!.id,
        contentIndex: existingIndex,
        content
      }, session.userContext);
      
      return existingIndex;
    }
    
    return -1;
  }

  /**
   * Add new content block
   */
  private addNewContent(
    projectId: string,
    featureName: string,
    session: ChatSession,
    content: MessageContent,
    isNewThinkingBlock: boolean
  ): number {
    if (isNewThinkingBlock) {
      logger.debug('New thinking block', { component: 'ContentMerger', projectId, featureName });
    }
    
    const newIndex = session.currentMessage!.contents.length;
    session.currentMessage!.contents.push(content);

    // Start tracking new thinking block
    if (content.type === 'thinking' && content.metadata?.blockStart) {
      session.thinkingStartTime = Date.now();
      session.lastThinkingContentIndex = newIndex;
    }

    // Broadcast content add
    this.broadcaster?.broadcast(projectId, featureName, {
      type: 'content_add',
      messageId: session.currentMessage!.id,
      content
    }, session.userContext);
    
    return newIndex;
  }

  /**
   * Finalize thinking blocks and in-progress work (called on message finalize)
   */
  finalizeContent(projectId: string, featureName: string, session: ChatSession, cancelled: boolean): void {
    if (!session.currentMessage) {
      return;
    }

    // Calculate duration for last thinking block if exists
    if (session.thinkingStartTime && session.lastThinkingContentIndex !== undefined) {
      const durationMs = Date.now() - session.thinkingStartTime;
      const thinkingContent = session.currentMessage.contents[session.lastThinkingContentIndex];
      
      if (thinkingContent && thinkingContent.type === 'thinking') {
        thinkingContent.metadata = {
          ...thinkingContent.metadata,
          durationMs
        };
        
        this.broadcaster?.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: session.lastThinkingContentIndex,
          content: thinkingContent
        }, session.userContext);
        
        this.broadcaster?.broadcast(projectId, featureName, {
          type: 'thinking_collapse',
          messageId: session.currentMessage.id,
          contentIndex: session.lastThinkingContentIndex,
          durationMs
        }, session.userContext);
      }
      
      session.thinkingStartTime = undefined;
      session.lastThinkingContentIndex = undefined;
    }

    // Finalize in-progress work states if cancelled
    if (cancelled) {
      this.finalizeInProgressWork(projectId, featureName, session);
      this.finalizeFileOperations(projectId, featureName, session, cancelled);
    }
  }

  /**
   * Finalize in-progress work states (analyzing, exploring, etc.)
   */
  private finalizeInProgressWork(projectId: string, featureName: string, session: ChatSession): void {
    const inProgressWorkTypes = new Set([
      'placeholder',  // ✅ Added: Placeholder should be removed on cancel
      'analyzing', 'exploring', 'retrieving', 'grepping', 'reading', 
      'indexing', 'storing', 'learning', 'searching_code', 'listing_files'
    ]);
    
    session.currentMessage!.contents.forEach((content, index) => {
      if (inProgressWorkTypes.has(content.type)) {
        const cancelledContent = {
          ...content,
          type: 'cancelled' as const,
          metadata: {
            ...content.metadata,
            originalType: content.type,
            reason: 'user_stopped'
          }
        };
        
        session.currentMessage!.contents[index] = cancelledContent;
        
        this.broadcaster?.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage!.id,
          contentIndex: index,
          content: cancelledContent
        }, session.userContext);
        
        logger.debug(`Cancelled in-progress work: ${content.type}`, { component: 'ContentMerger', projectId, featureName });
      }
    });
  }

  /**
   * Finalize active file operations
   */
  private finalizeFileOperations(projectId: string, featureName: string, session: ChatSession, cancelled: boolean): void {
    if (!session.activeFileOperations || session.activeFileOperations.size === 0) {
      return;
    }

    for (const [filePath, fileOp] of session.activeFileOperations.entries()) {
      const fileContent = session.currentMessage!.contents[fileOp.contentIndex];
      if (fileContent) {
        // Convert streaming types to completed types
        if (fileContent.type === 'file_creating' || fileContent.type === 'file_writing') {
          fileContent.type = 'file_create';
        } else if (fileContent.type === 'file_editing' || fileContent.type === 'file_updating') {
          fileContent.type = 'file_edit';
        } else if (fileContent.type === 'file_deleting') {
          fileContent.type = 'file_delete';
        }
        
        // Mark as interrupted if job was stopped
        if (cancelled) {
          fileContent.metadata = {
            ...fileContent.metadata,
            reason: 'user_stopped'
          };
        }
        
        this.broadcaster?.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage!.id,
          contentIndex: fileOp.contentIndex,
          content: fileContent
        }, session.userContext);
      }
    }
    
    session.activeFileOperations.clear();
  }
}

