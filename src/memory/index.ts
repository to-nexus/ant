/**
 * ChromaDB Memory System
 * Uses ChromaDB Docker server with proper embedding configuration
 */

import { ChromaClient } from "chromadb";

const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";

// Parse URL for connection details
const url = new URL(CHROMA_URL);
const client = new ChromaClient({
  host: url.hostname,
  port: parseInt(url.port || "8000"),
  ssl: url.protocol === "https:"
});

// Custom embedding server (all-MiniLM-L6-v2)
class CustomEmbeddingFunction {
  private embedUrl: string;

  constructor() {
    this.embedUrl = process.env.EMBEDDER_URL || "http://localhost:8001";
  }

  async generate(texts: string[]): Promise<number[][]> {
    try {
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
    } catch (error) {
      console.error("Failed to generate embeddings:", error);
      throw error;
    }
  }
}

const embedder = new CustomEmbeddingFunction();

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
    
    let documents: string[];
    let metadatas: Record<string, any>[];
    let ids: string[];

    if (Array.isArray(document)) {
      documents = document.map(d => d.content);
      metadatas = document.map(d => d.metadata);
      ids = document.map(() => `${namespace}-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    } else {
      documents = [document];
      metadatas = [metadata || { type: "default", timestamp: new Date().toISOString() }];
      ids = [`${namespace}-${Date.now()}-${Math.random().toString(36).substring(7)}`];
    }

    await collection.add({
      documents,
      metadatas,
      ids
    });

    const count = await collection.count();
    console.log(`✅ Memory stored in ChromaDB:`,
      `\n   Collection: ${namespace}`,
      `\n   Documents added: ${documents.length}`,
      `\n   Total documents: ${count}`,
      `\n   First document preview: ${documents[0].substring(0, 100)}...`
    );

    try {
      const stats = await client.heartbeat();
      console.log(`   ChromaDB stats:`, stats);
    } catch (statsError) {
      console.warn("⚠️  Could not fetch ChromaDB stats:", statsError);
    }
  } catch (error) {
    console.error("❌ Failed to store memory in ChromaDB:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    }
    throw error;
  }
}
