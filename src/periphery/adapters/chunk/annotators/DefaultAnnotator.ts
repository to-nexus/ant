import { Annotator } from "../../../../core/chunk/pipeline";
import { CleanedChunk, Chunk } from "../../../../core/chunk/types";

/**
 * DefaultAnnotator - Add metadata to chunks
 * 
 * Enriches chunks with:
 * - Unique IDs
 * - Token counts
 * - Section extraction (from headings)
 * - Hierarchy detection
 */
export class DefaultAnnotator implements Annotator {
  async annotate(chunks: CleanedChunk[]): Promise<Chunk[]> {
    return chunks.map((chunk, idx) => {
      const section = this.extractSection(chunk.text);
      const level = this.detectLevel(chunk.text);
      
      return {
        text: chunk.text,
        id: this.generateId(chunk, idx),
        tokens: this.estimateTokens(chunk.text),
        index: chunk.index,
        startPos: chunk.startPos,
        endPos: chunk.endPos,
        metadata: {
          ...chunk.metadata,
          section,
          level
        }
      };
    });
  }
  
  /**
   * Generate unique chunk ID
   */
  private generateId(chunk: CleanedChunk, index: number): string {
    const { project, feature, type, timestamp } = chunk.metadata;
    const hash = this.simpleHash(chunk.text);
    
    return `${project}-${feature}-${type}-${index}-${hash}`;
  }
  
  /**
   * Estimate token count (rough: 1 token ≈ 4 chars)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Extract section name from chunk (first heading)
   */
  private extractSection(text: string): string | undefined {
    const headingMatch = text.match(/^#{1,6}\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
    return undefined;
  }
  
  /**
   * Detect hierarchy level (0 = root)
   */
  private detectLevel(text: string): number | undefined {
    const headingMatch = text.match(/^(#{1,6})\s+/m);
    if (headingMatch) {
      return headingMatch[1].length - 1; // # = 0, ## = 1, etc.
    }
    return undefined;
  }
  
  /**
   * Simple hash for ID generation
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36).substring(0, 8);
  }
}

