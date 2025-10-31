import { Cleaner } from "../../../../core/chunk/pipeline";
import { RawChunk, CleanedChunk } from "../../../../core/chunk/types";

/**
 * PlainCleaner - Basic text cleaning
 * 
 * Minimal cleaning for plain text:
 * - Normalize whitespace
 * - Trim
 */
export class PlainCleaner implements Cleaner {
  async clean(chunks: RawChunk[]): Promise<CleanedChunk[]> {
    return chunks.map(chunk => ({
      text: this.cleanPlainText(chunk.text),
      originalText: chunk.text,
      index: chunk.index,
      startPos: chunk.startPos,
      endPos: chunk.endPos,
      metadata: chunk.metadata
    }));
  }
  
  supports(contentType: string): boolean {
    return contentType === 'plain';
  }
  
  /**
   * Clean plain text
   */
  private cleanPlainText(text: string): string {
    // Normalize whitespace
    let cleaned = text.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.replace(/[ \t]+/g, ' ');
    cleaned = cleaned.trim();
    
    return cleaned;
  }
}

