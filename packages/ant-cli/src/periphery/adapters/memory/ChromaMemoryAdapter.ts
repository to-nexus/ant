import { MemoryPort, QueryOptions, QueryResult } from "../../../core/ports";
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
  async store(documents: Array<{ content: string; metadata?: Record<string, any> }>, namespace: string): Promise<void> {
    const collection = await client.getOrCreateCollection({ name: namespace, embeddingFunction: embedder });
    
    // Use for-loop instead of map() to reduce temporary array allocations
    const docs: string[] = [];
    const metadatas: Record<string, any>[] = [];
    const ids: string[] = [];
    
    const timestamp = Date.now();
    const randomSeed = Math.random().toString(36).substring(7);
    
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      docs.push(doc.content);
      metadatas.push(doc.metadata || { type: "default", timestamp: new Date().toISOString() });
      ids.push(`${namespace}-${timestamp}-${randomSeed}-${i}`);
    }
    
    await collection.add({ documents: docs, metadatas, ids });
  }
  
  async query(query: string, namespace: string, options?: QueryOptions): Promise<QueryResult[]> {
    const collection = await client.getOrCreateCollection({ name: namespace, embeddingFunction: embedder });
    
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
  }
  
  /**
   * Delete documents by metadata filter
   * 
   * ✅ Used for incremental indexing to remove old chunks before adding new ones
   */
  async delete(namespace: string, where: Record<string, any>): Promise<void> {
    try {
      const collection = await client.getOrCreateCollection({ name: namespace, embeddingFunction: embedder });
      
      // ChromaDB delete requires $and format for multiple conditions
      await collection.delete({ where: where as any });
    } catch (error) {
      console.warn(`⚠️  Failed to delete documents from ${namespace}:`, error);
      // Don't throw - deletion failure shouldn't stop indexing
    }
  }
}
