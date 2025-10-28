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
    const contentType = this.detectContentType(input.content, input.metadata.type);
    
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
    type: string
  ): 'markdown' | 'code' | 'plain' {
    // Check metadata first
    if (type === 'learning' || type === 'design' || type === 'spec') {
      return 'markdown';
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

