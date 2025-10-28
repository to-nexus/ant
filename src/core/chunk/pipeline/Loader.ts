import { ChunkInput, LoadedContent } from "../types";

/**
 * Loader - Stage 1: Load content from various sources
 * 
 * Responsibility: Fetch raw content and determine content type
 */
export interface Loader {
  /**
   * Load content from source
   * 
   * @param input - Input specification
   * @returns Loaded content with type information
   */
  load(input: ChunkInput): Promise<LoadedContent>;
  
  /**
   * Check if this loader supports the given source type
   */
  supports(sourceType: string): boolean;
}

