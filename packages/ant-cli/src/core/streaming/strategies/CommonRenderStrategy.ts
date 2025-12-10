/**
 * Common rendering strategy that covers 99% of streaming use cases
 * 
 * Handles:
 * - thinking: LLM reasoning output
 * - response: General text response
 * - file_start: Begin file creation/editing
 * - file_content: Stream file content
 * - file_end: Complete file operation (including actual file edits)
 */

import { IRenderStrategy } from './IRenderStrategy';
import { ParsedAction, FileStreamInfo } from '../types';
import { FileRegistry } from '../state/FileRegistry';
import { ChatAPIClient } from '../../adapters/ChatAPIClient';
import { SpecialTagTransformer } from '../transformers/SpecialTagTransformer';
import { UserLanguage } from '../../utils/languageDetector';
import { GitPort } from '../../ports/git';

interface EditOperation {
  filePath: string;
  searchContent: string;
  replaceContent: string;
}

/**
 * ✅ Apply search/replace edit to file content
 * Returns modified content or throws error if search block not found
 */
function applySearchReplace(
  originalContent: string,
  searchContent: string,
  replaceContent: string,
  filePath: string
): string {
  // Exact match
  if (originalContent.includes(searchContent)) {
    const modifiedContent = originalContent.replace(searchContent, replaceContent);
    console.log(`✅ [Edit] Applied search/replace to ${filePath}`);
    console.log(`   Replaced ${searchContent.length} chars with ${replaceContent.length} chars`);
    return modifiedContent;
  }
  
  // If exact match fails, provide helpful error
  const searchLines = searchContent.split('\n');
  const contentLines = originalContent.split('\n');
  
  // Try to find similar lines for better error message
  const firstSearchLine = searchLines[0]?.trim();
  const matchingLineNumbers: number[] = [];
  
  contentLines.forEach((line, index) => {
    if (line.trim() === firstSearchLine) {
      matchingLineNumbers.push(index + 1);
    }
  });
  
  let errorMsg = `❌ [Edit] Search block not found in ${filePath}\n\n`;
  errorMsg += `🔍 Search block (${searchLines.length} lines, ${searchContent.length} chars):\n`;
  errorMsg += `────────────────────────────────────────\n`;
  errorMsg += searchContent.substring(0, 500);
  if (searchContent.length > 500) errorMsg += '\n... (truncated)';
  errorMsg += `\n────────────────────────────────────────\n\n`;
  
  if (matchingLineNumbers.length > 0) {
    errorMsg += `💡 Found similar first line at line(s): ${matchingLineNumbers.join(', ')}\n`;
    errorMsg += `   Possible causes:\n`;
    errorMsg += `   - Whitespace mismatch (spaces vs tabs)\n`;
    errorMsg += `   - Missing/extra lines in search block\n`;
    errorMsg += `   - File was already modified in previous edit\n`;
    errorMsg += `   - Search block contains outdated code\n\n`;
  } else {
    errorMsg += `💡 First line "${firstSearchLine}" not found in file\n`;
    errorMsg += `   The search block may be completely outdated or wrong\n\n`;
  }
  
  errorMsg += `📄 Current file content (first 1000 chars):\n`;
  errorMsg += `────────────────────────────────────────\n`;
  errorMsg += originalContent.substring(0, 1000);
  if (originalContent.length > 1000) errorMsg += '\n... (truncated)';
  errorMsg += `\n────────────────────────────────────────\n\n`;
  
  errorMsg += `⚠️  This error means the file content has changed since the LLM last saw it.\n`;
  errorMsg += `💡 Solution: LLM should read the file again before attempting to edit it.`;
  
  console.error(errorMsg);
  throw new Error(errorMsg);
}

export class CommonRenderStrategy implements IRenderStrategy {
  private chatAPI: ChatAPIClient;
  private activeFiles: Map<string, FileStreamInfo> = new Map();
  private editOperations: Map<string, EditOperation> = new Map();
  private lineBuffers: Map<string, string> = new Map();  // ✅ Line-based buffering for smooth streaming
  private gitPort?: GitPort;  // ✅ For reading/writing files during edit operations
  private writeImmediately: boolean;  // ✅ Whether to write files immediately or defer to writeFiles node
  private jobType?: 'code' | 'design';  // ✅ Job type for design-specific handling (LAST_SECTION)
  private featurePath?: string;  // ✅ For design job: absolute path base (to resolve outputs/design/...)
  
  // ✅ Thinking timing
  private thinkingStartTime?: number;
  
  // ✅ Special tag transformer for converting XML tags to user-friendly messages
  private tagTransformer: SpecialTagTransformer;
  
  constructor(
    chatAPI: ChatAPIClient,
    userLanguage?: UserLanguage,
    gitPort?: GitPort,
    writeImmediately: boolean = false,
    jobType?: 'code' | 'design',  // ✅ Job type for design-specific handling (LAST_SECTION)
    featurePath?: string  // ✅ For design job: feature base path
  ) {
    this.chatAPI = chatAPI;
    this.tagTransformer = new SpecialTagTransformer(userLanguage || 'en');
    this.gitPort = gitPort;
    this.writeImmediately = writeImmediately;
    this.jobType = jobType;
    this.featurePath = featurePath;
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
    
    // 🐛 DEBUG: Check if special tags are being transformed
    if (content.includes('<detect>')) {
      console.log(`🐛 [Render] DETECT TAG FOUND in chunk (${content.length} chars)`);
      console.log(`🐛 [Render] transformed.consumed: ${transformed.consumed}`);
      console.log(`🐛 [Render] transformed.text length: ${transformed.text?.length || 0}`);
    }
    
    if (content.includes('<references>')) {
      console.log(`🐛 [Render] REFERENCES TAG FOUND in chunk (${content.length} chars)`);
      console.log(`🐛 [Render] Content preview: ${content.substring(0, 200)}`);
      console.log(`🐛 [Render] transformed.consumed: ${transformed.consumed}`);
      console.log(`🐛 [Render] transformed.text: ${transformed.text?.substring(0, 200) || '(none)'}`);
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
    console.log(`[Render] 🔍 Duplicate check for ${filePath}: hasStreamed=${registry.hasStreamed(filePath)}, actionType=${actionType}`);
    
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
        
        this.activeFiles.delete(filePath);
        this.lineBuffers.delete(filePath);
        this.editOperations.delete(filePath);
        
        // Continue with fresh start
      } else if (isIncrementalChange) {
        // ✅ Case 2: Incremental change (Turn 1: <file>, Turn 2: <edit>/<append>)
        console.log(`[Render] ✏️  Incremental ${actionType} on top of previous content (multi-turn)`);
        // Skip duplicate file_start (already initialized)
        return;
      } else {
        // ✅ Case 3: Same turn duplicate or invalid combination
        // ⚠️ CRITICAL: All duplicates in same turn should be skipped
        console.log(`[Render] ⏭️  Skipping duplicate file_start (same turn): ${previousActionType} → ${actionType}`);
        
        // ⚠️ CRITICAL: For ANY duplicate, mark as "skip" to prevent renderFileEnd from processing
        // This is especially important for edit → edit, where the second edit will ALWAYS fail
        // because the first edit already changed the file
        if (previousActionType === 'edit' && actionType === 'edit') {
          console.error(`[Render] ❌ CRITICAL ERROR: Duplicate edit for ${filePath} in same turn!`);
          console.error(`   The LLM is trying to edit the same file twice.`);
          console.error(`   The second edit will fail because the file was already modified.`);
          console.error(`   This edit will be COMPLETELY SKIPPED to prevent cascading failures.`);
        }
        
        // Mark file as "skip" to prevent renderFileContent and renderFileEnd from processing
        this.activeFiles.set(filePath, {
          filePath: filePath,
          actionType: 'skip' as any,
          contentBuffer: '',
          startedAt: Date.now()
        });
        
        return;
      }
    }
    
    // Determine final action type
    const isExisting = registry.isExisting(filePath);
    
    // 🔍 DEBUG: Log file existence check
    console.log(`🔍 [Render] File existence check: ${filePath} → isExisting=${isExisting}`);
    
    let finalActionType: 'create' | 'append' | 'edit';
    
    if (actionType === 'append') {
      finalActionType = 'append';  // ✅ Keep append as-is
    } else if (actionType === 'edit') {
      finalActionType = 'edit';    // ✅ Keep edit as-is
    } else {
      // 'create' or undefined - check if file exists
      if (isExisting) {
        // 🚨 CRITICAL ERROR: LLM tried to create a file that already exists!
        const errorMsg = `❌ ERROR: Attempted to use <file> tag on EXISTING file: ${filePath}

This file ALREADY EXISTS in the codebase!
You MUST use <edit> tags to modify existing files, NOT <file> tags.

To fix this:
1. Use <edit path="${filePath}"> with <search> and <replace> blocks
2. Or use <append path="${filePath}"> to add content at the end

Using <file> on existing files will OVERWRITE the entire file, which is almost never what you want!`;
        
        console.error(errorMsg);
        
        // 🔴 Throw error to stop execution and force LLM to correct its mistake
        throw new Error(errorMsg);
      }
      
      // File doesn't exist - OK to create
      finalActionType = 'create';
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
    
    // ⚠️ CRITICAL: Skip if this file was marked as duplicate edit
    if (fileInfo.actionType === 'skip' as any) {
      return;  // Silently skip content accumulation
    }
    
    // Update registry buffer
    registry.appendContent(filePath, content);
    
    // Update local buffer
    fileInfo.contentBuffer += content;
    
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
    
    // ⚠️ CRITICAL: Skip if this file was marked as duplicate edit
    if (fileInfo.actionType === 'skip' as any) {
      console.log(`[Render] ⏭️  Skipping file_end for duplicate edit: ${filePath}`);
      this.activeFiles.delete(filePath);
      this.editOperations.delete(filePath);
      this.lineBuffers.delete(filePath);
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
        // ✅ CRITICAL: Write file to disk immediately (when writeImmediately=true)
        if (this.writeImmediately && this.gitPort && fileInfo.contentBuffer) {
          // ✅ Design job: Convert relative path to absolute path
          const path = await import('path');
          let absolutePath = filePath;
          if (this.jobType === 'design' && this.featurePath && !path.isAbsolute(filePath)) {
            absolutePath = path.join(this.featurePath, filePath);
            console.log(`🔄 [Design] Resolved path: ${filePath} → ${absolutePath}`);
          }
          
          // ✅ Design job only: Remove LAST_SECTION metadata before append
          if (fileInfo.actionType === 'append' && this.jobType === 'design') {
            try {
              const fileExists = await this.gitPort.fileExists(absolutePath);
              if (fileExists) {
                const existingContent = await this.gitPort.readFile(absolutePath) || '';
                
                // Find and remove LAST_SECTION comment (last non-empty line)
                const lines = existingContent.split('\n');
                let lastLineIndex = lines.length - 1;
                while (lastLineIndex >= 0 && lines[lastLineIndex].trim() === '') {
                  lastLineIndex--;
                }
                
                let cleanedExistingContent = existingContent;
                if (lastLineIndex >= 0) {
                  const lastLine = lines[lastLineIndex].trim();
                  if (lastLine.match(/^<!-- LAST_SECTION: \d+ -->$/)) {
                    lines.splice(lastLineIndex, 1);
                    cleanedExistingContent = lines.join('\n');
                    console.log(`   🧹 Removed LAST_SECTION metadata from line ${lastLineIndex + 1}`);
                  }
                }
                
                // Merge: cleaned existing + new content
                const mergedContent = cleanedExistingContent + '\n' + fileInfo.contentBuffer;
                await this.gitPort.writeFile(absolutePath, mergedContent);
                console.log(`✅ [Append] Successfully appended to ${absolutePath} (total: ${mergedContent.length} chars)`);
              } else {
                // File doesn't exist - create new
                await this.gitPort.writeFile(absolutePath, fileInfo.contentBuffer);
                console.log(`✅ [Append] Created new file ${absolutePath}`);
              }
            } catch (error) {
              console.error(`❌ [Append] Failed to append to ${absolutePath}:`, error);
              throw error;
            }
          } else {
            // Create or non-design append - simple write
            await this.gitPort.writeFile(absolutePath, fileInfo.contentBuffer);
            console.log(`✅ [${fileInfo.actionType === 'create' ? 'Create' : 'Append'}] Successfully wrote ${absolutePath} to disk`);
          }
        }
        // ✅ Both create and append complete as file creation
        await this.chatAPI.completeFileCreation(filePath, fileInfo.contentBuffer);
      } else if (fileInfo.actionType === 'edit') {
        const editOp = this.editOperations.get(filePath);
        if (editOp) {
          // ✅ CRITICAL: Actually apply the edit to the file!
          if (!this.gitPort) {
            throw new Error('[Edit] GitPort not available - cannot apply edits to files');
          }
          
          console.log(`📝 [Edit] Applying search/replace to ${filePath}...`);
          
          // 1. Read original file
          const originalContent = await this.gitPort.readFile(filePath);
          if (!originalContent) {
            throw new Error(`[Edit] File not found: ${filePath}`);
          }
          
          // 2. Apply search/replace
          const modifiedContent = applySearchReplace(
            originalContent,
            editOp.searchContent,
            editOp.replaceContent,
            filePath
          );
          
          // 3. Write modified file back to disk
          await this.gitPort.writeFile(filePath, modifiedContent);
          console.log(`✅ [Edit] Successfully modified ${filePath}`);
          
          // 4. UI notification (show diff)
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
      console.error(`[ERROR] [Render] Error completing ${fileInfo.actionType} for ${filePath}:`);
      if (error instanceof Error) {
        console.error(`   Message: ${error.message}`);
        console.error(`   Stack: ${error.stack}`);
      } else {
        console.error(`   Error:`, error);
      }
      
      // ⚠️ CRITICAL: Show error in UI AND provide actionable feedback to LLM
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Send to UI
      await this.chatAPI.sendLLMEvent({
        type: 'error',
        error: { message: errorMessage }
      });
      
      // ⚠️ CRITICAL: If this is a "search block not found" error, 
      // the LLM MUST read the file again before attempting another edit
      if (errorMessage.includes('Search block not found')) {
        console.error(`\n${'='.repeat(80)}`);
        console.error(`⚠️  CRITICAL: LLM attempted to edit ${filePath} with outdated code!`);
        console.error(`\n💡 REQUIRED ACTION FOR LLM:`);
        console.error(`   1. Use read_file tool to get the CURRENT file content`);
        console.error(`   2. Then create a NEW <edit> with EXACT matching search block`);
        console.error(`   3. DO NOT attempt to edit this file again without reading it first!`);
        console.error(`${'='.repeat(80)}\n`);
      }
    } finally {
      // Cleanup
      this.activeFiles.delete(filePath);
      this.editOperations.delete(filePath);
      this.lineBuffers.delete(filePath);  // ✅ Cleanup line buffer
    }
  }
  
  async finalize(hasToolCalls: boolean = false): Promise<void> {
    console.log('[CommonRenderStrategy] 🏁 Finalizing render strategy...');
    
    // Force complete any unfinished files
    for (const [filePath, fileInfo] of this.activeFiles) {
      console.warn(`⚠️  [Render] Force completing ${fileInfo.actionType}: ${filePath}`);
      
      try {
        if (fileInfo.actionType === 'create' || fileInfo.actionType === 'append') {
          // ✅ CRITICAL: Write file to disk immediately (when writeImmediately=true)
          if (this.writeImmediately && this.gitPort && fileInfo.contentBuffer) {
            // ✅ Design job: Convert relative path to absolute path
            const path = await import('path');
            let absolutePath = filePath;
            if (this.jobType === 'design' && this.featurePath && !path.isAbsolute(filePath)) {
              absolutePath = path.join(this.featurePath, filePath);
              console.log(`🔄 [Finalize/Design] Resolved path: ${filePath} → ${absolutePath}`);
            }
            
            // ✅ Design job only: Remove LAST_SECTION metadata before append
            if (fileInfo.actionType === 'append' && this.jobType === 'design') {
              try {
                const fileExists = await this.gitPort.fileExists(absolutePath);
                if (fileExists) {
                  const existingContent = await this.gitPort.readFile(absolutePath) || '';
                  
                  // Find and remove LAST_SECTION comment (last non-empty line)
                  const lines = existingContent.split('\n');
                  let lastLineIndex = lines.length - 1;
                  while (lastLineIndex >= 0 && lines[lastLineIndex].trim() === '') {
                    lastLineIndex--;
                  }
                  
                  let cleanedExistingContent = existingContent;
                  if (lastLineIndex >= 0) {
                    const lastLine = lines[lastLineIndex].trim();
                    if (lastLine.match(/^<!-- LAST_SECTION: \d+ -->$/)) {
                      lines.splice(lastLineIndex, 1);
                      cleanedExistingContent = lines.join('\n');
                      console.log(`   🧹 [Finalize] Removed LAST_SECTION metadata from line ${lastLineIndex + 1}`);
                    }
                  }
                  
                  // Merge: cleaned existing + new content
                  const mergedContent = cleanedExistingContent + '\n' + fileInfo.contentBuffer;
                  await this.gitPort.writeFile(absolutePath, mergedContent);
                  console.log(`✅ [Finalize/Append] Successfully appended to ${absolutePath}`);
                } else {
                  // File doesn't exist - create new
                  await this.gitPort.writeFile(absolutePath, fileInfo.contentBuffer);
                  console.log(`✅ [Finalize/Append] Created new file ${absolutePath}`);
                }
              } catch (error) {
                console.error(`❌ [Finalize/Append] Failed to append to ${absolutePath}:`, error);
              }
            } else {
              // Create or non-design append - simple write
              await this.gitPort.writeFile(absolutePath, fileInfo.contentBuffer);
              console.log(`✅ [Finalize/${fileInfo.actionType === 'create' ? 'Create' : 'Append'}] Successfully wrote ${absolutePath} to disk`);
            }
          }
          await this.chatAPI.completeFileCreation(filePath, fileInfo.contentBuffer);
        } else if (fileInfo.actionType === 'edit') {
          const editOp = this.editOperations.get(filePath);
          if (editOp && this.gitPort) {
            // ✅ CRITICAL: Actually apply the edit!
            try {
              // ✅ Design job: Convert relative path to absolute path
              const path = await import('path');
              let absolutePath = filePath;
              if (this.jobType === 'design' && this.featurePath && !path.isAbsolute(filePath)) {
                absolutePath = path.join(this.featurePath, filePath);
              }
              
              const originalContent = await this.gitPort.readFile(absolutePath);
              if (originalContent) {
                const modifiedContent = applySearchReplace(
                  originalContent,
                  editOp.searchContent,
                  editOp.replaceContent,
                  filePath
                );
                await this.gitPort.writeFile(absolutePath, modifiedContent);
              }
            } catch (editError) {
              console.error(`[Edit] Failed to apply edit to ${filePath}:`, editError);
            }
            
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

