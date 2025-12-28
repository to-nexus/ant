/**
 * FileRenderer - Handle file operations (create, append, delete)
 */

import * as path from 'path';
import { ChatAPIClient } from '../../../adapters/ChatAPIClient';
import { GitPort } from '../../../ports/git';
import { FileSystemPort } from '../../../ports/filesystem';
import { ParsedAction, FileStreamInfo } from '../../types';
import { FileRegistry } from '../../state/FileRegistry';
import { LineBufferManager } from './LineBuffer';

export interface FileRendererConfig {
  chatAPI: ChatAPIClient;
  gitPort?: GitPort;
  fileSystem?: FileSystemPort;  // ✅ Add fileSystem
  writeImmediately: boolean;
  jobType?: 'code' | 'design';
  featurePath?: string;
  codebasePath?: string; // ✅ For code jobs: absolute path to repo root (codebase dir)
}

export class FileRenderer {
  private chatAPI: ChatAPIClient;
  private gitPort?: GitPort;
  private fileSystem?: FileSystemPort;  // ✅ Add fileSystem property
  private writeImmediately: boolean;
  private jobType?: 'code' | 'design';
  private featurePath?: string;
  private codebasePath?: string;
  
  private activeFiles: Map<string, FileStreamInfo> = new Map();
  private lineBuffers: LineBufferManager = new LineBufferManager();
  
  // ✅ Track file operation completion
  
  // ✅ Track file operation errors (don't throw, collect for violation)
  private fileErrors: string[] = [];  
  private completionPromises: Map<string, Promise<void>> = new Map();
  private completionResolvers: Map<string, (value: void | PromiseLike<void>) => void> = new Map();
  private completionRejectors: Map<string, (reason?: any) => void> = new Map();
  
  constructor(config: FileRendererConfig) {
    this.chatAPI = config.chatAPI;
    this.gitPort = config.gitPort;
    this.fileSystem = config.fileSystem;  // ✅ Store fileSystem
    this.writeImmediately = config.writeImmediately;
    this.jobType = config.jobType;
    this.featurePath = config.featurePath;
    this.codebasePath = config.codebasePath;
  }
  
  /**
   * Resolve a path that is safe to pass to FileSystemPort.
   *
   * FileSystemPort expects paths relative to its workspace root.
   * In design jobs, LLM emits paths like `outputs/design/system-design.md` which
   * are relative to the feature directory, so we must prefix with the feature dir
   * *relative to workspace root* (NOT an absolute path).
   */
  private resolveFileSystemPath(originalPath: string): string {
    if (!this.fileSystem) return originalPath;

    // If caller accidentally passed an absolute path, normalize it back to workspace-relative.
    if (path.isAbsolute(originalPath)) {
      const workspaceRoot = this.fileSystem.getWorkspaceRoot?.();
      if (workspaceRoot) {
        return path.relative(workspaceRoot, originalPath);
      }
      return originalPath.startsWith('/') ? originalPath.slice(1) : originalPath;
    }

    if (this.jobType === 'design' && this.featurePath) {
      const workspaceRoot = this.fileSystem.getWorkspaceRoot?.();
      if (workspaceRoot && path.isAbsolute(this.featurePath)) {
        const featureDirRel = path.relative(workspaceRoot, this.featurePath);
        return path.join(featureDirRel, originalPath);
      }
    }

    // ✅ Code jobs must write into repoRoot (codebase directory), not project root.
    // LLM typically emits paths like "package.json" or "src/main.ts".
    // We transparently prefix with codebaseDirRel so files land in {project}/codebase/...
    if (this.jobType === 'code' && this.codebasePath) {
      const workspaceRoot = this.fileSystem.getWorkspaceRoot?.();
      if (workspaceRoot && path.isAbsolute(this.codebasePath)) {
        const codebaseDirRel = path.relative(workspaceRoot, this.codebasePath);

        // Avoid double-prefix if LLM already included "codebase/" or the computed relative prefix.
        if (
          originalPath === codebaseDirRel ||
          originalPath.startsWith(codebaseDirRel + path.sep) ||
          originalPath.startsWith('codebase' + path.sep)
        ) {
          return originalPath;
        }

        return path.join(codebaseDirRel, originalPath);
      }
    }

    return originalPath;
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
        previousActionType === 'create' &&
        (actionType === 'create' || !actionType);
      
      const isIncrementalChange = 
        previousActionType === 'create' && 
        actionType === 'append';
      
      if (isFullReplacement) {
        console.log(`[Render] 🔄 Full overwrite - replacing entire file (multi-turn)`);
        
        registry.resetFile(filePath);
        this.activeFiles.delete(filePath);
        this.lineBuffers.clear(filePath);
      } else if (isIncrementalChange) {
        console.log(`[Render] ✏️  Incremental ${actionType} on top of previous content (multi-turn)`);
        return;
      } else {
        console.log(`[Render] ⏭️  Skipping duplicate file_start (same turn): ${previousActionType} → ${actionType}`);
        
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
    let finalActionType: 'create' | 'append';
    
    if (actionType === 'append') {
      finalActionType = 'append';
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
    
    await this.chatAPI.startFileCreation(filePath);
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
    
    // Real-time streaming for create and append
    const completeLines = this.lineBuffers.addContent(filePath, content);
    
    if (completeLines.length > 0) {
      const newContent = completeLines.join('\n') + '\n';
      await this.chatAPI.streamFileContent(filePath, newContent);
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
      if (remainingBuffer) {
        await this.chatAPI.streamFileContent(filePath, remainingBuffer);
      }
      
      await this.handleCreateOrAppend(filePath, fileInfo);
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
      const fsPath = this.resolveFileSystemPath(filePath);

      if (fileInfo.actionType === 'append' && this.jobType === 'design') {
        await this.handleDesignAppend(fsPath, fileInfo.contentBuffer);
      } else {
        if (!this.fileSystem) throw new Error('FileSystemPort not available');
        await this.fileSystem.writeFile(fsPath, fileInfo.contentBuffer);
      }
    }
    
    await this.chatAPI.completeFileCreation(filePath, fileInfo.contentBuffer);
  }
  
  /**
   * Handle design job append with LAST_SECTION cleanup
   */
  private async handleDesignAppend(fileSystemPath: string, newContent: string): Promise<void> {
    if (!this.gitPort || !this.fileSystem) return;
    
    try {
      const fileExists = await this.fileSystem.fileExists(fileSystemPath);
      
      if (fileExists) {
        const existingContent = await this.fileSystem.readFile(fileSystemPath) || '';
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
        await this.fileSystem!.writeFile(fileSystemPath, mergedContent);
      } else {
        await this.fileSystem!.writeFile(fileSystemPath, newContent);
      }
    } catch (error) {
      console.error(`❌ [Append] Failed to append to ${fileSystemPath}:`, error);
      throw error;
    }
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
    
    // ✅ Send file operation failed status to UI (FileCard will display this)
    const failedType = fileInfo.actionType === 'create' ? 'file_create_failed' : 'file_delete_failed';
    
    await this.chatAPI.showChatStatus(failedType as any, {
      filePath,
      reason: errorMessage
    });
    
    // ❌ DO NOT send generic error event - it causes duplicate error display
    // FileCard already shows the error with red styling and error message
  }
  
  /**
   * Cleanup resources for a file
   */
  private cleanup(filePath: string): void {
    this.activeFiles.delete(filePath);
    this.lineBuffers.clear(filePath);
    this.completionPromises.delete(filePath);
    this.completionResolvers.delete(filePath);
    this.completionRejectors.delete(filePath);
  }
  
  /**
   * Wait for all file operations to complete
   * ✅ This must be called BEFORE marking task as completed
   * ✅ CRITICAL: Generate violations for incomplete operations (missing closing tags)
   */
  async waitForAllFileOperations(): Promise<void> {
    // ✅ CRITICAL: Check for incomplete operations (activeFiles without closing tags)
    // This happens when LLM starts <file> but never sends </file>
    // For feature tasks, this is the ONLY error detection mechanism (no validation phase)
    if (this.activeFiles.size > 0) {
      console.warn(`⚠️  [FileRenderer] ${this.activeFiles.size} incomplete file operation(s) detected!`);
      
      for (const [filePath, fileInfo] of this.activeFiles) {
        console.error(`   - ${fileInfo.actionType}: ${filePath} (missing closing tag)`);
        
        // ✅ Create violation for self-healing (REQUIRED for feature tasks)
        const errorMsg = `⚠️ File operation incomplete: <${fileInfo.actionType}> tag for "${filePath}" was never closed.\n` +
          `\n` +
          `CRITICAL: You MUST close ALL XML tags before outputting <done>!\n` +
          `\n` +
          `❌ WRONG:\n` +
          `<file path="App.tsx">\n` +
          `content...\n` +
          `<done>true</done>  ← Missing </file>!\n` +
          `\n` +
          `✅ CORRECT:\n` +
          `<file path="App.tsx">\n` +
          `content...\n` +
          `</file>  ← Close tag FIRST!\n` +
          `<done>true</done>  ← Then output done`;
        
        this.fileErrors.push(errorMsg);
        
        // ✅ Resolve promise to allow workflow to continue (violation will trigger retry)
        const resolver = this.completionResolvers.get(filePath);
        if (resolver) {
          resolver();
        }
        
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
                          fileInfo.actionType === 'delete' ? 'file_delete' : null;
      
      if (completeType) {
        await this.chatAPI.sendLLMEvent({
          type: completeType,
          metadata: { placeholder: true }
        } as any);  // ✅ Type cast for UI event without filePath field
      }
      
      // ✅ CRITICAL: Resolve (not reject!) completion promise for incomplete files
      // Missing closing tag is a violation (retryable), not a crash-worthy error
      // Error is already recorded in self-healing message above
      const resolver = this.completionResolvers.get(filePath);
      if (resolver) {
        resolver();  // ✅ Resolve to allow workflow to continue (violation will be handled)
      }
    }
    
    this.activeFiles.clear();
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
