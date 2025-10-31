import { MemoryPort, QueryOptions, QueryResult } from "../../../core/ports";
import { ChromaClient } from "chromadb";

class CustomEmbeddingFunction {
  private embedUrl: string;
  constructor() {
    this.embedUrl = process.env.EMBEDDER_URL || "http://localhost:8001";
  }
  async generate(texts: string[]): Promise<number[][]> {
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
    const docs = documents.map(d => d.content);
    const metadatas = documents.map(d => d.metadata || { type: "default", timestamp: new Date().toISOString() });
    const ids = documents.map(() => `${namespace}-${Date.now()}-${Math.random().toString(36).substring(7)}`);
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
}
