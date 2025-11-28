import { Loader } from "../../../../core/chunk/pipeline";
import { ChunkInput, LoadedContent } from "../../../../core/chunk/types";

/**
 * TextLoader - Load pre-provided text content
 * 
 * Use when content is already in memory
 */
export class TextLoader implements Loader {
  async load(input: ChunkInput): Promise<LoadedContent> {
    if (!input.content) {
      throw new Error("TextLoader requires content to be pre-loaded in input");
    }
    
    // Detect content type from metadata or content
    const contentType = this.detectContentType(input.content, input.metadata);
    
    return {
      text: input.content,
      contentType,
      metadata: input.metadata
    };
  }
  
  supports(sourceType: string): boolean {
    return sourceType === 'text';
  }
  
  /**
   * Detect content type from text and metadata
   */
  private detectContentType(
    text: string, 
    metadata: any
  ): 'markdown' | 'code' | 'plain' {
    // Check metadata.type first
    const type = metadata.type;
    if (type === 'lesson' || type === 'design' || type === 'spec') {
      return 'markdown';
    }
    
    // ✅ For codebase type, detect from file extension or language
    if (type === 'codebase') {
      const language = metadata.language;
      const filePath = metadata.filePath || metadata.source;
      
      // Check if it's a code file by extension or language
      if (language && language !== 'unknown') {
        return 'code';
      }
      
      if (filePath) {
        const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp'];
        if (codeExtensions.some(ext => filePath.endsWith(ext))) {
          return 'code';
        }
      }
    }
    
    if (type === 'code') {
      return 'code';
    }
    
    // Check content patterns
    if (text.match(/^#{1,6}\s+/m)) {
      return 'markdown';
    }
    
    if (text.match(/^(import|export|function|class|const|let|var)\s+/m)) {
      return 'code';
    }
    
    return 'plain';
  }
}

