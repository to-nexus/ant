/**
 * LineBuffer - Manage line-based buffering for smooth streaming
 * 
 * Accumulates content until complete lines are formed, then emits them.
 * This prevents partial lines from being displayed in the UI.
 */

export class LineBufferManager {
  private buffers: Map<string, string> = new Map();
  
  /**
   * Initialize buffer for a file
   */
  init(filePath: string): void {
    this.buffers.set(filePath, '');
  }
  
  /**
   * Add content to buffer and return complete lines
   * 
   * @returns Array of complete lines ready to emit (without the incomplete last line)
   */
  addContent(filePath: string, content: string): string[] {
    const currentBuffer = this.buffers.get(filePath) || '';
    const updatedBuffer = currentBuffer + content;
    
    // Split by newlines
    const lines = updatedBuffer.split('\n');
    
    // Keep last incomplete line in buffer
    const incompleteLastLine = lines.pop() || '';
    this.buffers.set(filePath, incompleteLastLine);
    
    // Return complete lines
    return lines;
  }
  
  /**
   * Get remaining buffer content (for flushing at the end)
   */
  getRemainingBuffer(filePath: string): string {
    return this.buffers.get(filePath) || '';
  }
  
  /**
   * Clear buffer for a file
   */
  clear(filePath: string): void {
    this.buffers.delete(filePath);
  }
  
  /**
   * Clear all buffers
   */
  clearAll(): void {
    this.buffers.clear();
  }
}




