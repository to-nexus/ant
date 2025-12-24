/**
 * LLMEventHandler - Handles LLM stream events
 * 
 * Processes LLM stream events and converts them to chat content
 */

import type { LLMStreamEvent } from '../../../../../core/ports/llm';
import type { MessageContent } from './types';
import type { SessionManager } from './SessionManager';
import type { MessageManager } from './MessageManager';
import type { MessageBroadcaster } from './MessageBroadcaster';

export class LLMEventHandler {
  constructor(
    private sessionManager: SessionManager,
    private messageManager: MessageManager,
    private broadcaster: MessageBroadcaster
  ) {}

  /**
   * Process LLM stream event and convert to chat content
   */
  handleLLMStreamEvent(
    projectId: string,
    featureName: string,
    event: LLMStreamEvent
  ): void {
    const session = this.sessionManager.getSession(projectId, featureName);
    
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
        });
        
        // Trigger collapse
        this.broadcaster.broadcast(projectId, featureName, {
          type: 'thinking_collapse',
          messageId: session.currentMessage.id,
          contentIndex: thinkingIndex,
          durationMs
        });
        
        // Reset tracking
        session.thinkingStartTime = undefined;
        session.lastThinkingContentIndex = undefined;
      } else {
        console.warn(`[LLMEventHandler] ⚠️  blockEnd received but no thinking content found`);
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
    // COMMAND EXECUTION: run_command
    else if (name === 'run_command') {
      console.log(`[LLMEventHandler] ⏭️  Tool: ${name} (command output will be shown on completion)`);
    }
    // CODEBASE EXPLORATION: read_file, list_files, search_code
    else if (name === 'read_file' || name === 'list_files' || name === 'search_code') {
      console.log(`[LLMEventHandler] ⏭️  Tool: ${name} (handled by tool.ts with WorkingCard/ResultCard)`);
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

    console.log(`[LLMEventHandler] 📄 Creating loading file card for: ${filePath} (${toolName})`);
    
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
      console.log(`[LLMEventHandler] ✅ Tracked file operation at actual index ${actualIndex} for: ${filePath}`);
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
    console.log(`[LLMEventHandler] 📁 Tool: mkdir (${dirPath})`);
    
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
    console.log(`[LLMEventHandler] 🔧 Tool: ${toolName} (fallback to tool_action)`);
    
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




