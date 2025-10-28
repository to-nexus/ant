/**
 * Memory Port
 * Interface for vector database operations
 */

export interface MemoryPort {
  store(documents: Array<{ content: string; metadata?: Record<string, any> }>, namespace: string): Promise<void>;
  query(query: string, namespace: string, k?: number): Promise<string[]>;
}

