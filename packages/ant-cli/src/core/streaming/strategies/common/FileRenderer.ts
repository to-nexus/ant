/**
 * FileRenderer - Handle file operations (create, append, delete)
 */

import * as path from 'path';
import { ChatAPIClient } from '../../../adapters/ChatAPIClient';
import { GitPort } from '../../../ports/git';
import { FileSystemPort } from '../../../ports/filesystem';
import { FileTreeUpdatePort } from '../../../ports/fileTree';
import { ParsedAction, FileStreamInfo } from '../../types';
import { FileRegistry } from '../../state/FileRegistry';
import { LineBufferManager } from './LineBuffer';
import { normalizeToCodebasePath } from '../../../utils/pathNormalizer';

/**
 * Structured data for cross-worker file conflicts.
 * Contains both contents so codeGen can inject a merge instruction
 * into the conversation without requiring read_file tool calls.
 */
export interface FileConflict {
  /** Normalized file path */
  path: string;
  /** Content the current worker intended to write */
  intendedContent: string;
  /** Content currently in the file (written by another worker) */
  currentContent: string;
  /** Task name of the file owner */
  ownerTask?: string;
}

export interface FileRendererConfig {
  chatAPI: ChatAPIClient;
  gitPort?: GitPort;
  fileSystem?: FileSystemPort;  // ✅ Add fileSystem
  fileTreeUpdate?: FileTreeUpdatePort;  // ✅ For real-time file tree updates
  writeImmediately: boolean;
  jobType?: 'code' | 'design';
  featurePath?: string;
  codebasePath?: string; // ✅ For code jobs: absolute path to repo root (codebase dir)
}

export class FileRenderer {
  private chatAPI: ChatAPIClient;
  private gitPort?: GitPort;
  private fileSystem?: FileSystemPort;  // ✅ Add fileSystem property
  private fileTreeUpdate?: FileTreeUpdatePort;  // ✅ For real-time file tree updates
  private writeImmediately: boolean;
  private jobType?: 'code' | 'design';
  private featurePath?: string;
  private codebasePath?: string;
  
  private activeFiles: Map<string, FileStreamInfo> = new Map();
  private lineBuffers: LineBufferManager = new LineBufferManager();
  
  // ✅ Debounced file tree notification (prevents excessive Redis Pub/Sub during streaming)
  private fileTreeNotifyTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FILE_TREE_NOTIFY_DEBOUNCE_MS = 2000;
  
  // ✅ Track unseen artifact paths for badge notifications
  private pendingUnseenPaths: Set<string> = new Set();
  
  // ✅ Track file operation completion
  
  // ✅ Track file operation errors (don't throw, collect for violation)
  private fileErrors: string[] = [];
  // ✅ Cross-worker conflicts with structured data for direct merge
  private fileConflicts: FileConflict[] = [];  
  private completionPromises: Map<string, Promise<void>> = new Map();
  private completionResolvers: Map<string, (value: void | PromiseLike<void>) => void> = new Map();
  private completionRejectors: Map<string, (reason?: any) => void> = new Map();
  
  constructor(config: FileRendererConfig) {
    this.chatAPI = config.chatAPI;
    this.gitPort = config.gitPort;
    this.fileSystem = config.fileSystem;  // ✅ Store fileSystem
    this.fileTreeUpdate = config.fileTreeUpdate;  // ✅ Store fileTreeUpdate
    this.writeImmediately = config.writeImmediately;
    this.jobType = config.jobType;
    this.featurePath = config.featurePath;
    this.codebasePath = config.codebasePath;
  }
  
  /**
   * Resolve a path that is safe to pass to FileSystemPort.
   *
   * ✅ PROJECT ROOT based - all paths are relative to project root.
   * - Code files: LLM should use "codebase/..." paths
   * - Design files: LLM should use "features/<feature>/outputs/..." paths
   */
  private resolveFileSystemPath(originalPath: string): string {
    if (!this.fileSystem) return originalPath;

    // If caller accidentally passed an absolute path, normalize it back to project-root-relative.
    if (path.isAbsolute(originalPath)) {
      const rootPath = this.fileSystem.getRootPath?.();
      if (rootPath) {
        return path.relative(rootPath, originalPath);
      }
      return originalPath.startsWith('/') ? originalPath.slice(1) : originalPath;
    }

    // Design jobs: prefix with feature directory relative path
    if (this.jobType === 'design' && this.featurePath) {
      const rootPath = this.fileSystem.getRootPath?.();
      if (rootPath && path.isAbsolute(this.featurePath)) {
        const featureDirRel = path.relative(rootPath, this.featurePath);
        return path.join(featureDirRel, originalPath);
      }
    }

    // Code jobs: normalize path via the single source of truth (normalizeToCodebasePath).
    // This ensures consistency with tool handlers (resolveToolPath) — both read and write
    // paths agree. Handles all cases: bare paths, double-nesting, sibling dirs, etc.
    if (this.jobType === 'code' && this.codebasePath) {
      const rootPath = this.fileSystem.getRootPath?.();
      if (rootPath) {
        const codebaseRel = path.relative(rootPath, this.codebasePath).replace(/\\/g, '/') || 'codebase';
        const { normalized, wasFixed, reason } = normalizeToCodebasePath(originalPath, codebaseRel);
        if (wasFixed) {
          console.warn(`⚠️ [FileRenderer] Path auto-corrected: "${originalPath}" → "${normalized}" (${reason})`);
        }
        return normalized;
      }
    }

    return originalPath;
  }

  /**
   * Canonicalize a streamed file path into a stable key.
   *
   * ✅ PROJECT ROOT based - paths are used as-is (just normalize separators).
   * LLM should use consistent paths:
   * - "codebase/package.json" for code files
   * - "features/<feature>/outputs/..." for design files
   */
  private canonicalizePath(originalPath: string): string {
    return originalPath.replace(/\\/g, '/').replace(/^\.?\//, '');
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

    const canonicalPath = this.canonicalizePath(filePath);
    if (!canonicalPath) {
      const msg = `[FileRenderer] Invalid/empty canonical path derived from: "${filePath}"`;
      console.error(msg);
      this.fileErrors.push(msg);
      return;
    }
    
    // Check for duplicates
    if (registry.hasStreamed(canonicalPath)) {
      const previousInfo = registry.getFileInfo(canonicalPath);
      const previousActionType = previousInfo?.actionType;
      
      console.log(`[Render] ⚠️  File ${canonicalPath} already streamed (previous: ${previousActionType}, new: ${actionType})`);
      
      const isFullReplacement = 
        previousActionType === 'create' &&
        (actionType === 'create' || !actionType);
      
      const isIncrementalChange = 
        previousActionType === 'create' && 
        actionType === 'append';
      
      if (isFullReplacement) {
        console.log(`[Render] 🔄 Full overwrite - replacing entire file (multi-turn)`);
        
        registry.resetFile(canonicalPath);
        this.activeFiles.delete(canonicalPath);
        this.lineBuffers.clear(canonicalPath);
      } else if (isIncrementalChange) {
        console.log(`[Render] ✏️  Incremental ${actionType} on top of previous content (multi-turn)`);
        return;
      } else {
        console.log(`[Render] ⏭️  Skipping duplicate file_start (same turn): ${previousActionType} → ${actionType}`);
        
        this.activeFiles.set(canonicalPath, {
          filePath: canonicalPath,
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
    registry.markAsStreamed(canonicalPath, finalActionType);
    
    // ✅ Determine isOverwrite: was this file known at codeGen start?
    // If yes, this is a legitimate overwrite (existing file in codebase).
    // If no, this is a new file creation — subject to cross-worker conflict check.
    const isOverwrite = registry.isKnownAtStart(canonicalPath);
    
    this.activeFiles.set(canonicalPath, {
      filePath: canonicalPath,
      actionType: finalActionType,
      startedAt: Date.now(),
      contentBuffer: '',
      isOverwrite,
    } as any);
    
    this.lineBuffers.init(canonicalPath);
    
    // ✅ Create completion promise for this file
    const completionPromise = new Promise<void>((resolve, reject) => {
      this.completionResolvers.set(canonicalPath, resolve);
      this.completionRejectors.set(canonicalPath, reject);
    });
    this.completionPromises.set(canonicalPath, completionPromise);
    
    await this.chatAPI.startFileCreation(canonicalPath);
  }
  
  /**
   * Handle file_content action
   */
  async renderFileContent(action: ParsedAction, registry: FileRegistry): Promise<void> {
    const { filePath, content, metadata } = action.data;
    
    if (!filePath || content === undefined) {
      return;
    }

    const canonicalPath = this.canonicalizePath(filePath);
    if (!canonicalPath) return;
    
    const fileInfo = this.activeFiles.get(canonicalPath);
    if (!fileInfo) {
      console.warn(`[Render] file_content for non-started file: ${canonicalPath}`);
      return;
    }
    
    if (fileInfo.actionType === 'skip' as any) {
      return;
    }
    
    registry.appendContent(canonicalPath, content);
    fileInfo.contentBuffer += content;
    
    // Real-time streaming for create and append
    const completeLines = this.lineBuffers.addContent(canonicalPath, content);
    
    if (completeLines.length > 0) {
      const newContent = completeLines.join('\n') + '\n';
      await this.chatAPI.streamFileContent(canonicalPath, newContent);
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

    const canonicalPath = this.canonicalizePath(filePath);
    if (!canonicalPath) {
      const msg = `[FileRenderer] Invalid/empty canonical path derived from: "${filePath}"`;
      console.error(msg);
      this.fileErrors.push(msg);
      return;
    }
    
    const fileInfo = this.activeFiles.get(canonicalPath);
    if (!fileInfo) {
      console.warn(`[Render] file_end for non-started file: ${canonicalPath}`);
      return;
    }
    
    if (fileInfo.actionType === 'skip' as any) {
      console.log(`[Render] ⏭️  Skipping file_end for duplicate edit: ${canonicalPath}`);
      this.cleanup(canonicalPath);
      return;
    }
    
    console.log(`✅ [Render] Completing ${fileInfo.actionType.toUpperCase()}: ${canonicalPath}`);
    
    try {
      // Flush remaining buffer
      const remainingBuffer = this.lineBuffers.getRemainingBuffer(canonicalPath);
      if (remainingBuffer) {
        await this.chatAPI.streamFileContent(canonicalPath, remainingBuffer);
      }
      
      await this.handleCreateOrAppend(canonicalPath, fileInfo);
    } catch (error) {
      await this.handleError(canonicalPath, fileInfo, error);
      
      // ✅ Do NOT reject completion promise - just log error
      // File errors should only be displayed in UI, not interrupt task flow
      
      this.cleanup(canonicalPath);
      
      // ✅ Do NOT re-throw - task should continue despite file errors
      // Error is already recorded in fileErrors and displayed in UI
      return;
    }
    
    // ✅ Success: Resolve completion promise
    const resolver = this.completionResolvers.get(canonicalPath);
    if (resolver) {
      resolver();
    }
    
    this.cleanup(canonicalPath);
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
        
        // ✅ Cross-worker conflict detection for file creation and overwrite
        const isOverwrite = (fileInfo as any).isOverwrite === true;
        if (isOverwrite) {
          // Pre-existing file overwrite — check if another worker modified it
          const workerFS = this.fileSystem as any;
          if (typeof workerFS.writeOverwrite === 'function') {
            const result = await workerFS.writeOverwrite(fsPath, fileInfo.contentBuffer);
            if (!result.success) {
              if (result.currentContent !== undefined) {
                console.log(`⚠️ [FileRenderer] Overwrite conflict (direct merge path): ${filePath}`);
                this.fileConflicts.push({
                  path: filePath,
                  intendedContent: fileInfo.contentBuffer,
                  currentContent: result.currentContent,
                  ownerTask: result.ownerTask,
                });
              } else {
                console.log(`⚠️ [FileRenderer] Overwrite conflict (fallback): ${result.error}`);
                this.fileErrors.push(result.error || `File "${filePath}" was modified by another task.`);
              }
              await this.chatAPI.showChatStatus('file_conflict' as any, {
                filePath,
                ownerTask: result.ownerTask,
              });
              await this.chatAPI.failFileCreation(filePath, result.error || 'Cross-worker overwrite conflict');
              return;
            }
          } else {
            // Non-parallel mode: direct write
            await this.fileSystem.writeFile(fsPath, fileInfo.contentBuffer);
          }
        } else {
          // New file creation — use writeNewFile for cross-worker ownership check
          const workerFS = this.fileSystem as any;
          if (typeof workerFS.writeNewFile === 'function') {
            const result = await workerFS.writeNewFile(fsPath, fileInfo.contentBuffer);
            if (!result.success) {
              if (result.currentContent !== undefined) {
                // Cross-worker conflict with content available — store for direct merge
                console.log(`⚠️ [FileRenderer] Cross-worker conflict (direct merge path): ${filePath}`);
                this.fileConflicts.push({
                  path: filePath,
                  intendedContent: fileInfo.contentBuffer,
                  currentContent: result.currentContent,
                  ownerTask: result.ownerTask,
                });
              } else {
                // Conflict without content (shouldn't happen, but fallback to fileErrors)
                console.log(`⚠️ [FileRenderer] Cross-worker conflict (fallback): ${result.error}`);
                this.fileErrors.push(result.error || `File "${filePath}" was already created by another task.`);
              }
              await this.chatAPI.showChatStatus('file_conflict' as any, {
                filePath,
                ownerTask: result.ownerTask,
              });
              await this.chatAPI.failFileCreation(filePath, result.error || 'Cross-worker file conflict');
              return;
            }
          } else {
            // Non-parallel mode: direct write
            await this.fileSystem.writeFile(fsPath, fileInfo.contentBuffer);
          }
        }
      }
      
      // ✅ Schedule debounced file tree notification after disk write
      this.scheduleFileTreeNotification();
      
      // ✅ Track output files as unseen artifacts for badge notification
      if (filePath.startsWith('outputs/')) {
        this.pendingUnseenPaths.add(filePath);
      }
    }
    
    await this.chatAPI.completeFileCreation(filePath, fileInfo.contentBuffer);
  }
  
  /**
   * Handle design job append with structured merge for JSON
   * 
   * All UI documents are now JSON format:
   * - ui-tokens.json, ui-assets.json, ui-spec.json
   * - Deep merge objects, update _meta.lastSection
   */
  private async handleDesignAppend(fileSystemPath: string, newContent: string): Promise<void> {
    if (!this.gitPort || !this.fileSystem) return;
    
    try {
      const fileExists = await this.fileSystem.fileExists(fileSystemPath);
      const isJsonFile = fileSystemPath.endsWith('.json');
      
      if (fileExists) {
        const existingContent = await this.fileSystem.readFile(fileSystemPath) || '';
        
        // ✅ JSON files: Deep merge objects
        if (isJsonFile) {
          const mergedContent = this.mergeJsonContent(existingContent, newContent);
          await this.fileSystem!.writeFile(fileSystemPath, mergedContent);
          return;
        }
        
        // ⚠️ Non-JSON files (Markdown): Text append with metadata cleanup
        console.log(`   📄 [Append] Markdown file: ${fileSystemPath}`);
        
        // ✅ Remove old LAST_SECTION metadata before append
        // Pattern: <!-- LAST_SECTION: N --> at end of file (with optional whitespace)
        const cleanedExisting = existingContent
          .replace(/\n?<!-- LAST_SECTION: \d+ -->\s*$/g, '')
          .replace(/\n?<!-- SECTION_PATTERN: [^>]+ -->\s*\n?<!-- LAST_SECTION: \d+ -->\s*$/g, '');
        
        const mergedContent = cleanedExisting.trimEnd() + '\n\n' + newContent;
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
   * Deep merge JSON objects
   * - Merges top-level keys from newContent into existingContent
   * - Updates _meta.lastSection with the new value
   */
  private mergeJsonContent(existingContent: string, newContent: string): string {
    try {
      const existingObj = JSON.parse(existingContent);
      const newObj = JSON.parse(newContent);
      
      // Deep merge: new values override existing at leaf level
      const merged = this.deepMerge(existingObj, newObj);
      
      console.log(`   🔄 [JSON Merge] Merged ${Object.keys(newObj).length} top-level key(s)`);
      
      return JSON.stringify(merged, null, 2);
    } catch (error) {
      // If parsing fails, try to salvage by text append (shouldn't happen with valid JSON)
      console.warn(`   ⚠️ [JSON Merge] Parse error, falling back to text append:`, error);
      return existingContent + '\n' + newContent;
    }
  }
  
  /**
   * Convert array with id fields to object keyed by id
   * e.g., [{ id: 'gnb', ... }, { id: 'hero', ... }] → { gnb: {...}, hero: {...} }
   */
  private arrayToObject(arr: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const item of arr) {
      if (item && typeof item === 'object' && 'id' in item) {
        const { id, ...rest } = item;
        result[id] = rest;
      }
    }
    return result;
  }
  
  /**
   * Deep merge two objects
   * - Objects are recursively merged
   * - Arrays are concatenated (for sections arrays)
   * - Handles array-object mismatch for 'sections' key by converting array to object
   * - Primitives from source override target
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
      let sourceVal = source[key];
      let targetVal = target[key];
      
      // Special handling for 'sections' key: normalize array to object
      if (key === 'sections') {
        // Convert source array to object if target is object
        if (Array.isArray(sourceVal) && targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
          console.log(`   ⚠️ [YAML Merge] Converting 'sections' from array to object for merge compatibility`);
          sourceVal = this.arrayToObject(sourceVal);
        }
        // Convert target array to object if source is object
        if (Array.isArray(targetVal) && sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
          console.log(`   ⚠️ [YAML Merge] Converting existing 'sections' from array to object`);
          targetVal = this.arrayToObject(targetVal);
          result[key] = targetVal; // Update result with converted value
        }
      }
      
      if (sourceVal && typeof sourceVal === 'object') {
        if (Array.isArray(sourceVal)) {
          // Arrays: concatenate (e.g., sections array in YAML)
          if (Array.isArray(targetVal)) {
            result[key] = [...targetVal, ...sourceVal];
          } else {
            result[key] = sourceVal;
          }
        } else {
          // Objects: recursive merge
          if (targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
            result[key] = this.deepMerge(targetVal, sourceVal);
          } else {
            result[key] = sourceVal;
          }
        }
      } else {
        // Primitives: source overrides target
        result[key] = sourceVal;
      }
    }
    
    return result;
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
   * Schedule a debounced file tree notification via Redis Pub/Sub.
   * Batches rapid consecutive writes into a single notification (2s debounce).
   */
  private scheduleFileTreeNotification(): void {
    if (!this.fileTreeUpdate) return;
    
    const projectId = process.env.ANT_PROJECT_ID;
    const featureName = process.env.ANT_FEATURE_NAME;
    if (!projectId || !featureName) {
      console.warn(`[FileRenderer] Cannot notify file tree: missing ANT_PROJECT_ID or ANT_FEATURE_NAME`);
      return;
    }
    
    if (this.fileTreeNotifyTimer) clearTimeout(this.fileTreeNotifyTimer);
    this.fileTreeNotifyTimer = setTimeout(() => {
      this.fileTreeUpdate!.notifyFileTreeUpdate(projectId, featureName);
      this.fileTreeNotifyTimer = null;
    }, FileRenderer.FILE_TREE_NOTIFY_DEBOUNCE_MS);
  }
  
  /**
   * Flush any pending debounced file tree notification immediately.
   * Called when streaming completes to ensure the final state is broadcast.
   */
  flushFileTreeNotification(): void {
    if (this.fileTreeNotifyTimer) {
      clearTimeout(this.fileTreeNotifyTimer);
      this.fileTreeNotifyTimer = null;
      if (this.fileTreeUpdate) {
        const projectId = process.env.ANT_PROJECT_ID;
        const featureName = process.env.ANT_FEATURE_NAME;
        if (!projectId || !featureName) {
          console.warn(`[FileRenderer] Cannot flush file tree notify: missing ANT_PROJECT_ID or ANT_FEATURE_NAME`);
          return;
        }
        this.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
      }
    }
    
    // ✅ Flush pending unseen artifact notifications
    this.flushUnseenArtifacts();
  }
  
  /**
   * Flush accumulated unseen artifact paths via FileTreeBroadcaster.
   */
  private flushUnseenArtifacts(): void {
    if (this.pendingUnseenPaths.size === 0) return;
    if (!this.fileTreeUpdate || !('addUnseenArtifacts' in this.fileTreeUpdate)) return;
    
    const projectId = process.env.ANT_PROJECT_ID;
    const featureName = process.env.ANT_FEATURE_NAME;
    if (!projectId || !featureName) return;
    
    const paths = Array.from(this.pendingUnseenPaths);
    this.pendingUnseenPaths.clear();
    
    (this.fileTreeUpdate as any).addUnseenArtifacts(projectId, featureName, paths)
      .catch((err: any) => console.warn(`[FileRenderer] Failed to flush unseen artifacts: ${err.message}`));
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
    
    // ✅ Flush pending file tree notification on finalize
    this.flushFileTreeNotification();
  }
  
  /**
   * Get all file operation errors
   */
  getFileErrors(): string[] {
    return this.fileErrors;
  }

  /**
   * Get cross-worker file conflicts with structured data for direct merge.
   * These are NOT included in fileErrors — codeGen handles them directly
   * by injecting both contents into the conversation (1 LLM call instead of 4-5).
   */
  getFileConflicts(): FileConflict[] {
    return this.fileConflicts;
  }
  
  /**
   * Reset state for stream retry
   * ✅ CRITICAL: Called when API stream fails and retries
   * Clears incomplete file operations to prevent false "missing closing tag" errors
   */
  reset(): void {
    // Log incomplete files that will be discarded
    if (this.activeFiles.size > 0) {
      console.log(`[FileRenderer] 🔄 Resetting ${this.activeFiles.size} incomplete file operation(s) for retry`);
      for (const [filePath] of this.activeFiles) {
        console.log(`   - Discarding incomplete: ${filePath}`);
      }
    }
    
    this.activeFiles.clear();
    this.lineBuffers.clearAll();
    this.completionPromises.clear();
    this.completionResolvers.clear();
    this.completionRejectors.clear();
    this.fileErrors = [];
    this.fileConflicts = [];
    
    // ✅ Cancel pending file tree notification on reset
    if (this.fileTreeNotifyTimer) {
      clearTimeout(this.fileTreeNotifyTimer);
      this.fileTreeNotifyTimer = null;
    }
  }
}
