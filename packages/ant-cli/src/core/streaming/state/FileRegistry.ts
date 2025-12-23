/**
 * Tracks files to prevent duplicate processing during streaming
 */

import { FileStreamInfo } from '../types';
import type { FileSystemPort } from '../../ports/filesystem';

export class FileRegistry {
  private existingFiles: Set<string>;
  private streamedFiles: Map<string, FileStreamInfo> = new Map();
  private fileSystem?: FileSystemPort;  // ✅ For real-time disk checks
  
  constructor(existingFiles: Set<string>, fileSystem?: FileSystemPort) {
    this.existingFiles = existingFiles;
    this.fileSystem = fileSystem;
  }
  
  /**
   * Check if file exists in codebase
   * ✅ ENHANCED: Falls back to disk check if not in existingFiles Set
   */
  async isExisting(filePath: string): Promise<boolean> {
    // 1. Fast path: Check in-memory Set (from plan + session)
    if (this.existingFiles.has(filePath)) {
      return true;
    }
    
    // 2. Slow path: Check disk for files not loaded by plan
    if (this.fileSystem) {
      try {
        const exists = await this.fileSystem.fileExists(filePath);
        if (exists) {
          console.warn(`⚠️  [FileRegistry] File ${filePath} exists on disk but not in plan context`);
          console.warn(`   This will trigger self-healing: LLM must read_file first, then use <edit>.`);
          
          // ✅ Add to Set for future checks
          this.existingFiles.add(filePath);
          
          // ✅ Return true to trigger error handling
          return true;
        }
      } catch (error) {
        console.warn(`⚠️  [FileRegistry] Disk check failed for ${filePath}:`, error);
      }
    }
    
    return false;
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

