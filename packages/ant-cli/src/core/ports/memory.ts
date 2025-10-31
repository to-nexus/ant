/**
 * Memory Port
 * Interface for vector database operations
 */

export interface QueryOptions {
  /** Maximum number of results to return */
  k?: number;
  
  /** Metadata filters (e.g., { type: 'learning', task: 'code' }) */
  where?: Record<string, any>;
  
  /** Minimum similarity score threshold (0-1) */
  minScore?: number;
}

export interface QueryResult {
  /** Document content */
  content: string;
  
  /** Similarity score (0-1, higher is better) */
  score: number;
  
  /** Document metadata */
  metadata: Record<string, any>;
}

export interface MemoryPort {
  /**
   * Store documents with metadata
   * 
   * @param documents - Documents with content and metadata
   * @param namespace - Collection namespace (e.g., project name)
   */
  store(documents: Array<{ content: string; metadata?: Record<string, any> }>, namespace: string): Promise<void>;
  
  /**
   * Query documents by semantic similarity
   * 
   * @param query - Search query text
   * @param namespace - Collection namespace
   * @param options - Query options (k, filters, threshold)
   * @returns Ranked results with scores and metadata
   */
  query(query: string, namespace: string, options?: QueryOptions): Promise<QueryResult[]>;
}

