/**
 * StreamBufferManager
 * 
 * Manages temporary buffer files for streaming content.
 * Prevents data loss during interruptions by writing to disk in real-time.
 * 
 * Design:
 * - Each file being streamed gets its own buffer file
 * - Buffer files are written incrementally during streaming
 * - On interruption, buffers are preserved for resume
 * - On successful completion, buffers are cleaned up
 */

import * as fs from 'fs';
import * as path from 'path';

export interface BufferedFile {
  filePath: string;        // Original file path (e.g., "src/App.tsx")
  content: string;         // Current accumulated content
  actionType: 'create' | 'append' | 'edit' | 'delete';
  startedAt: number;       // Timestamp when streaming started
  // ✅ For edit operations
  searchContent?: string;  // Search block content
  replaceContent?: string; // Replace block content
}

export class StreamBufferManager {
  private bufferDir: string;
  private buffers: Map<string, BufferedFile> = new Map();
  private jobId: string;  // ✅ 각 job 실행마다 고유 ID
  
  constructor(projectPath: string, featureName: string, jobType: 'design' | 'code', jobId: string) {
    // Buffer directory: workspaces/{org}/{user}/{project}/features/{feature}/.buffers/{jobType}/
    this.bufferDir = path.join(projectPath, 'features', featureName, '.buffers', jobType);
    this.jobId = jobId;
    this.ensureBufferDir();
  }
  
  /**
   * Ensure buffer directory exists
   */
  private ensureBufferDir(): void {
    if (!fs.existsSync(this.bufferDir)) {
      fs.mkdirSync(this.bufferDir, { recursive: true });
    }
  }
  
  /**
   * Start tracking a new file
   * ✅ Always start fresh - disk file is source of truth
   * ⚠️  Do NOT load existing buffers (they may be incomplete/interrupted)
   */
  startFile(filePath: string, actionType: 'create' | 'append' | 'edit' | 'delete'): void {
    const initialContent = '';  // ✅ Always start fresh
    
    const bufferedFile: BufferedFile = {
      filePath,
      content: initialContent,
      actionType,
      startedAt: Date.now()
    };
    
    this.buffers.set(filePath, bufferedFile);
    this.writeBufferFile(filePath, bufferedFile);
    
    console.log(`[StreamBuffer] 📝 Started tracking: ${filePath} (${actionType}, fresh start)`);
  }
  
  /**
   * Append content to a file buffer
   * ✅ CRITICAL: Writes to disk immediately for interruption safety
   */
  appendContent(filePath: string, content: string): void {
    const buffer = this.buffers.get(filePath);
    if (!buffer) {
      console.warn(`[StreamBuffer] ⚠️  Attempted to append to non-existent buffer: ${filePath}`);
      return;
    }
    
    buffer.content += content;
    
    // ✅ Write to disk immediately (incremental safety)
    this.writeBufferFile(filePath, buffer);
  }
  
  /**
   * ✅ NEW: Set search content for edit operation
   */
  setSearchContent(filePath: string, searchContent: string): void {
    const buffer = this.buffers.get(filePath);
    if (!buffer) {
      console.warn(`[StreamBuffer] ⚠️  Attempted to set search for non-existent buffer: ${filePath}`);
      return;
    }
    
    buffer.searchContent = searchContent;
    this.writeBufferFile(filePath, buffer);
  }
  
  /**
   * ✅ NEW: Set replace content for edit operation
   */
  setReplaceContent(filePath: string, replaceContent: string): void {
    const buffer = this.buffers.get(filePath);
    if (!buffer) {
      console.warn(`[StreamBuffer] ⚠️  Attempted to set replace for non-existent buffer: ${filePath}`);
      return;
    }
    
    buffer.replaceContent = replaceContent;
    this.writeBufferFile(filePath, buffer);
  }
  
  /**
   * Mark file as completed and optionally clean up buffer
   */
  completeFile(filePath: string, cleanup: boolean = true): BufferedFile | undefined {
    const buffer = this.buffers.get(filePath);
    if (!buffer) {
      return undefined;
    }
    
    console.log(`[StreamBuffer] ✅ Completed: ${filePath} (${buffer.content.length} chars)`);
    
    if (cleanup) {
      this.deleteBufferFile(filePath);
      this.buffers.delete(filePath);
    }
    
    return buffer;
  }
  
  /**
   * Get current content for a file
   */
  getContent(filePath: string): string | undefined {
    return this.buffers.get(filePath)?.content;
  }
  
  /**
   * Get all buffered files
   */
  getAllBuffers(): Map<string, BufferedFile> {
    return new Map(this.buffers);
  }
  
  /**
   * ✅ Reset file buffer (for multi-turn overwrites)
   * Used when LLM generates the same file multiple times in different turns
   */
  resetFile(filePath: string, actionType: 'create' | 'append' | 'edit' | 'delete'): void {
    console.log(`[StreamBuffer] 🔄 Resetting buffer for ${filePath} (overwrite)`);
    
    // Delete existing buffer
    const existing = this.buffers.get(filePath);
    if (existing) {
      this.deleteBufferFile(filePath);
      this.buffers.delete(filePath);
    }
    
    // Start fresh
    this.startFile(filePath, actionType);
  }
  
  /**
   * Load a single buffer from disk
   * ✅ Used by startFile to check for existing content
   */
  private loadBufferFromDisk(filePath: string): BufferedFile | undefined {
    try {
      const bufferFilename = this.getBufferFilename(filePath);
      const bufferPath = path.join(this.bufferDir, bufferFilename);
      
      if (!fs.existsSync(bufferPath)) {
        return undefined;
      }
      
      const bufferData = JSON.parse(fs.readFileSync(bufferPath, 'utf-8'));
      return bufferData;
    } catch (error) {
      console.warn(`[StreamBuffer] ⚠️  Failed to load buffer for ${filePath}:`, error);
      return undefined;
    }
  }
  
  /**
   * Load buffers from disk (for resume)
   * Returns map of filePath -> BufferedFile
   */
  loadBuffersFromDisk(): Map<string, BufferedFile> {
    const loadedBuffers = new Map<string, BufferedFile>();
    
    if (!fs.existsSync(this.bufferDir)) {
      return loadedBuffers;
    }
    
    const bufferFiles = fs.readdirSync(this.bufferDir);
    
    for (const filename of bufferFiles) {
      if (!filename.endsWith('.json')) continue;
      
      try {
        const bufferPath = path.join(this.bufferDir, filename);
        const bufferData = JSON.parse(fs.readFileSync(bufferPath, 'utf-8'));
        
        loadedBuffers.set(bufferData.filePath, bufferData);
        this.buffers.set(bufferData.filePath, bufferData);
        
        console.log(`[StreamBuffer] 📂 Loaded buffer: ${bufferData.filePath} (${bufferData.content.length} chars)`);
      } catch (error) {
        console.warn(`[StreamBuffer] ⚠️  Failed to load buffer ${filename}:`, error);
      }
    }
    
    return loadedBuffers;
  }
  
  /**
   * Clean up all buffers (on successful job completion)
   */
  cleanupAll(): void {
    console.log(`[StreamBuffer] 🧹 Cleaning up ${this.buffers.size} buffer(s)...`);
    
    for (const filePath of this.buffers.keys()) {
      this.deleteBufferFile(filePath);
    }
    
    this.buffers.clear();
    
    // Remove buffer directory if empty
    try {
      const files = fs.readdirSync(this.bufferDir);
      if (files.length === 0) {
        fs.rmdirSync(this.bufferDir);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }
  
  /**
   * Preserve buffers on interruption (keep files on disk)
   */
  preserveOnInterruption(): void {
    console.log(`[StreamBuffer] 💾 Preserving ${this.buffers.size} buffer(s) for resume...`);
    
    // Ensure all current buffers are written to disk
    for (const [filePath, buffer] of this.buffers) {
      this.writeBufferFile(filePath, buffer);
    }
  }
  
  /**
   * Write buffer to disk
   * File naming: hash of file path to avoid filesystem issues
   */
  private writeBufferFile(filePath: string, buffer: BufferedFile): void {
    try {
      const bufferFilename = this.getBufferFilename(filePath);
      const bufferPath = path.join(this.bufferDir, bufferFilename);
      
      fs.writeFileSync(bufferPath, JSON.stringify(buffer, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[StreamBuffer] ❌ Failed to write buffer for ${filePath}:`, error);
    }
  }
  
  /**
   * Delete buffer file from disk
   */
  private deleteBufferFile(filePath: string): void {
    try {
      const bufferFilename = this.getBufferFilename(filePath);
      const bufferPath = path.join(this.bufferDir, bufferFilename);
      
      if (fs.existsSync(bufferPath)) {
        fs.unlinkSync(bufferPath);
      }
    } catch (error) {
      console.error(`[StreamBuffer] ❌ Failed to delete buffer for ${filePath}:`, error);
    }
  }
  
  /**
   * Generate safe filename from file path
   * Uses base64 encoding to handle special characters
   */
  private getBufferFilename(filePath: string): string {
    // Simple hash: base64 encode the path
    const encoded = Buffer.from(filePath).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    return `${encoded}.json`;
  }
  
  /**
   * Get statistics about current buffers
   */
  getStats(): {
    totalFiles: number;
    totalSize: number;
    files: Array<{ path: string; size: number; actionType: string }>;
  } {
    const files: Array<{ path: string; size: number; actionType: string }> = [];
    let totalSize = 0;
    
    for (const [filePath, buffer] of this.buffers) {
      const size = buffer.content.length;
      totalSize += size;
      files.push({
        path: filePath,
        size,
        actionType: buffer.actionType
      });
    }
    
    return {
      totalFiles: this.buffers.size,
      totalSize,
      files
    };
  }
}

