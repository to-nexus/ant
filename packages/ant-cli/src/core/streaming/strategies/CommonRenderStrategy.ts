/**
 * Common rendering strategy that covers 99% of streaming use cases
 * 
 * Handles:
 * - thinking: LLM reasoning output
 * - response: General text response
 * - file_start: Begin file creation/editing
 * - file_content: Stream file content
 * - file_end: Complete file operation
 */

import { IRenderStrategy } from './IRenderStrategy';
import { ParsedAction, FileStreamInfo } from '../types';
import { FileRegistry } from '../state/FileRegistry';
import { ChatAPIClient } from '../../adapters/ChatAPIClient';
import { SpecialTagTransformer } from '../transformers/SpecialTagTransformer';
import { UserLanguage } from '../../utils/languageDetector';

interface EditOperation {
  filePath: string;
  searchContent: string;
  replaceContent: string;
}

export class CommonRenderStrategy implements IRenderStrategy {
  private chatAPI: ChatAPIClient;
  private activeFiles: Map<string, FileStreamInfo> = new Map();
  private editOperations: Map<string, EditOperation> = new Map();
  private lineBuffers: Map<string, string> = new Map();  // ✅ Line-based buffering for smooth streaming
  private bufferManager?: import('../buffer/StreamBufferManager').StreamBufferManager;  // ✅ Disk buffer for interruption safety
  
  // ✅ Thinking timing
  private thinkingStartTime?: number;
  
  // ✅ Special tag transformer for converting XML tags to user-friendly messages
  private tagTransformer: SpecialTagTransformer;
  
  constructor(
    chatAPI: ChatAPIClient,
    bufferManager?: import('../buffer/StreamBufferManager').StreamBufferManager,
    userLanguage?: UserLanguage
  ) {
    this.chatAPI = chatAPI;
    this.bufferManager = bufferManager;
    this.tagTransformer = new SpecialTagTransformer(userLanguage || 'en');
  }
  
  async render(action: ParsedAction, registry: FileRegistry): Promise<void> {
    switch (action.type) {
      case 'thinking':
        await this.renderThinking(action);
        break;
        
      case 'response':
        await this.renderResponse(action);
        break;
        
      // ❌ tasks_start, tasks_content, tasks_end 제거 (UI 출력 없음)
        
      case 'file_start':
        await this.renderFileStart(action, registry);
        break;
        
      case 'file_content':
        await this.renderFileContent(action, registry);
        break;
        
      case 'file_end':
        await this.renderFileEnd(action, registry);
        break;
        
      default:
        console.warn(`[CommonRenderStrategy] Unknown action type: ${action.type}`);
    }
  }
  
  private async renderThinking(action: ParsedAction): Promise<void> {
    const content = action.data.content || '';
    const isBlockStart = action.data.blockStart === true;
    const isBlockEnd = action.data.blockEnd === true;
    
    // ✅ Show Chat Status when new thinking block starts
    if (isBlockStart) {
      this.thinkingStartTime = Date.now();  // ✅ Start timing
      
      await this.chatAPI.showChatStatus('thinking', {
        blockStart: true
      });
      
      // ✅ If blockStart has content, send it separately WITHOUT blockStart flag
      // (showChatStatus already handled the placeholder → thinking merge)
      if (content) {
        await this.chatAPI.sendLLMEvent({
          type: 'thinking',
          thinking: content,
          metadata: {
            provider: 'llm',
            timestamp: new Date().toISOString()
          }
        });
      }
    } else if (isBlockEnd) {
      // ✅ Calculate thinking duration
      // Use LLM-provided duration first (more accurate), fallback to local timer
      const durationMs = action.data.durationMs 
        || (this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined);
      
      // ✅ CRITICAL: Always send blockEnd signal with duration
      // This ensures ChatService can trigger thinking_collapse
      await this.chatAPI.sendLLMEvent({
        type: 'thinking',
        thinking: content,  // Send final content (or empty string)
        metadata: {
          provider: 'llm',
          timestamp: new Date().toISOString(),
          blockEnd: true,  // ✅ Always signal end
          durationMs  // ✅ Pass duration for "Thought for 3s"
        }
      });
      
      this.thinkingStartTime = undefined;  // Reset
    } else {
      // ✅ Regular thinking content (not block start/end) - just append
      if (content) {
        await this.chatAPI.sendLLMEvent({
          type: 'thinking',
          thinking: content,
          metadata: {
            provider: 'llm',
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  }
  
  private async renderResponse(action: ParsedAction): Promise<void> {
    const content = action.data.content;
    
    // ✅ CRITICAL: Filter out empty/whitespace-only content
    // This prevents empty code blocks from appearing in Chat UI
    if (!content || !content.trim()) {
      console.log(`[Render] 🚫 Skipping empty response content`);
      return;
    }
    
    // ✅ Also skip if content is ONLY newlines/spaces (no visible text)
    if (content.replace(/[\s\n\r]/g, '').length === 0) {
      console.log(`[Render] 🚫 Skipping whitespace-only response: ${JSON.stringify(content)}`);
      return;
    }
    
    // ✅ CRITICAL: Filter out XML markdown code block tags
    // LLM sometimes wraps XML streaming output in ```xml ... ``` which creates empty code blocks in UI
    const trimmed = content.trim();
    if (trimmed === '```xml' || trimmed === '```') {
      console.log(`[Render] 🚫 Skipping XML markdown block tag: ${JSON.stringify(content)}`);
      return;
    }
    
    // ✅ Transform special tags into user-friendly messages using SpecialTagTransformer
    const transformed = this.tagTransformer.transform(content);
    
    // 🐛 DEBUG: Check if detect tag is being transformed
    if (content.includes('<detect>')) {
      console.log(`🐛 [Render] DETECT TAG FOUND in chunk (${content.length} chars)`);
      console.log(`🐛 [Render] transformed.consumed: ${transformed.consumed}`);
      console.log(`🐛 [Render] transformed.text length: ${transformed.text?.length || 0}`);
    }
    
    // If transformation consumed the entire content, stop here
    if (transformed.consumed) {
      if (transformed.text) {
        await this.chatAPI.sendLLMEvent({
          type: 'text',
          text: transformed.text
        });
      }
      return;
    }
    
    await this.chatAPI.sendLLMEvent({
      type: 'text',
      text: transformed.text || content
    });
  }
  
  // ❌ tasks 렌더링 메서드 모두 제거 (UI 출력 없음)
  
  /**
   * Try to parse partial JSON incrementally
   * Returns parsed object if valid, null if incomplete
   */
  private tryParsePartialJSON(json: string): any | null {
    try {
      // Try to parse as-is first
      return JSON.parse(json);
    } catch {
      // Try to complete incomplete JSON structures
      const completed = this.completePartialJSON(json);
      try {
        return JSON.parse(completed);
      } catch {
        return null;
      }
    }
  }
  
  /**
   * Complete partial JSON by closing unclosed brackets/braces
   */
  private completePartialJSON(json: string): string {
    let completed = json.trim();
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;
    
    // Count unclosed brackets/braces
    for (let i = 0; i < completed.length; i++) {
      const char = completed[i];
      
      if (escaped) {
        escaped = false;
        continue;
      }
      
      if (char === '\\') {
        escaped = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
        if (char === '[') openBrackets++;
        if (char === ']') openBrackets--;
      }
    }
    
    // Close any unclosed strings
    if (inString) {
      completed += '"';
    }
    
    // Close unclosed brackets/braces
    while (openBrackets > 0) {
      completed += ']';
      openBrackets--;
    }
    
    while (openBraces > 0) {
      completed += '}';
      openBraces--;
    }
    
    return completed;
  }
  
  
  private async renderFileStart(
    action: ParsedAction,
    registry: FileRegistry
  ): Promise<void> {
    const { filePath, actionType } = action.data;
    
    if (!filePath) {
      console.error('[CommonRenderStrategy] file_start without filePath');
      return;
    }
    
    // ✅ Check for duplicates (multi-turn overwrites)
    if (registry.hasStreamed(filePath)) {
      const previousInfo = registry.getFileInfo(filePath);
      const previousActionType = previousInfo?.actionType;
      
      console.log(`[Render] ⚠️  File ${filePath} already streamed (previous: ${previousActionType}, new: ${actionType})`);
      
      // Determine if this is a full replacement or incremental change
      const isFullReplacement = 
        (previousActionType === 'create' || previousActionType === 'edit') &&
        (actionType === 'create' || !actionType);  // <file> tag = create/undefined
      
      const isIncrementalChange = 
        previousActionType === 'create' && 
        (actionType === 'edit' || actionType === 'append');
      
      if (isFullReplacement) {
        // ✅ Case 1: Full file replacement (Turn 1: <file>, Turn 2: <file>)
        console.log(`[Render] 🔄 Full overwrite - replacing entire file (multi-turn)`);
        
        // Reset everything
        registry.resetFile(filePath);
        
        if (this.bufferManager) {
          const isExisting = registry.isExisting(filePath);
          const finalActionType = isExisting ? 'edit' : 'create';
          this.bufferManager.resetFile(filePath, finalActionType);
        }
        
        this.activeFiles.delete(filePath);
        this.lineBuffers.delete(filePath);
        this.editOperations.delete(filePath);
        
        // Continue with fresh start
      } else if (isIncrementalChange) {
        // ✅ Case 2: Incremental change (Turn 1: <file>, Turn 2: <edit>/<append>)
        console.log(`[Render] ✏️  Incremental ${actionType} on top of previous content (multi-turn)`);
        
        // ❌ DON'T reset buffer! 
        // <edit> and <append> need the previous content from Turn 1
        // They will be handled separately in execute node (applyEdits/applyAppends)
        
        // Skip duplicate file_start (already initialized)
        return;
      } else {
        // ✅ Case 3: Same turn duplicate or invalid combination
        console.log(`[Render] ⏭️  Skipping duplicate file_start (same turn)`);
        return;
      }
    }
    
    // Determine final action type
    const isExisting = registry.isExisting(filePath);
    let finalActionType: 'create' | 'append' | 'edit' | 'delete';
    
    if (actionType === 'delete') {
      finalActionType = 'delete';
    } else if (actionType === 'append') {
      finalActionType = 'append';  // ✅ Keep append as-is
    } else if (actionType === 'edit') {
      finalActionType = 'edit';    // ✅ Keep edit as-is
    } else {
      // 'create' or undefined - determine from existence
      finalActionType = isExisting ? 'edit' : 'create';
    }
    
    // Register in registry
    registry.markAsStreamed(filePath, finalActionType);
    
    // Initialize active file tracking
    this.activeFiles.set(filePath, {
      filePath,
      actionType: finalActionType,
      startedAt: Date.now(),
      contentBuffer: ''
    });
    
    // ✅ Initialize line buffer for streaming
    this.lineBuffers.set(filePath, '');
    
    // ✅ Start disk buffer tracking for interruption safety
    if (this.bufferManager) {
      this.bufferManager.startFile(filePath, finalActionType);
    }
    
    // Send UI notification
    if (finalActionType === 'create' || finalActionType === 'append') {
      // ✅ CRITICAL: Start with 'creating' phase to initialize file card
      await this.chatAPI.startFileCreation(filePath);
    } else if (finalActionType === 'edit') {
      await this.chatAPI.startFileEdit(filePath);
      // Initialize edit operation tracking (for search/replace)
      this.editOperations.set(filePath, {
        filePath,
        searchContent: '',
        replaceContent: ''
      });
    } else if (finalActionType === 'delete') {
      await this.chatAPI.completeFileDeletion(filePath);
    }
  }
  
  private async renderFileContent(
    action: ParsedAction,
    registry: FileRegistry
  ): Promise<void> {
    const { filePath, content, metadata } = action.data;
    
    if (!filePath || content === undefined) {
      return;
    }
    
    const fileInfo = this.activeFiles.get(filePath);
    if (!fileInfo) {
      console.warn(`[Render] file_content for non-started file: ${filePath}`);
      return;
    }
    
    // Update registry buffer
    registry.appendContent(filePath, content);
    
    // Update local buffer
    fileInfo.contentBuffer += content;
    
    // ✅ Update disk buffer for interruption safety
    if (this.bufferManager) {
      this.bufferManager.appendContent(filePath, content);
    }
    
    // Handle edit operations (search/replace sections)
    if (fileInfo.actionType === 'edit' && metadata?.section) {
      const editOp = this.editOperations.get(filePath);
      if (editOp) {
        if (metadata.section === 'search') {
          editOp.searchContent += content;
        } else if (metadata.section === 'replace') {
          editOp.replaceContent += content;
        }
      }
      return;  // Don't stream search/replace sections incrementally
    }
    
    // ✅ Real-time streaming for create and append operations (LINE-BASED BUFFERING)
    if (fileInfo.actionType === 'create' || fileInfo.actionType === 'append') {
      const lineBuffer = this.lineBuffers.get(filePath) || '';
      const updatedBuffer = lineBuffer + content;
      
      // Split by newlines and emit complete lines
      const lines = updatedBuffer.split('\n');
      
      // Keep last incomplete line in buffer
      const incompleteLastLine = lines.pop() || '';
      this.lineBuffers.set(filePath, incompleteLastLine);
      
      // ✅ Incremental streaming: Send only new complete lines (network efficient)
      // ChatService now uses content_append event (delta-based)
      if (lines.length > 0) {
        const newContent = lines.join('\n') + '\n';  // ✅ Only new lines
        await this.chatAPI.streamFileContent(filePath, newContent);
      }
    }
  }
  
  private async renderFileEnd(
    action: ParsedAction,
    registry: FileRegistry
  ): Promise<void> {
    const { filePath } = action.data;
    
    if (!filePath) {
      console.error('[CommonRenderStrategy] file_end without filePath');
      return;
    }
    
    const fileInfo = this.activeFiles.get(filePath);
    if (!fileInfo) {
      console.warn(`[Render] file_end for non-started file: ${filePath}`);
      return;
    }
    
    console.log(`✅ [Render] Completing ${fileInfo.actionType.toUpperCase()}: ${filePath}`);
    
    try {
      // ✅ Flush any remaining incomplete line before completion
      const remainingBuffer = this.lineBuffers.get(filePath);
      if (remainingBuffer && (fileInfo.actionType === 'create' || fileInfo.actionType === 'append')) {
        await this.chatAPI.streamFileContent(filePath, remainingBuffer);
        this.lineBuffers.delete(filePath);
      }
      
      if (fileInfo.actionType === 'create' || fileInfo.actionType === 'append') {
        // ✅ Both create and append complete as file creation
        await this.chatAPI.completeFileCreation(filePath, fileInfo.contentBuffer);
      } else if (fileInfo.actionType === 'edit') {
        const editOp = this.editOperations.get(filePath);
        if (editOp) {
          // Complete the edit with search/replace
          await this.chatAPI.completeFileEdit(
            filePath,
            editOp.searchContent,
            editOp.replaceContent
          );
          this.editOperations.delete(filePath);
        } else {
          console.warn(`[Render] No edit operation found for: ${filePath}`);
        }
      }
      // delete action is already completed in file_start
    } catch (error) {
      console.error(`[Render] Error completing ${fileInfo.actionType} for ${filePath}:`, error);
    } finally {
      // Cleanup
      this.activeFiles.delete(filePath);
      this.editOperations.delete(filePath);
      this.lineBuffers.delete(filePath);  // ✅ Cleanup line buffer
      
      // ✅ CRITICAL: Mark as completed but DON'T cleanup buffer yet
      // Buffer cleanup happens in writeFiles node after successful disk write
      if (this.bufferManager) {
        this.bufferManager.completeFile(filePath, false);  // cleanup=false!
      }
    }
  }
  
  async finalize(hasToolCalls: boolean = false): Promise<void> {
    console.log('[CommonRenderStrategy] 🏁 Finalizing render strategy...');
    
    // ✅ Preserve buffers on finalization (in case of interruption)
    if (this.bufferManager) {
      this.bufferManager.preserveOnInterruption();
    }
    
    // Force complete any unfinished files
    for (const [filePath, fileInfo] of this.activeFiles) {
      console.warn(`⚠️  [Render] Force completing ${fileInfo.actionType}: ${filePath}`);
      
      try {
        if (fileInfo.actionType === 'create') {
          await this.chatAPI.completeFileCreation(filePath, fileInfo.contentBuffer);
        } else if (fileInfo.actionType === 'edit') {
          const editOp = this.editOperations.get(filePath);
          if (editOp) {
            await this.chatAPI.completeFileEdit(
              filePath,
              editOp.searchContent,
              editOp.replaceContent
            );
          }
        }
      } catch (error) {
        console.error(`[Render] Error finalizing ${filePath}:`, error);
      }
    }
    
    this.activeFiles.clear();
    this.editOperations.clear();
    
    // ✅ CRITICAL: Only finalize message if NO tool calls (keep message open for tool execution)
    // Tool calls need the same message context to update loading cards
    if (!hasToolCalls) {
      console.log('[CommonRenderStrategy] ✅ Finalizing message (no tool calls)');
      await this.chatAPI.finalizeMessage();
    } else {
      console.log('[CommonRenderStrategy] ⏸️  Keeping message open (tool calls pending)');
    }
  }
}

