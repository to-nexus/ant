/**
 * LLMEventHandler - Handles LLM stream events directly in job workers
 * 
 * Processes LLM stream events and updates session state via Redis.
 * No HTTP overhead - direct Redis Pub/Sub for real-time updates.
 */

import type { LLMStreamEvent } from '../ports/llm';
import type { SessionStore } from './SessionStore';
import type { MessageBroadcaster } from '../chat/MessageBroadcaster';
import type { ContentMerger } from '../chat/ContentMerger';
import type { MessageContent } from '../chat/types';
import { logger } from '../../utils/logger';

export class LLMEventHandler {
  constructor(
    private sessionStore: SessionStore,
    private contentMerger: ContentMerger,
    private broadcaster: MessageBroadcaster
  ) {}

  /**
   * Process LLM stream event
   */
  handleEvent(event: LLMStreamEvent): void {
    const session = this.sessionStore.getSession();
    const ctx = this.sessionStore.getContext();
    
    if (!session) {
      logger.error(`No session found for LLM event type '${event.type}'`, {
        component: 'LLMEventHandler',
        projectId: ctx.projectId,
        featureName: ctx.featureName
      });
      return;
    }
    
    // ✅ Debug: Check if currentMessage exists
    if (!session.currentMessage) {
      logger.error(`No currentMessage in session for LLM event type '${event.type}' (messages: ${session.messages?.length || 0})`, {
        component: 'LLMEventHandler',
        projectId: ctx.projectId,
        featureName: ctx.featureName
      });
      return;
    }
    
    switch (event.type) {
      case 'thinking':
        this.handleThinkingEvent(event);
        break;

      case 'text':
        this.handleTextEvent(event);
        break;

      case 'tool_use':
        this.handleToolUseEvent(event);
        break;

      case 'done':
        // Don't finalize here - let caller decide
        break;

      case 'error':
        this.handleErrorEvent(event);
        break;
    }
  }

  /**
   * Handle thinking event (LLM reasoning)
   */
  private handleThinkingEvent(event: LLMStreamEvent): void {
    const session = this.sessionStore.getSession();
    const ctx = this.sessionStore.getContext();
    
    // Already checked in handleEvent(), but double-check for safety
    if (!session?.currentMessage) {
      logger.warn(`handleThinkingEvent: No currentMessage`, { component: 'LLMEventHandler' });
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
        
        // Broadcast update and collapse
        this.broadcaster.broadcastContentUpdate(
          ctx.projectId, 
          ctx.featureName, 
          session.currentMessage.id,
          thinkingIndex,
          thinkingContent,
          ctx.userContext
        );
        
        this.broadcaster.broadcastThinkingCollapse(
          ctx.projectId,
          ctx.featureName,
          session.currentMessage.id,
          thinkingIndex,
          durationMs || 0,
          ctx.userContext
        );
        
        // Reset tracking
        session.thinkingStartTime = undefined;
        session.lastThinkingContentIndex = undefined;
      }
    } else {
      // Regular thinking content
      this.addContent({
        type: 'thinking',
        content: event.thinking || '',
        metadata: event.metadata
      });
    }
  }

  /**
   * Handle text event (LLM response text)
   */
  private handleTextEvent(event: LLMStreamEvent): void {
    // Filter empty/whitespace-only text
    if (event.text && event.text.trim()) {
      this.addContent({
        type: 'text',
        content: event.text
      });
    }
  }

  /**
   * Handle tool use event (LLM tool calls)
   */
  private handleToolUseEvent(event: LLMStreamEvent): void {
    const session = this.sessionStore.getSession();
    
    if (!event.toolUse || !session?.currentMessage) return;

    const { name, input } = event.toolUse;
    
    // FILE OPERATIONS: edit_file, delete_file (create loading card)
    if (name === 'edit_file' || name === 'delete_file') {
      this.handleFileToolUse(name, input);
    }
    // SIMPLE TOOLS: mkdir
    else if (name === 'mkdir') {
      this.handleMkdirToolUse(input);
    }
    // OTHER TOOLS: Fallback to tool_action
    else {
      this.handleGenericToolUse(name, input);
    }
  }

  /**
   * Handle file tool use (edit_file, delete_file)
   */
  private handleFileToolUse(toolName: string, input: any): void {
    const filePath = input.path;
    if (!filePath) return;

    // Determine operation type
    let contentType: MessageContent['type'];
    if (toolName === 'delete_file') {
      contentType = 'file_deleting';
    } else if (toolName === 'edit_file') {
      contentType = 'file_editing';
    } else {
      contentType = 'file_creating';
    }
    
    const actualIndex = this.addContent({
      type: contentType,
      content: '',  // Empty initially, will be filled by tool node
      metadata: {
        filePath,
        timestamp: new Date().toISOString()
      }
    });
    
    // Track as active file operation with the ACTUAL index
    if (actualIndex !== -1) {
      this.sessionStore.trackFileOperation(filePath, actualIndex);
    }
  }

  /**
   * Handle mkdir tool use
   */
  private handleMkdirToolUse(input: any): void {
    const dirPath = input.path;
    
    this.addContent({
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
  private handleGenericToolUse(toolName: string, input: any): void {
    this.addContent({
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
  private handleErrorEvent(event: LLMStreamEvent): void {
    this.addContent({
      type: 'text',
      content: `❌ Error: ${event.error?.message || 'Unknown error'}`
    });
  }

  /**
   * Add content to current message via ContentMerger
   */
  private addContent(content: MessageContent): number {
    const session = this.sessionStore.getSession();
    const ctx = this.sessionStore.getContext();
    
    if (!session) return -1;
    
    return this.contentMerger.addContent(
      ctx.projectId,
      ctx.featureName,
      session,
      content
    );
  }
}
