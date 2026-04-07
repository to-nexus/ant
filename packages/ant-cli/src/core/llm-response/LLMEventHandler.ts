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
  private lastRedisWrite = 0;
  private writeInFlight = false;

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
   * Tools that have dedicated status handlers in their tool handler functions.
   * These emit their own chat status (e.g. reading/read, listing_files/listed_files)
   * so they should NOT also emit a generic tool_action to avoid duplicate UI entries.
   */
  private static readonly TOOLS_WITH_DEDICATED_STATUS = new Set([
    'read_file',              // → reading/read (WorkingCard)
    'list_files',             // → listing_files/listed_files (WorkingCard)
    'search_code',            // → searching_code/searched_code (WorkingCard)
    'run_command',            // → command_running/command_streaming/command (TerminalCard)
    'search_reference_code',  // → searching_reference/searched_reference (WorkingCard)
  ]);

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
    // SHADOW TOOLS: file/write_file/create_file (LLM incorrectly uses tool instead of <file> XML)
    else if (name === 'file' || name === 'write_file' || name === 'create_file') {
      this.handleFileToolUse(name, input);  // → file_creating (FileCard loading)
    }
    // SIMPLE TOOLS: mkdir
    else if (name === 'mkdir') {
      this.handleMkdirToolUse(input);
    }
    // TOOLS WITH DEDICATED STATUS: Skip generic tool_action (their handlers emit own status)
    else if (LLMEventHandler.TOOLS_WITH_DEDICATED_STATUS.has(name)) {
      // No-op: these tools emit their own chat status in their respective handlers
      // (e.g. readFile.ts emits 'reading'/'read', runCommand.ts emits 'command_running'/'command')
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
   * Truncates long string values in input to prevent UI overflow.
   */
  private handleGenericToolUse(toolName: string, input: any): void {
    // Truncate long string values (e.g. content, new_str, old_str)
    const summary: Record<string, any> = { ...input };
    for (const key of Object.keys(summary)) {
      if (typeof summary[key] === 'string' && summary[key].length > 100) {
        summary[key] = `(${summary[key].length} chars)`;
      }
    }
    const json = JSON.stringify(summary);
    const displayContent = json.length > 200
      ? `${toolName}: ${json.substring(0, 200)}...`
      : `${toolName}: ${json}`;

    this.addContent({
      type: 'tool_action',
      content: displayContent,
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
    
    const result = this.contentMerger.addContent(
      ctx.projectId,
      ctx.featureName,
      session,
      content
    );

    this.scheduleRedisWrite();
    return result;
  }

  /**
   * Throttled Redis write for crash resilience.
   * No-op for worker-scoped messages (updateCurrentMessage skips them).
   */
  private scheduleRedisWrite(): void {
    const now = Date.now();
    if (this.writeInFlight || now - this.lastRedisWrite < 2000) return;

    this.writeInFlight = true;
    this.lastRedisWrite = now;
    this.sessionStore.updateCurrentMessage()
      .catch((err) => {
        logger.warn('Throttled Redis write failed', { component: 'LLMEventHandler' }, err);
      })
      .finally(() => { this.writeInFlight = false; });
  }
}
