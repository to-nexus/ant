import { Splitter } from "../../../../core/chunk/pipeline";
import { LoadedContent, RawChunk, ChunkStrategy } from "../../../../core/chunk/types";

/**
 * MarkdownSplitter - Split markdown by headings
 * 
 * Strategy:
 * - Split on ## headings (preserve structure)
 * - Respect maxTokens (further split if section too large)
 * - Add overlap between chunks
 */
export class MarkdownSplitter implements Splitter {
  async split(
    content: LoadedContent, 
    strategy: ChunkStrategy
  ): Promise<RawChunk[]> {
    const { text, metadata } = content;
    
    if (strategy.preserveStructure) {
      return this.splitByHeadings(text, metadata, strategy);
    } else {
      return this.splitByTokens(text, metadata, strategy);
    }
  }
  
  supports(contentType: string): boolean {
    return contentType === 'markdown';
  }
  
  /**
   * Split by markdown headings
   */
  private splitByHeadings(
    text: string,
    metadata: any,
    strategy: ChunkStrategy
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    
    // Find all headings
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings: Array<{ level: number; title: string; pos: number }> = [];
    
    let match;
    while ((match = headingRegex.exec(text)) !== null) {
      headings.push({
        level: match[1].length,
        title: match[2],
        pos: match.index
      });
    }
    
    // Split text by headings
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].pos;
      const end = i < headings.length - 1 ? headings[i + 1].pos : text.length;
      
      const chunkText = text.substring(start, end).trim();
      
      // Check if chunk exceeds maxTokens (rough estimate: 1 token ≈ 4 chars)
      const estimatedTokens = Math.ceil(chunkText.length / 4);
      
      if (estimatedTokens > strategy.maxTokens) {
        // Further split this section
        const subChunks = this.splitLargeSection(
          chunkText, 
          start, 
          metadata, 
          strategy,
          i
        );
        chunks.push(...subChunks);
      } else {
        chunks.push({
          text: chunkText,
          index: i,
          startPos: start,
          endPos: end,
          metadata
        });
      }
    }
    
    // If no headings found, split by paragraphs
    if (chunks.length === 0) {
      return this.splitByParagraphs(text, metadata, strategy);
    }
    
    return chunks;
  }
  
  /**
   * Split large section into smaller chunks
   */
  private splitLargeSection(
    text: string,
    basePos: number,
    metadata: any,
    strategy: ChunkStrategy,
    baseIndex: number
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const targetSize = strategy.maxTokens * 4; // chars
    const overlapSize = strategy.overlapTokens * 4;
    
    let pos = 0;
    let chunkIndex = 0;
    
    while (pos < text.length) {
      const end = Math.min(pos + targetSize, text.length);
      const chunkText = text.substring(pos, end).trim();
      
      chunks.push({
        text: chunkText,
        index: baseIndex * 1000 + chunkIndex, // Nested index
        startPos: basePos + pos,
        endPos: basePos + end,
        metadata
      });
      
      pos = end - overlapSize;
      chunkIndex++;
      
      if (pos >= text.length) break;
    }
    
    return chunks;
  }
  
  /**
   * Split by paragraphs (fallback)
   */
  private splitByParagraphs(
    text: string,
    metadata: any,
    strategy: ChunkStrategy
  ): RawChunk[] {
    const paragraphs = text.split(/\n\n+/);
    const chunks: RawChunk[] = [];
    
    let currentChunk = '';
    let currentStart = 0;
    let index = 0;
    
    for (const para of paragraphs) {
      const combined = currentChunk ? `${currentChunk}\n\n${para}` : para;
      const estimatedTokens = Math.ceil(combined.length / 4);
      
      if (estimatedTokens > strategy.maxTokens && currentChunk) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim(),
          index: index++,
          startPos: currentStart,
          endPos: currentStart + currentChunk.length,
          metadata
        });
        
        currentChunk = para;
        currentStart += currentChunk.length + 2;
      } else {
        currentChunk = combined;
      }
    }
    
    // Save last chunk
    if (currentChunk) {
      chunks.push({
        text: currentChunk.trim(),
        index: index,
        startPos: currentStart,
        endPos: currentStart + currentChunk.length,
        metadata
      });
    }
    
    return chunks;
  }
  
  /**
   * Split by token count (ignoring structure)
   */
  private splitByTokens(
    text: string,
    metadata: any,
    strategy: ChunkStrategy
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const targetSize = strategy.maxTokens * 4;
    const overlapSize = strategy.overlapTokens * 4;
    
    let pos = 0;
    let index = 0;
    
    while (pos < text.length) {
      const end = Math.min(pos + targetSize, text.length);
      const chunkText = text.substring(pos, end).trim();
      
      chunks.push({
        text: chunkText,
        index: index++,
        startPos: pos,
        endPos: end,
        metadata
      });
      
      pos = end - overlapSize;
      if (pos >= text.length) break;
    }
    
    return chunks;
  }
}

