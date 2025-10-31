import { Cleaner } from "../../../../core/chunk/pipeline";
import { RawChunk, CleanedChunk } from "../../../../core/chunk/types";

/**
 * MarkdownCleaner - Clean markdown chunks
 * 
 * Removes:
 * - Front matter (YAML/TOML)
 * - Excessive whitespace
 * - HTML comments
 * 
 * Preserves:
 * - Structure (headings, lists)
 * - Code blocks
 * - Links and images
 */
export class MarkdownCleaner implements Cleaner {
  async clean(chunks: RawChunk[]): Promise<CleanedChunk[]> {
    return chunks.map(chunk => ({
      text: this.cleanMarkdown(chunk.text),
      originalText: chunk.text,
      index: chunk.index,
      startPos: chunk.startPos,
      endPos: chunk.endPos,
      metadata: chunk.metadata
    }));
  }
  
  supports(contentType: string): boolean {
    return contentType === 'markdown';
  }
  
  /**
   * Clean markdown text
   */
  private cleanMarkdown(text: string): string {
    let cleaned = text;
    
    // Remove front matter (---...--- or +++...+++)
    cleaned = cleaned.replace(/^---\n[\s\S]*?\n---\n/m, '');
    cleaned = cleaned.replace(/^\+\+\+\n[\s\S]*?\n\+\+\+\n/m, '');
    
    // Remove HTML comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
    
    // Normalize whitespace (but preserve structure)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Max 2 newlines
    cleaned = cleaned.replace(/[ \t]+/g, ' '); // Single space
    
    // Trim
    cleaned = cleaned.trim();
    
    return cleaned;
  }
}

