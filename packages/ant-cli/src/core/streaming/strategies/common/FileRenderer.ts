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
    
    console.log(`[Render] 🔍 Duplicate check for ${filePath}: hasStreamed=${registry.hasStreamed(filePath)}, actionType=${actionType}`);
    
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
          console.error(`[Render] ❌ CRITICAL ERROR: Duplicate edit for ${filePath} in same turn!`);
          console.error(`   The LLM is trying to edit the same file twice.`);
          console.error(`   The second edit will fail because the file was already modified.`);
          console.error(`   This edit will be COMPLETELY SKIPPED to prevent cascading failures.`);
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
    const isExisting = registry.isExisting(filePath);
    console.log(`🔍 [Render] File existence check: ${filePath} → isExisting=${isExisting}`);
    
    let finalActionType: 'create' | 'append' | 'edit';
    
    if (actionType === 'append') {
      finalActionType = 'append';
    } else if (actionType === 'edit') {
      finalActionType = 'edit';
    } else {
      if (isExisting) {
        const errorMsg = `❌ ERROR: Attempted to use <file> tag on EXISTING file: ${filePath}

This file ALREADY EXISTS in the codebase!
You MUST use <edit> tags to modify existing files, NOT <file> tags.

To fix this:
1. Use <edit path="${filePath}"> with <search> and <replace> blocks
2. Or use <append path="${filePath}"> to add content at the end

Using <file> on existing files will OVERWRITE the entire file, which is almost never what you want!`;
        
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      
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
    } finally {
      this.cleanup(filePath);
    }
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
      // Only cleanup resources
    }
    
    this.activeFiles.clear();
    this.editOps.clear();
    this.lineBuffers.clearAll();
  }
}

