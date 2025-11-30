import { MemoryPort, QueryOptions, QueryResult } from "../../../core/ports";
import { CollectionType, getCollectionName } from "../../../core/types";
import { ChromaClient } from "chromadb";

class CustomEmbeddingFunction {
  private embedUrl: string;
  private MAX_BATCH_SIZE = 10;  // Increased from 5 (CodeSplitter fixed)
  
  constructor() {
    this.embedUrl = process.env.EMBEDDER_URL || "http://localhost:8001";
  }
  
  async generate(texts: string[]): Promise<number[][]> {
    // Split large batches to prevent API overload
    if (texts.length > this.MAX_BATCH_SIZE) {
      const allEmbeddings: number[][] = [];
      
      for (let i = 0; i < texts.length; i += this.MAX_BATCH_SIZE) {
        const batch = texts.slice(i, Math.min(i + this.MAX_BATCH_SIZE, texts.length));
        const batchEmbeddings = await this.generateBatch(batch);
        allEmbeddings.push(...batchEmbeddings);
      }
      
      return allEmbeddings;
    }
    
    return this.generateBatch(texts);
  }
  
  private async generateBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.embedUrl}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts })
    });
    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.statusText}`);
    }
    const data = await response.json();
    return data.embeddings;
  }
}

const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const url = new URL(CHROMA_URL);
const client = new ChromaClient({
  host: url.hostname,
  port: parseInt(url.port || "8000"),
  ssl: url.protocol === "https:"
});
const embedder = new CustomEmbeddingFunction();

export class ChromaMemoryAdapter implements MemoryPort {
  
  /**
   * Extract collection type from metadata or explicit parameter
   * 
   * Priority:
   * 1. Explicit collectionType parameter
   * 2. metadata.type value
   * 3. Default: 'codebase'
   */
  private extractCollectionType(
    metadata?: Record<string, any>,
    explicitType?: CollectionType
  ): CollectionType {
    if (explicitType) return explicitType;
    
    const metaType = metadata?.type;
    if (metaType === 'lesson') return 'lessons';
    if (metaType === 'document') return 'documents';
    if (metaType === 'codebase') return 'codebase';
    if (metaType === 'context') return 'context';
    
    // Default fallback
    return 'codebase';
  }
  
  /**
   * Store documents to appropriate collection(s)
   * 
   * Multi-collection support:
   * - Groups documents by collection type
   * - Stores each group to its respective collection
   * - Collection name: {type}-{project}
   */
  async store(
    documents: Array<{ content: string; metadata?: Record<string, any> }>, 
    project: string,
    collectionType?: CollectionType
  ): Promise<void> {
    // Group documents by collection type
    const grouped = new Map<CollectionType, typeof documents>();
    
    for (const doc of documents) {
      const type = this.extractCollectionType(doc.metadata, collectionType);
      if (!grouped.has(type)) {
        grouped.set(type, []);
      }
      grouped.get(type)!.push(doc);
    }
    
    // Store to each collection
    for (const [type, docs] of grouped.entries()) {
      const collectionName = getCollectionName(type, project);
      
      try {
        const collection = await client.getOrCreateCollection({ 
          name: collectionName, 
          embeddingFunction: embedder 
        });
        
        // Prepare data
        const contents: string[] = [];
        const metadatas: Record<string, any>[] = [];
        const ids: string[] = [];
        
        const timestamp = Date.now();
        const randomSeed = Math.random().toString(36).substring(7);
        
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i];
          contents.push(doc.content);
          metadatas.push(doc.metadata || { type, timestamp: new Date().toISOString() });
          ids.push(`${collectionName}-${timestamp}-${randomSeed}-${i}`);
        }
        
        await collection.add({ documents: contents, metadatas, ids });
        
        console.log(`✅ [ChromaMemory] Stored ${docs.length} documents to ${collectionName}`);
      } catch (error) {
        console.error(`❌ [ChromaMemory] Failed to store to ${collectionName}:`, error);
        throw error;
      }
    }
  }
  
  /**
   * Query documents from appropriate collection
   * 
   * Collection resolution:
   * 1. options.collectionType (explicit)
   * 2. options.where.type (from metadata filter)
   * 3. Default: 'codebase'
   */
  async query(
    query: string, 
    project: string,
    options?: QueryOptions
  ): Promise<QueryResult[]> {
    const type = this.extractCollectionType(options?.where, options?.collectionType);
    const collectionName = getCollectionName(type, project);
    
    try {
      const collection = await client.getOrCreateCollection({ 
        name: collectionName, 
        embeddingFunction: embedder 
      });
      
      const k = options?.k || 5;
      const where = options?.where;
      const minScore = options?.minScore || 0;
      
      // Query with metadata filtering
      const results = await collection.query({ 
        queryTexts: [query], 
        nResults: k,
        where: where as any  // ChromaDB where clause
      });
      
      const documents = results.documents?.[0] || [];
      const distances = results.distances?.[0] || [];
      const metadatas = results.metadatas?.[0] || [];
      
      // Convert distance to similarity score (cosine distance -> similarity)
      // ChromaDB returns L2 distance, convert to similarity: 1 / (1 + distance)
      const queryResults: QueryResult[] = documents
        .map((doc, i) => {
          if (typeof doc !== 'string') return null;
          
          const distance = distances[i] || 0;
          const score = 1 / (1 + distance);  // Normalize to 0-1
          
          return {
            content: doc,
            score,
            metadata: (metadatas[i] as Record<string, any>) || {}
          };
        })
        .filter((result): result is QueryResult => result !== null && result.score >= minScore);
      
      return queryResults;
    } catch (error) {
      console.warn(`⚠️  [ChromaMemory] Query failed for ${collectionName}:`, error);
      return [];
    }
  }
  
  /**
   * Delete documents by metadata filter
   * 
   * ✅ Used for incremental indexing to remove old chunks before adding new ones
   */
  async delete(
    project: string, 
    where: Record<string, any>,
    collectionType?: CollectionType
  ): Promise<void> {
    const type = this.extractCollectionType(where, collectionType);
    const collectionName = getCollectionName(type, project);
    
    try {
      const collection = await client.getOrCreateCollection({ 
        name: collectionName, 
        embeddingFunction: embedder 
      });
      
      // ChromaDB delete requires $and format for multiple conditions
      await collection.delete({ where: where as any });
      
      console.log(`🗑️  [ChromaMemory] Deleted documents from ${collectionName}`);
    } catch (error) {
      console.warn(`⚠️  [ChromaMemory] Failed to delete from ${collectionName}:`, error);
      // Don't throw - deletion failure shouldn't stop indexing
    }
  }
}
