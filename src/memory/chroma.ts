/**
 * ChromaDB Memory System
 * Uses ChromaDB Docker server with proper embedding configuration
 */

import { ChromaClient } from "chromadb";

const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";

// Parse URL for host and port
const url = new URL(CHROMA_URL);
const client = new ChromaClient({
  path: `${url.protocol}//${url.host}`
});

// Simple embedding function that just passes through
// Server will handle actual embedding with default model
class ServerSideEmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    // Return dummy embeddings - server will handle the real ones
    return texts.map(() => [0]);
  }
}

const embedder = new ServerSideEmbeddingFunction();

export async function queryMemory(query: string, namespace: string): Promise<string> {
  try {
    const collection = await client.getOrCreateCollection({
      name: namespace,
      embeddingFunction: embedder
    });
    
    const results = await collection.query({
      queryTexts: [query],
      nResults: 5
    });
    
    const documents = results.documents?.[0] || [];
    return documents.filter((doc): doc is string => typeof doc === 'string').join("\n\n");
  } catch (error) {
    console.warn("⚠️  ChromaDB query failed:", error);
    return "";
  }
}

export async function storeMemory(
  document: string | Array<{ content: string; metadata: Record<string, any> }>,
  namespace: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const collection = await client.getOrCreateCollection({
      name: namespace,
      embeddingFunction: embedder
    });
    
    const id = `${namespace}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    if (Array.isArray(document)) {
      await collection.add({
        documents: document.map(d => d.content),
        metadatas: document.map(d => d.metadata),
        ids: document.map(() => `${namespace}-${Date.now()}-${Math.random().toString(36).substring(7)}`)
      });
    } else {
      await collection.add({
        documents: [document],
        metadatas: [metadata || {}],
        ids: [id]
      });
    }
    
    console.log(`✅ Memory stored in ChromaDB collection: ${namespace}`);
  } catch (error) {
    console.warn("⚠️  Failed to store memory:", error);
    console.error("Error details:", error);
  }
}
