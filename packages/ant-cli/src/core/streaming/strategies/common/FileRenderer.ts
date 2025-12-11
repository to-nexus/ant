/**
 * FileRenderer - Handle file operations (create, edit, append, delete)
 */

import { ChatAPIClient } from '../../../adapters/ChatAPIClient';
import { GitPort } from '../../../ports/git';
import { ParsedAction, FileStreamInfo } from '../../types';
import { FileRegistry } from '../../state/FileRegistry';
import { EditOperationManager, applySearchReplace } from './EditOperations';
import { LineBufferManager } from './LineBuffer';

export interface FileRendererConfig {
  chatAPI: ChatAPIClient;
  gitPort?: GitPort;
  writeImmediately: boolean;
  jobType?: 'code' | 'design';
  featurePath?: string;
}

export class FileRenderer {
  private chatAPI: ChatAPIClient;
  private gitPort?: GitPort;
  private writeImmediately: boolean;
  private jobType?: 'code' | 'design';
  private featurePath?: string;
  
  private activeFiles: Map<string, FileStreamInfo> = new Map();
  private editOps: EditOperationManager = new EditOperationManager();
  private lineBuffers: LineBufferManager = new LineBufferManager();
  
  // ✅ Track file operation completion
  
  // ✅ Track file operation errors (don't throw, collect for violation)
  private fileErrors: string[] = [];  private completionPromises: Map<string, Promise<void>> = new Map();
  private completionResolvers: Map<string, (value: void | PromiseLike<void>) => void> = new Map();
  private completionRejectors: Map<string, (reason?: any) => void> = new Map();
  
  constructor(config: FileRendererConfig) {
    this.chatAPI = config.chatAPI;
    this.gitPort = config.gitPort;
    this.writeImmediately = config.writeImmediately;
    this.jobType = config.jobType;
    this.featurePath = config.featurePath;
  }
  
  /**
   * Handle file_start action
   */
  async renderFileStart(action: ParsedAction, registry: FileRegistry): Promise<void> {
    const { filePath, actionType } = action.data;
    
    if (!filePath) {
      console.error('[FileRenderer] file_start without filePath');
      return;
    }
    
    // Check for duplicates
    if (registry.hasStreamed(filePath)) {
      const previousInfo = registry.getFileInfo(filePath);
      const previousActionType = previousInfo?.actionType;
      
      console.log(`[Render] ⚠️  File ${filePath} already streamed (previous: ${previousActionType}, new: ${actionType})`);
      
      const isFullReplacement = 
        (previousActionType === 'create' || previousActionType === 'edit') &&
        (actionType === 'create' || !actionType);
      
      const isIncrementalChange = 
        previousActionType === 'create' && 
        (actionType === 'edit' || actionType === 'append');
      
      if (isFullReplacement) {
        console.log(`[Render] 🔄 Full overwrite - replacing entire file (multi-turn)`);
        
        registry.resetFile(filePath);
        this.activeFiles.delete(filePath);
        this.lineBuffers.clear(filePath);
        this.editOps.deleteOperation(filePath);
      } else if (isIncrementalChange) {
        console.log(`[Render] ✏️  Incremental ${actionType} on top of previous content (multi-turn)`);
        return;
      } else {
        console.log(`[Render] ⏭️  Skipping duplicate file_start (same turn): ${previousActionType} → ${actionType}`);
        
        if (previousActionType === 'edit' && actionType === 'edit') {
          const errorMsg = `Duplicate ${actionType} for "${filePath}" in same response! ` +
            `Rule violation: You MUST edit each file ONLY ONCE per response (see 🚨 CRITICAL FILE MODIFICATION RULES). ` +
            `After first <edit>, the file content changed - second <edit> search block cannot match. ` +
            `Solution: Combine all changes for this file into ONE <edit> block with a comprehensive search/replace.`;

          console.error(`[Render] ❌ CRITICAL ERROR: Duplicate edit for ${filePath} in same turn!`);
          console.error(`   The LLM is trying to edit the same file twice.`);
          console.error(`   The second edit will fail because the file was already modified.`);
          console.error(`   This edit will be COMPLETELY SKIPPED to prevent cascading failures.`);

          // ✅ Add to fileErrors for self-healing
          this.fileErrors.push(errorMsg);
        }
        
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
    let finalActionType: 'create' | 'append' | 'edit';
    
    if (actionType === 'append') {
      finalActionType = 'append';
    } else if (actionType === 'edit') {
      // ✅ ONLY check file existence for edit operations
      const isExisting = await registry.isExisting(filePath);
      
      if (!isExisting) {
        const errorMsg = `Cannot edit non-existing file "${filePath}". You must create it first with <file> tag, or check if the path is correct.`;
        console.error(`❌ [FileRenderer] ${errorMsg}`);
        this.fileErrors.push(errorMsg);
        
        // ❌ Skip this file operation
        this.activeFiles.set(filePath, {
          filePath,
          actionType: 'skip' as any,
          contentBuffer: '',
          startedAt: Date.now()
        });
        return;
      }
      finalActionType = 'edit';
    } else {
      // <file> tag: No existence check needed (intentional overwrite)
      finalActionType = 'create';
    }
    registry.markAsStreamed(filePath, finalActionType);
    
    this.activeFiles.set(filePath, {
      filePath,
      actionType: finalActionType,
      startedAt: Date.now(),
      contentBuffer: ''
    });
    
    this.lineBuffers.init(filePath);
    
    // ✅ Create completion promise for this file
    const completionPromise = new Promise<void>((resolve, reject) => {
      this.completionResolvers.set(filePath, resolve);
      this.completionRejectors.set(filePath, reject);
    });
    this.completionPromises.set(filePath, completionPromise);
    
    if (finalActionType === 'create' || finalActionType === 'append') {
      await this.chatAPI.startFileCreation(filePath);
    } else if (finalActionType === 'edit') {
      await this.chatAPI.startFileEdit(filePath);
      this.editOps.initEdit(filePath);
    }
  }
  
  /**
   * Handle file_content action
   */
  async renderFileContent(action: ParsedAction, registry: FileRegistry): Promise<void> {
    const { filePath, content, metadata } = action.data;
    
    if (!filePath || content === undefined) {
      return;
    }
    
    const fileInfo = this.activeFiles.get(filePath);
    if (!fileInfo) {
      console.warn(`[Render] file_content for non-started file: ${filePath}`);
      return;
    }
    
    if (fileInfo.actionType === 'skip' as any) {
      return;
    }
    
    registry.appendContent(filePath, content);
    fileInfo.contentBuffer += content;
    
    // Handle edit operations (search/replace sections)
    if (fileInfo.actionType === 'edit' && metadata?.section) {
      if (metadata.section === 'search') {
        this.editOps.addSearchContent(filePath, content);
      } else if (metadata.section === 'replace') {
        this.editOps.addReplaceContent(filePath, content);
      }
      return;
    }
    
    // Real-time streaming for create and append
    if (fileInfo.actionType === 'create' || fileInfo.actionType === 'append') {
      const completeLines = this.lineBuffers.addContent(filePath, content);
      
      if (completeLines.length > 0) {
        const newContent = completeLines.join('\n') + '\n';
        await this.chatAPI.streamFileContent(filePath, newContent);
      }
    }
  }
  
  /**
   * Handle file_end action
   */
  async renderFileEnd(action: ParsedAction, registry: FileRegistry): Promise<void> {
    const { filePath } = action.data;
    
    if (!filePath) {
      console.error('[FileRenderer] file_end without filePath');
      return;
    }
    
    const fileInfo = this.activeFiles.get(filePath);
    if (!fileInfo) {
      console.warn(`[Render] file_end for non-started file: ${filePath}`);
      return;
    }
    
    if (fileInfo.actionType === 'skip' as any) {
      console.log(`[Render] ⏭️  Skipping file_end for duplicate edit: ${filePath}`);
      this.cleanup(filePath);
      return;
    }
    
    console.log(`✅ [Render] Completing ${fileInfo.actionType.toUpperCase()}: ${filePath}`);
    
    try {
      // Flush remaining buffer
      const remainingBuffer = this.lineBuffers.getRemainingBuffer(filePath);
      if (remainingBuffer && (fileInfo.actionType === 'create' || fileInfo.actionType === 'append')) {
        await this.chatAPI.streamFileContent(filePath, remainingBuffer);
      }
      
      if (fileInfo.actionType === 'create' || fileInfo.actionType === 'append') {
        await this.handleCreateOrAppend(filePath, fileInfo);
      } else if (fileInfo.actionType === 'edit') {
        await this.handleEdit(filePath);
      }
    } catch (error) {
      await this.handleError(filePath, fileInfo, error);
      
      // ✅ Do NOT reject completion promise - just log error
      // File errors should only be displayed in UI, not interrupt task flow
      
      this.cleanup(filePath);
      
      // ✅ Do NOT re-throw - task should continue despite file errors
      // Error is already recorded in fileErrors and displayed in UI
      return;
    }
    
    // ✅ Success: Resolve completion promise
    const resolver = this.completionResolvers.get(filePath);
    if (resolver) {
      resolver();
    }
    
    this.cleanup(filePath);
  }
  
  /**
   * Handle create or append operation
   */
  private async handleCreateOrAppend(filePath: string, fileInfo: FileStreamInfo): Promise<void> {
    if (this.writeImmediately && this.gitPort && fileInfo.contentBuffer) {
      const path = await import('path');
      let absolutePath = filePath;
      
      if (this.jobType === 'design' && this.featurePath && !path.isAbsolute(filePath)) {
        absolutePath = path.join(this.featurePath, filePath);
        console.log(`🔄 [Design] Resolved path: ${filePath} → ${absolutePath}`);
      }
      
      if (fileInfo.actionType === 'append' && this.jobType === 'design') {
        await this.handleDesignAppend(absolutePath, fileInfo.contentBuffer);
      } else {
        await this.gitPort.writeFile(absolutePath, fileInfo.contentBuffer);
        console.log(`✅ [${fileInfo.actionType === 'create' ? 'Create' : 'Append'}] Successfully wrote ${absolutePath} to disk`);
      }
    }
    
    await this.chatAPI.completeFileCreation(filePath, fileInfo.contentBuffer);
  }
  
  /**
   * Handle design job append with LAST_SECTION cleanup
   */
  private async handleDesignAppend(absolutePath: string, newContent: string): Promise<void> {
    if (!this.gitPort) return;
    
    try {
      const fileExists = await this.gitPort.fileExists(absolutePath);
      
      if (fileExists) {
        const existingContent = await this.gitPort.readFile(absolutePath) || '';
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
        
        const mergedContent = cleanedExistingContent + '\n' + newContent;
        await this.gitPort.writeFile(absolutePath, mergedContent);
        console.log(`✅ [Append] Successfully appended to ${absolutePath} (total: ${mergedContent.length} chars)`);
      } else {
        await this.gitPort.writeFile(absolutePath, newContent);
        console.log(`✅ [Append] Created new file ${absolutePath}`);
      }
    } catch (error) {
      console.error(`❌ [Append] Failed to append to ${absolutePath}:`, error);
      throw error;
    }
  }
  
  /**
   * Handle edit operation
   */
  private async handleEdit(filePath: string): Promise<void> {
    const editOp = this.editOps.getOperation(filePath);
    if (!editOp) {
      console.warn(`[Render] No edit operation found for: ${filePath}`);
      return;
    }
    
    if (!this.gitPort) {
      throw new Error('[Edit] GitPort not available - cannot apply edits to files');
    }
    
    console.log(`📝 [Edit] Applying search/replace to ${filePath}...`);
    
    const originalContent = await this.gitPort.readFile(filePath);
    if (!originalContent) {
      throw new Error(`[Edit] File not found: ${filePath}`);
    }
    
    const modifiedContent = applySearchReplace(
      originalContent,
      editOp.searchContent,
      editOp.replaceContent,
      filePath
    );
    
    await this.gitPort.writeFile(filePath, modifiedContent);
    console.log(`✅ [Edit] Successfully modified ${filePath}`);
    
    await this.chatAPI.completeFileEdit(
      filePath,
      editOp.searchContent,
      editOp.replaceContent
    );
  }
  
  /**
   * Handle errors during file operations
   */
  private async handleError(filePath: string, fileInfo: FileStreamInfo, error: unknown): Promise<void> {
    console.error(`[ERROR] [Render] Error completing ${fileInfo.actionType} for ${filePath}:`);
    
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    } else {
      console.error(`   Error:`, error);
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    await this.chatAPI.sendLLMEvent({
      type: 'error',
      error: { message: errorMessage }
    });
    
    if (errorMessage.includes('Search block not found')) {
      // ✅ Add to fileErrors for self-healing
      const selfHealingMsg = `File "${filePath}" edit failed: Search block not found. The file content has changed since you last saw it. You MUST use read_file("${filePath}") tool first to get the current content, then create a new <edit> with an EXACT matching search block from the current content.`;
      this.fileErrors.push(selfHealingMsg);
      
      console.error(`\n${'='.repeat(80)}`);
      console.error(`⚠️  CRITICAL: LLM attempted to edit ${filePath} with outdated code!`);
      console.error(`\n💡 REQUIRED ACTION FOR LLM:`);
      console.error(`   1. Use read_file tool to get the CURRENT file content`);
      console.error(`   2. Then create a NEW <edit> with EXACT matching search block`);
      console.error(`   3. DO NOT attempt to edit this file again without reading it first!`);
      console.error(`${'='.repeat(80)}\n`);
    }
  }
  
  /**
   * Cleanup resources for a file
   */
  private cleanup(filePath: string): void {
    this.activeFiles.delete(filePath);
    this.editOps.deleteOperation(filePath);
    this.lineBuffers.clear(filePath);
    this.completionPromises.delete(filePath);
    this.completionResolvers.delete(filePath);
    this.completionRejectors.delete(filePath);
  }
  
  /**
  /**
   * Wait for all file operations to complete
   * ✅ This must be called BEFORE marking task as completed
   * ✅ NEW: Immediately cleanup incomplete operations (missing closing tags)
   */
  async waitForAllFileOperations(): Promise<void> {
    // ✅ CRITICAL: First check for incomplete operations (activeFiles without closing tags)
    // This happens when LLM starts <edit> but never sends </edit> (e.g., outputs <tool_call> instead)
    if (this.activeFiles.size > 0) {
      console.warn(`⚠️  [FileRenderer] ${this.activeFiles.size} incomplete file operation(s) detected before waiting!`);
      
      for (const [filePath, fileInfo] of this.activeFiles) {
        console.error(`   - ${fileInfo.actionType}: ${filePath} (missing closing tag)`);
        
        // ✅ Create self-healing error for LLM feedback
        const errorMsg = `⚠️ File operation incomplete: <${fileInfo.actionType}> tag for "${filePath}" was never closed. ` +
          `This usually means the LLM output was interrupted or malformed. ` +
          `If you need to modify this file, use read_file("${filePath}") first, then use proper <edit> tags.`;
        
        this.fileErrors.push(errorMsg);
        
        // ✅ Reject the pending promise to unblock waitForAllFileOperations
        const rejector = this.completionRejectors.get(filePath);
        if (rejector) {
          rejector(new Error(`Incomplete operation: missing closing tag for ${filePath}`));
        }
        
        // Cleanup
        this.cleanup(filePath);
      }
    }
    
    const pendingOperations = Array.from(this.completionPromises.values());
    
    if (pendingOperations.length === 0) {
      console.log(`✅ [FileRenderer] No file operations pending, proceeding immediately`);
      return;
    }
    
    console.log(`⏳ [FileRenderer] Waiting for ${pendingOperations.length} file operation(s) to complete...`);
    
    try {
      await Promise.all(pendingOperations);
      console.log(`✅ [FileRenderer] All file operations completed`);
    } catch (error) {
      // ✅ File operation errors are non-blocking (recorded in fileErrors)
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`⚠️  [FileRenderer] File operation error (non-blocking): ${errorMsg}`);
      // Don't re-throw - errors are already in fileErrors for self-healing
    }
  }
  
  /**
   * Check if there are active file operations
   */
  hasActiveFiles(): boolean {
    return this.activeFiles.size > 0;
  }
  
  /**
   * Finalize all pending file operations
   * ⚠️ CRITICAL: Do NOT save incomplete files (missing closing tags)
   */
  async finalize(): Promise<void> {
    for (const [filePath, fileInfo] of this.activeFiles) {
      console.warn(`⚠️  [Render] Incomplete operation detected: ${fileInfo.actionType} on ${filePath}`);
      console.warn(`   Missing closing tag: </${fileInfo.actionType === 'create' ? 'file' : fileInfo.actionType}>`);
      console.warn(`   File will NOT be saved to prevent corruption.`);
      
      // ❌ Do NOT save incomplete files
      // ✅ But notify UI that operation was cancelled
      const completePhase = 'complete' as const;
      const completeType = fileInfo.actionType === 'create' ? 'file_create' :
                          fileInfo.actionType === 'edit' ? 'file_edit' :
                          fileInfo.actionType === 'delete' ? 'file_delete' : null;
      
      if (completeType) {
        await this.chatAPI.sendLLMEvent({
          type: completeType,
          metadata: { placeholder: true }
        } as any);  // ✅ Type cast for UI event without filePath field
      }
      
      // ✅ Reject completion promise for incomplete files (missing closing tag = error!)
      const rejector = this.completionRejectors.get(filePath);
      if (rejector) {
        rejector(new Error(`Incomplete operation - missing closing tag for ${filePath}`));
      }
    }
    
    this.activeFiles.clear();
    this.editOps.clear();
    this.lineBuffers.clearAll();
    this.completionPromises.clear();
  }
  
  /**
   * Get all file operation errors
   */
  getFileErrors(): string[] {
    return this.fileErrors;
  }
}
