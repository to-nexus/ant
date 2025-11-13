/**
 * Manages streaming state during LLM response processing
 */

export class StreamState {
  private raw: string = '';
  private buffer: string = '';
  
  /**
   * Append content to both raw accumulator and buffer
   */
  append(content: string): void {
    this.raw += content;
    this.buffer += content;
  }
  
  /**
   * Get accumulated raw text (entire LLM response)
   */
  getRaw(): string {
    return this.raw;
  }
  
  /**
   * Get current buffer (for incremental parsing)
   */
  getBuffer(): string {
    return this.buffer;
  }
  
  /**
   * Clear buffer (used after consuming parsed content)
   */
  clearBuffer(): void {
    this.buffer = '';
  }
  
  /**
   * Reset all state
   */
  reset(): void {
    this.raw = '';
    this.buffer = '';
  }
}

