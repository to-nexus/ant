import { LoadedContent, RawChunk, ChunkStrategy } from "../types";

/**
 * Splitter - Stage 2: Split content into meaningful chunks
 * 
 * Responsibility: Divide text based on structure (headings, functions, tokens)
 */
export interface Splitter {
  /**
   * Split loaded content into raw chunks
   * 
   * @param content - Loaded content
   * @param strategy - Chunk configuration
   * @returns Array of raw chunks with position info
   */
  split(content: LoadedContent, strategy: ChunkStrategy): Promise<RawChunk[]>;
  
  /**
   * Check if this splitter supports the given content type
   */
  supports(contentType: string): boolean;
}

