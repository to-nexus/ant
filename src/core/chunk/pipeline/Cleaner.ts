import { RawChunk, CleanedChunk } from "../types";

/**
 * Cleaner - Stage 3: Remove noise and normalize content
 * 
 * Responsibility: Filter out imports, comments, normalize whitespace
 */
export interface Cleaner {
  /**
   * Clean raw chunks by removing noise
   * 
   * @param chunks - Raw chunks from splitter
   * @returns Cleaned chunks with original preserved
   */
  clean(chunks: RawChunk[]): Promise<CleanedChunk[]>;
  
  /**
   * Check if this cleaner supports the given content type
   */
  supports(contentType: string): boolean;
}

