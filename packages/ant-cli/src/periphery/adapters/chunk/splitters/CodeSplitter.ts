import { Splitter } from "../../../../core/chunk/pipeline";
import { LoadedContent, RawChunk, ChunkStrategy } from "../../../../core/chunk/types";

/**
 * CodeSplitter - Split code by structural patterns (functions, classes, etc.)
 * 
 * Strategy:
 * - Use regex to identify functions, classes, exports
 * - Respect maxTokens (merge small nodes, split large ones)
 * - Fallback to line-based splitting for complex cases
 * 
 * Note: For production, consider using @babel/parser for AST-based splitting
 */
export class CodeSplitter implements Splitter {
  async split(
    content: LoadedContent, 
    strategy: ChunkStrategy
  ): Promise<RawChunk[]> {
    const { text, metadata } = content;
    
    // Use regex-based splitting (simple but effective)
    return this.splitByPatterns(text, metadata, strategy);
  }
  
  supports(contentType: string): boolean {
    return contentType === 'code';
  }
  
  /**
   * Split by code patterns (regex-based)
   */
  private splitByPatterns(
    text: string,
    metadata: any,
    strategy: ChunkStrategy
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const lines = text.split('\n');
    
    // Patterns to detect code structures
    const patterns = {
      function: /^(export\s+)?(async\s+)?function\s+\w+/,
      class: /^(export\s+)?class\s+\w+/,
      const: /^(export\s+)?const\s+\w+\s*=/,
      interface: /^(export\s+)?interface\s+\w+/,
      type: /^(export\s+)?type\s+\w+\s*=/
    };
    
    let currentChunk: string[] = [];
    let currentType = 'unknown';
    let currentName = 'unknown';
    let chunkStartLine = 0;
    let braceDepth = 0;
    let index = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Track brace depth
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;
      
      // Check if line starts a new declaration
      let isNewDeclaration = false;
      for (const [type, pattern] of Object.entries(patterns)) {
        if (pattern.test(trimmed)) {
          // Save previous chunk if exists
          if (currentChunk.length > 0 && braceDepth === 0) {
            this.addChunk(chunks, currentChunk.join('\n'), index++, chunkStartLine, i, metadata, currentType, currentName, strategy);
            currentChunk = [];
          }
          currentType = type;
          const match = trimmed.match(/(?:function|class|const|interface|type)\s+(\w+)/);
          currentName = match ? match[1] : 'anonymous';
          chunkStartLine = i;
          isNewDeclaration = true;
          break;
        }
      }
      
      currentChunk.push(line);
      
      // If we're at top level (braceDepth = 0) and have accumulated enough, save chunk
      if (braceDepth === 0 && currentChunk.length > 0 && !isNewDeclaration) {
        const estimatedTokens = Math.ceil(currentChunk.join('\n').length / 4);
        if (estimatedTokens > strategy.maxTokens) {
          this.addChunk(chunks, currentChunk.join('\n'), index++, chunkStartLine, i + 1, metadata, currentType, currentName, strategy);
          currentChunk = [];
        }
      }
    }
    
    // Add final chunk
    if (currentChunk.length > 0) {
      this.addChunk(chunks, currentChunk.join('\n'), index, chunkStartLine, lines.length, metadata, currentType, currentName, strategy);
    }
    
    // Fallback to line-based if no chunks created
    if (chunks.length === 0) {
      return this.splitByLines(text, metadata, strategy);
    }
    
    return chunks;
  }
  
  /**
   * Helper to add a chunk
   */
  private addChunk(
    chunks: RawChunk[],
    text: string,
    index: number,
    startLine: number,
    endLine: number,
    metadata: any,
    codeType: string,
    codeName: string,
    strategy: ChunkStrategy
  ): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    
    const estimatedTokens = Math.ceil(trimmed.length / 4);
    
    // If still too large, split further
    if (estimatedTokens > strategy.maxTokens) {
      const subChunks = this.splitLargeCode(trimmed, startLine, metadata, strategy, index);
      chunks.push(...subChunks);
    } else {
      chunks.push({
        text: trimmed,
        index,
        startPos: startLine,
        endPos: endLine,
        metadata: {
          ...metadata,
          codeType,
          codeName
        }
      });
    }
  }
  
  /**
   * Split large code blocks into smaller chunks
   */
  private splitLargeCode(
    text: string,
    baseLineNumber: number,
    metadata: any,
    strategy: ChunkStrategy,
    baseIndex: number
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const lines = text.split('\n');
    const targetLines = Math.floor(strategy.maxTokens / 4); // Rough estimate
    const overlapLines = Math.floor(strategy.overlapTokens / 4);
    
    let pos = 0;
    let chunkIndex = 0;
    
    while (pos < lines.length) {
      const end = Math.min(pos + targetLines, lines.length);
      const chunkLines = lines.slice(pos, end);
      const chunkText = chunkLines.join('\n').trim();
      
      if (chunkText) {
        chunks.push({
          text: chunkText,
          index: baseIndex * 1000 + chunkIndex,
          startPos: baseLineNumber + pos,
          endPos: baseLineNumber + end,
          metadata
        });
      }
      
      pos = end - overlapLines;
      chunkIndex++;
      
      if (pos >= lines.length) break;
    }
    
    return chunks;
  }
  
  /**
   * Fallback: Split by lines when AST parsing fails
   */
  private splitByLines(
    text: string,
    metadata: any,
    strategy: ChunkStrategy
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const lines = text.split('\n');
    const targetLines = Math.floor(strategy.maxTokens / 4);
    const overlapLines = Math.floor(strategy.overlapTokens / 4);
    
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
      if (pos >= lines.length) break;
    }
    
    return chunks;
  }
}

