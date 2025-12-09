/**
 * Tracks files to prevent duplicate processing during streaming
 */

import { FileStreamInfo } from '../types';

export class FileRegistry {
  private existingFiles: Set<string>;
  private streamedFiles: Map<string, FileStreamInfo> = new Map();
  
  constructor(existingFiles: Set<string>) {
    this.existingFiles = existingFiles;
  }
  
  /**
   * Check if file exists in codebase
   */
  isExisting(filePath: string): boolean {
    return this.existingFiles.has(filePath);
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

