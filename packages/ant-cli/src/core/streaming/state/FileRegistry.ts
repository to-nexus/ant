/**
 * Tracks files to prevent duplicate processing during streaming
 */

import { FileStreamInfo } from '../types';
import type { FileSystemPort } from '../../ports/filesystem';
import { normalizeToCodebasePath } from '../../utils/pathNormalizer';

export class FileRegistry {
  private existingFiles: Set<string>;
  private otherWorkerPaths: Set<string>;
  private streamedFiles: Map<string, FileStreamInfo> = new Map();
  private fileSystem?: FileSystemPort;  // ✅ For real-time disk checks
  private codebaseRel: string;  // ✅ For path normalization consistency
  
  constructor(
    existingFiles: Set<string>,
    fileSystem?: FileSystemPort,
    codebaseRel: string = 'codebase',
    otherWorkerPaths?: Set<string>,
  ) {
    this.existingFiles = existingFiles;
    this.fileSystem = fileSystem;
    this.codebaseRel = codebaseRel;
    this.otherWorkerPaths = otherWorkerPaths || new Set();
  }
  
  /**
   * Check if file exists in codebase
   * ✅ ENHANCED: Normalizes paths before checking to prevent mismatches
   * between different path formats (e.g., "src/app/x" vs "codebase/src/app/x")
   */
  async isExisting(filePath: string): Promise<boolean> {
    // ✅ Normalize the input path to match the format used in existingFiles Set
    const { normalized } = normalizeToCodebasePath(filePath, this.codebaseRel);
    
    // 1. Fast path: Check in-memory Set (from plan + session)
    // Check both normalized and original to handle edge cases
    if (this.existingFiles.has(normalized) || this.existingFiles.has(filePath)) {
      return true;
    }
    
    // 2. Slow path: Check disk for files not loaded by plan
    // Use normalized path for disk check (ensures correct filesystem location)
    if (this.fileSystem) {
      try {
        const exists = await this.fileSystem.fileExists(normalized);
        if (exists) {
          console.warn(`⚠️  [FileRegistry] File ${normalized} exists on disk but not in plan context`);
          console.warn(`   This will trigger self-healing: LLM must read_file first, then use <edit>.`);
          
          // ✅ Add normalized path to Set for future checks
          this.existingFiles.add(normalized);
          
          // ✅ Return true to trigger error handling
          return true;
        }
      } catch (error) {
        console.warn(`⚠️  [FileRegistry] Disk check failed for ${normalized}:`, error);
      }
    }
    
    return false;
  }
  
  /**
   * Check if file was known at codeGen start (existingFiles Set only, no disk fallback).
   * Used by FileRenderer to determine isOverwrite flag at file_start time.
   *
   * CRITICAL: Files created by OTHER parallel workers (otherWorkerPaths) return false
   * even though they exist in existingFiles. This forces the writeNewFile() path in
   * FileRenderer, which triggers SharedFileBuffer's ownership check and prevents
   * silent cross-worker overwrites.
   */
  isKnownAtStart(filePath: string): boolean {
    const { normalized } = normalizeToCodebasePath(filePath, this.codebaseRel);
    // Other workers' files must NOT be treated as overwrite targets
    if (this.otherWorkerPaths.has(normalized) || this.otherWorkerPaths.has(filePath)) {
      return false;
    }
    return this.existingFiles.has(normalized) || this.existingFiles.has(filePath);
  }
  
  /**
   * Check if file has already been streamed in this session
   */
  hasStreamed(filePath: string): boolean {
    return this.streamedFiles.has(filePath);
  }
  
  /**
   * Mark file as streamed (prevents duplicate processing)
   */
  markAsStreamed(filePath: string, actionType: 'create' | 'append' | 'edit' | 'delete'): void {
    this.streamedFiles.set(filePath, {
      filePath,
      actionType,
      startedAt: Date.now(),
      contentBuffer: ''
    });
  }
  
  /**
   * Update content buffer for a streaming file
   */
  appendContent(filePath: string, content: string): void {
    const info = this.streamedFiles.get(filePath);
    if (info) {
      info.contentBuffer += content;
    }
  }
  
  /**
   * Get file stream info
   */
  getFileInfo(filePath: string): FileStreamInfo | undefined {
    return this.streamedFiles.get(filePath);
  }
  
  /**
   * Get all streamed file paths
   */
  getStreamedFiles(): string[] {
    return Array.from(this.streamedFiles.keys());
  }
  
  /**
   * ✅ Get all streamed files with metadata (for state.files)
   */
  getAllFiles(): Array<{ path: string; content: string; actionType: 'create' | 'append' | 'edit' | 'delete' }> {
    return Array.from(this.streamedFiles.values()).map(file => ({
      path: file.filePath,
      content: file.contentBuffer,
      actionType: file.actionType
    }));
  }
  
  /**
   * ✅ Reset specific file (for multi-turn overwrites)
   */
  resetFile(filePath: string): void {
    this.streamedFiles.delete(filePath);
  }
  
  /**
   * Reset registry
   */
  reset(): void {
    this.streamedFiles.clear();
  }
}

