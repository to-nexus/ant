import { Splitter } from "../../../../core/chunk/pipeline";
import { LoadedContent, RawChunk, ChunkStrategy } from "../../../../core/chunk/types";

/**
 * CodeSplitter - Split code files into manageable chunks
 * 
 * Simplified approach to avoid OOM on complex JSX/TSX files:
 * - Small files (< maxTokens): Return as single chunk
 * - Large files: Simple line-based splitting with overlap
 * 
 * Avoids complex brace tracking that fails on JSX syntax
 */
export class CodeSplitter implements Splitter {
  async split(
    content: LoadedContent, 
    strategy: ChunkStrategy
  ): Promise<RawChunk[]> {
    const { text, metadata } = content;
    
    // Simple and memory-safe approach
    return this.splitByPatterns(text, metadata, strategy);
  }
  
  supports(contentType: string): boolean {
    return contentType === 'code';
  }
  
  /**
   * Split by code patterns (simplified)
   */
  private splitByPatterns(
    text: string,
    metadata: any,
    strategy: ChunkStrategy
  ): RawChunk[] {
    const lines = text.split('\n');
    
    // For small files, return as single chunk
    const estimatedTokens = Math.ceil(text.length / 4);
    if (estimatedTokens <= strategy.maxTokens) {
      return [{
        text: text.trim(),
        index: 0,
        startPos: 0,
        endPos: lines.length,
        metadata
      }];
    }
    
    // For large files, use simple line-based splitting
    return this.splitByLines(text, metadata, strategy);
  }
  
  /**
   * Simple line-based splitting with overlap
   */
  private splitByLines(
    text: string,
    metadata: any,
    strategy: ChunkStrategy
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const lines = text.split('\n');
    const targetLines = Math.max(10, Math.floor(strategy.maxTokens * 4 / 80)); // ~80 chars/line
    const overlapLines = Math.max(2, Math.floor(strategy.overlapTokens * 4 / 80));
    
    let pos = 0;
    let index = 0;
    
    while (pos < lines.length) {
      const end = Math.min(pos + targetLines, lines.length);
      const chunkText = lines.slice(pos, end).join('\n').trim();
      
      if (chunkText) {
        chunks.push({
          text: chunkText,
          index: index++,
          startPos: pos,
          endPos: end,
          metadata
        });
      }
      
      pos = end - overlapLines;
      if (pos >= lines.length || end === lines.length) break;
    }
    
    return chunks.length > 0 ? chunks : [{
      text: text.trim(),
      index: 0,
      startPos: 0,
      endPos: lines.length,
      metadata
    }];
  }
}

