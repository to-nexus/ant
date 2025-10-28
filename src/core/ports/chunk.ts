import { ChunkInput, ChunkResult, ChunkStrategy } from "../chunk/types";

/**
 * ChunkPort
 * 
 * Port for content chunking operations
 * Follows hexagonal architecture - domain defines interface, infrastructure implements
 */
export interface ChunkPort {
  /**
   * Process content through chunking pipeline
   * 
   * @param input - Input specification
   * @param strategy - Chunk strategy (optional, uses policy if not provided)
   * @returns Chunked result with statistics
   */
  process(input: ChunkInput, strategy?: ChunkStrategy): Promise<ChunkResult>;
}

