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
import { getChatLogAppender } from './chatLogAppenderRegistry';

/**
 * Tools whose handlers emit their own `chat_status` pair (progress +
 * result). The generic `tool_action` fallback MUST skip these to avoid
 * a duplicate card sitting alongside the handler-owned one.
 *
 * Examples:
 *   - `read_file`            → `reading` / `read`                (WorkingCard)
 *   - `list_files`           → `listing_files` / `listed_files`  (WorkingCard)
 *   - `search_code`          → `searching_code` / `searched_code`(WorkingCard)
 *   - `run_command`          → `command_running` / `command_streaming` / `command`
 *                                                                (TerminalCard)
 *   - `search_reference_code`→ `searching_reference` / `searched_reference`
 *                                                                (WorkingCard)
 *
 * Kept local to the live event handler — this is the only site that
 * needs to gate the generic fallback; replay rebuilds cards directly
 * from the persisted `chat_status` line.
 */
const TOOLS_WITH_DEDICATED_STATUS: ReadonlySet<string> = new Set([
  'read_file',
  'list_files',
  'search_code',
  'run_command',
  'search_reference_code',
]);

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

        // Emit finalized thinking block to chat.jsonl (session redesign §16.2).
        // Fire-and-forget — failures must not disrupt streaming.
        const appender = getChatLogAppender();
        if (appender && thinkingContent.content?.trim()) {
          appender.appendThinking(thinkingContent.content);
        }
        
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
   * Handle tool use event (LLM tool calls).
   *
   * Dispatch rules: {@link TOOLS_WITH_DEDICATED_STATUS} gates the generic
   * tool_action fallback. File mutators and mkdir have their own handler
   * branches; everything else falls through to `handleGenericToolUse`.
   *
   * No `tool_call` line is written here — the chat SSOT is `chat_status`,
   * which each dedicated handler or the generic fallback emits downstream.
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
    else if (TOOLS_WITH_DEDICATED_STATUS.has(name)) {
      // No-op: these tools emit their own chat_status in their respective handlers
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
   * Handle mkdir tool use.
   *
   * Routes through `addToolActionContent` so the emission path is shared
   * with the generic fallback: one `MessageContent` insertion into the
   * live session AND one `chat_status('tool_action', metadata)` line to
   * chat.jsonl. Replay reproduces the identical card via
   * `generateChatStatusContent` — the `content` stored in metadata is
   * the same label the live path rendered.
   */
  private handleMkdirToolUse(input: any): void {
    const dirPath = input.path;
    this.addToolActionContent({
      toolName: 'mkdir',
      actionIcon: '📁',
      content: `Created directory: ${dirPath}`,
      extra: { filePath: dirPath },
    });
  }

  /**
   * Handle generic tool use (fallback).
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

    this.addToolActionContent({
      toolName,
      actionIcon: '🔧',
      content: displayContent,
    });
  }

  /**
   * Unified `tool_action` emission used by mkdir / generic tool paths.
   *
   * Both paths previously built a `MessageContent` inline and pushed it
   * via `addContent`, leaving the durable chat log without a
   * `chat_status` mirror. Here we:
   *   1. Build the same MessageContent the live path needs (unchanged).
   *   2. Append it via ContentMerger for live SSE broadcast.
   *   3. Emit one `chat_status` line with `statusType='tool_action'` and
   *      the same metadata so replay rebuilds the card through
   *      `generateChatStatusContent('tool_action', metadata)`.
   *
   * The `content` string is copied into metadata so
   * `generateChatStatusContent` (which reads `metadata.content` for
   * tool_action) can rebuild the label verbatim.
   */
  private addToolActionContent(args: {
    toolName: string;
    actionIcon: string;
    content: string;
    extra?: Record<string, unknown>;
  }): void {
    const timestamp = new Date().toISOString();
    const metadata: Record<string, unknown> = {
      toolName: args.toolName,
      actionIcon: args.actionIcon,
      content: args.content,
      timestamp,
      ...(args.extra ?? {}),
    };

    this.addContent({
      type: 'tool_action',
      content: args.content,
      metadata: metadata as MessageContent['metadata'],
    });

    const appender = getChatLogAppender();
    if (appender) {
      const { timestamp: _ts, ...persistedMetadata } = metadata;
      appender.appendChatStatus('tool_action', persistedMetadata);
    }
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

