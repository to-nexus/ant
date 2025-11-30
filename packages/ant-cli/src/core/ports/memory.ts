/**
 * Memory Port
 * Interface for vector database operations
 * 
 * ✅ Multi-Collection Support:
 * - Collections are auto-resolved from metadata.type
 * - Explicit collectionType can override
 * - Format: {type}-{project} (e.g., 'codebase-myproject')
 */

import { CollectionType } from '../types';

export interface QueryOptions {
  /** Maximum number of results to return */
  k?: number;
  
  /** Metadata filters (e.g., { type: 'lesson', task: 'code' }) */
  where?: Record<string, any>;
  
  /** Minimum similarity score threshold (0-1) */
  minScore?: number;
  
  /** Explicit collection type (overrides metadata-based resolution) */
  collectionType?: CollectionType;
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
   * Collection is auto-resolved from metadata.type:
   * - metadata.type = 'codebase' → codebase-{project}
   * - metadata.type = 'lesson' → lessons-{project}
   * - metadata.type = 'document' → documents-{project}
   * 
   * @param documents - Documents with content and metadata
   * @param project - Project name (used for collection naming)
   * @param collectionType - Optional explicit collection type (overrides metadata)
   */
  store(
    documents: Array<{ content: string; metadata?: Record<string, any> }>, 
    project: string,
    collectionType?: CollectionType
  ): Promise<void>;
  
  /**
   * Query documents by semantic similarity
   * 
   * Collection is auto-resolved from options.collectionType or options.where.type
   * 
   * @param query - Search query text
   * @param project - Project name (used for collection naming)
   * @param options - Query options (k, filters, threshold, collectionType)
   * @returns Ranked results with scores and metadata
   */
  query(
    query: string, 
    project: string,
    options?: QueryOptions
  ): Promise<QueryResult[]>;
  
  /**
   * Delete documents by metadata filter
   * 
   * Collection is auto-resolved from where.type or explicit collectionType
   * 
   * @param project - Project name (used for collection naming)
   * @param where - Metadata filter (e.g., { filePath: 'src/user.ts', branch: 'main' })
   * @param collectionType - Optional explicit collection type
   */
  delete(
    project: string, 
    where: Record<string, any>,
    collectionType?: CollectionType
  ): Promise<void>;
}

