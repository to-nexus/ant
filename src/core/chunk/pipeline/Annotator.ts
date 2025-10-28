import { CleanedChunk, Chunk } from "../types";

/**
 * Annotator - Stage 4: Add metadata and enrich chunks
 * 
 * Responsibility: Add section names, hierarchy, IDs, token counts
 */
export interface Annotator {
  /**
   * Annotate cleaned chunks with metadata
   * 
   * @param chunks - Cleaned chunks
   * @returns Final chunks with complete metadata
   */
  annotate(chunks: CleanedChunk[]): Promise<Chunk[]>;
}

