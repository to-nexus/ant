/**
 * LLMEventHandler - Handles LLM stream events
 * 
 * Processes LLM stream events and converts them to chat content
 * 
 * CLOUD MODE: Uses session from local cache (loaded by ensureActiveMessageAsync 
 * before this handler is called). All session modifications that affect 
 * cross-Pod state (e.g., activeFileOperations) are persisted to Redis.
 */

import type { LLMStreamEvent } from '../../../../../core/ports/llm';
import type { MessageContent } from './types';
import type { SessionManager } from './SessionManager';
import type { MessageManager } from './MessageManager';
import type { MessageBroadcaster } from './MessageBroadcaster';
import { logger } from '../../../../../utils/logger';

export class LLMEventHandler {
  constructor(
    private sessionManager: SessionManager,
    private messageManager: MessageManager,
    private broadcaster: MessageBroadcaster
  ) {}

  /**
   * Process LLM stream event and convert to chat content
   * 
   * IMPORTANT: In Cloud mode, ensureActiveMessageAsync() MUST be called before
   * this method to ensure session is loaded from Redis into local cache.
   */
  handleLLMStreamEvent(
    projectId: string,
    featureName: string,
    event: LLMStreamEvent
  ): void {
    const session = this.sessionManager.getSession(projectId, featureName);
    
    if (!session) {
      // This should NOT happen if ensureActiveMessageAsync() was called
      logger.error(`No session found for LLM event type '${event.type}' - ensureActiveMessageAsync() may not have been called`, { 
        component: 'LLMEventHandler', 
        projectId, 
        featureName
      });
      return;
    }
    
    switch (event.type) {
      case 'thinking':
        this.handleThinkingEvent(projectId, featureName, session, event);
        break;

      case 'text':
        this.handleTextEvent(projectId, featureName, event);
        break;

      case 'tool_use':
        this.handleToolUseEvent(projectId, featureName, session, event);
        break;

      case 'done':
        // Don't finalize here - let the caller decide when to finalize
        break;

      case 'error':
        this.handleErrorEvent(projectId, featureName, event);
        break;
    }
  }

  /**
   * Handle thinking event (LLM reasoning)
   */
  private handleThinkingEvent(
    projectId: string,
    featureName: string,
    session: any,
    event: LLMStreamEvent
  ): void {
    if (!session?.currentMessage) {
      return;
    }

    const isBlockEnd = event.metadata?.blockEnd === true;
    
    if (isBlockEnd) {
      // BlockEnd: Find and collapse the most recent thinking block
      const durationMs = event.metadata?.durationMs;
      
      // Find last thinking content (reverse search)
      let thinkingIndex = -1;
      for (let i = session.currentMessage.contents.length - 1; i >= 0; i--) {
        if (session.currentMessage.contents[i].type === 'thinking') {
          thinkingIndex = i;
          break;
        }
      }
      
      if (thinkingIndex !== -1) {
        const thinkingContent = session.currentMessage.contents[thinkingIndex];
        
        // Append final content if exists
        if (event.thinking && event.thinking.trim()) {
          thinkingContent.content += event.thinking;
        }
        
        // Update metadata with duration
        thinkingContent.metadata = {
          ...thinkingContent.metadata,
          durationMs
        };
        
        // Broadcast update
        this.broadcaster.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: thinkingIndex,
          content: thinkingContent
        }, session.userContext);
        
        // Trigger collapse
        this.broadcaster.broadcast(projectId, featureName, {
          type: 'thinking_collapse',
          messageId: session.currentMessage.id,
          contentIndex: thinkingIndex,
          durationMs
        }, session.userContext);
        
        // Reset tracking
        session.thinkingStartTime = undefined;
        session.lastThinkingContentIndex = undefined;
      }
    } else {
      // Regular thinking content
      this.messageManager.addContentToCurrentMessage(projectId, featureName, {
        type: 'thinking',
        content: event.thinking || '',
        metadata: event.metadata
      });
    }
  }

  /**
   * Handle text event (LLM response text)
   */
  private handleTextEvent(
    projectId: string,
    featureName: string,
    event: LLMStreamEvent
  ): void {
    // Filter empty/whitespace-only text
    if (event.text && event.text.trim()) {
      this.messageManager.addContentToCurrentMessage(projectId, featureName, {
        type: 'text',
        content: event.text
      });
    }
  }

  /**
   * Handle tool use event (LLM tool calls)
   */
  private handleToolUseEvent(
    projectId: string,
    featureName: string,
    session: any,
    event: LLMStreamEvent
  ): void {
    if (!event.toolUse || !session?.currentMessage) {
      return;
    }

    const { name, input } = event.toolUse;
    
    // FILE OPERATIONS: edit_file, delete_file (create loading card)
    if (name === 'edit_file' || name === 'delete_file') {
      this.handleFileToolUse(projectId, featureName, session, name, input);
    }
    // SIMPLE TOOLS: mkdir
    else if (name === 'mkdir') {
      this.handleMkdirToolUse(projectId, featureName, input);
    }
    // OTHER TOOLS: Fallback to tool_action
    else {
      this.handleGenericToolUse(projectId, featureName, name, input);
    }
  }

  /**
   * Handle file tool use (edit_file, delete_file)
   */
  private handleFileToolUse(
    projectId: string,
    featureName: string,
    session: any,
    toolName: string,
    input: any
  ): void {
    const filePath = input.path;
    
    if (!filePath) {
      return;
    }

    
    // Determine operation type
    let contentType: MessageContent['type'];
    if (toolName === 'delete_file') {
      contentType = 'file_deleting';
    } else if (toolName === 'edit_file') {
      contentType = 'file_editing';
    } else {
      contentType = 'file_creating';
    }
    
    // Get the actual index after MERGE (placeholder → file_creating/editing/deleting)
    const actualIndex = this.messageManager.addContentToCurrentMessage(projectId, featureName, {
      type: contentType,
      content: '',  // Empty initially, will be filled by tool node
      metadata: {
        filePath,
        timestamp: new Date().toISOString()
      }
    });
    
    // Track as active file operation with the ACTUAL index
    if (actualIndex !== -1) {
      if (!session.activeFileOperations) {
        session.activeFileOperations = new Map();
      }
      session.activeFileOperations.set(filePath, { filePath, contentIndex: actualIndex });
      
      // ✅ CRITICAL: Save activeFileOperations to Redis for cross-Pod consistency
      // Without this, file card updates fail in multi-Pod environments
      this.sessionManager.saveSessionAsync(
        projectId, featureName, session, session.userContext
      ).catch(err => {
        logger.warn('Failed to save activeFileOperations to Redis', { 
          component: 'LLMEventHandler' 
        }, err);
      });
    }
  }

  /**
   * Handle mkdir tool use
   */
  private handleMkdirToolUse(
    projectId: string,
    featureName: string,
    input: any
  ): void {
    const dirPath = input.path;
    
    this.messageManager.addContentToCurrentMessage(projectId, featureName, {
      type: 'tool_action',
      content: `Created directory: ${dirPath}`,
      metadata: {
        toolName: 'mkdir',
        actionIcon: '📁',
        filePath: dirPath,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Handle generic tool use (fallback)
   */
  private handleGenericToolUse(
    projectId: string,
    featureName: string,
    toolName: string,
    input: any
  ): void {
    this.messageManager.addContentToCurrentMessage(projectId, featureName, {
      type: 'tool_action',
      content: `${toolName}: ${JSON.stringify(input)}`,
      metadata: {
        toolName,
        actionIcon: '🔧',
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Handle error event
   */
  private handleErrorEvent(
    projectId: string,
    featureName: string,
    event: LLMStreamEvent
  ): void {
    this.messageManager.addContentToCurrentMessage(projectId, featureName, {
      type: 'text',
      content: `❌ Error: ${event.error?.message || 'Unknown error'}`
    });
  }
}










