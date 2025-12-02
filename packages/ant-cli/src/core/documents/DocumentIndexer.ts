/**
 * Document Indexer
 * 
 * Indexes documents (design, PRD, directives, specs) into Vector DB
 * for semantic search and retrieval.
 * 
 * Usage:
 * - Design Job: Index design document after generation
 * - Code Job: Index directive at start
 * - Manual: Index PRD/specs on import
 * 
 * Collection: documents-{project}
 */

import { MemoryPort, ChunkPort } from '../ports';
import { DocumentType } from '../types';

export interface DocumentIndexOptions {
  project: string;
  feature?: string;
  tags?: string[];
  version?: string;
}

/**
 * Document metadata (stored in Vector DB)
 */
export interface DocumentMetadata {
  type: 'document';
  docType: DocumentType;
  
  // Document info
  title: string;
  project: string;
  feature?: string;
  version?: string;
  
  // Timestamps
  createdAt: string;
  lastModified: string;
  
  // Source
  sourcePath?: string;          // Original file path
  sourceType: 'generated' | 'user-provided' | 'imported';
  
  // Tags
  tags: string[];
  relatedLessons?: string[];    // Lesson IDs that reference this
}

export class DocumentIndexer {
  constructor(
    private vectorDB: MemoryPort,
    private chunkEngine: ChunkPort
  ) {}
  
  /**
   * Index a design document
   * 
   * @param content - Design document content
   * @param title - Document title
   * @param options - Index options
   */
  async indexDesignDoc(
    content: string,
    title: string,
    options: DocumentIndexOptions
  ): Promise<void> {
    await this.indexDocument(content, {
      docType: 'design',
      title,
      ...options
    });
  }
  
  /**
   * Index a PRD (Product Requirements Document)
   * 
   * @param content - PRD content
   * @param title - Document title
   * @param options - Index options
   */
  async indexPRD(
    content: string,
    title: string,
    options: DocumentIndexOptions
  ): Promise<void> {
    await this.indexDocument(content, {
      docType: 'prd',
      title,
      ...options
    });
  }
  
  /**
   * Index a directive (user instruction)
   * 
   * @param content - Directive content
   * @param directiveId - Unique directive ID
   * @param options - Index options
   */
  async indexDirective(
    content: string,
    directiveId: string,
    options: DocumentIndexOptions
  ): Promise<void> {
    await this.indexDocument(content, {
      docType: 'directive',
      title: `Directive ${directiveId}`,
      ...options,
      tags: [...(options.tags || []), 'directive', `id-${directiveId}`]
    });
  }
  
  /**
   * Index a technical specification
   * 
   * @param content - Spec content
   * @param title - Document title
   * @param options - Index options
   */
  async indexSpec(
    content: string,
    title: string,
    options: DocumentIndexOptions
  ): Promise<void> {
    await this.indexDocument(content, {
      docType: 'spec',
      title,
      ...options
    });
  }
  
  /**
   * Generic document indexing
   * 
   * Process:
   * 1. Chunk the document
   * 2. Generate embeddings
   * 3. Store to documents-{project} collection
   */
  private async indexDocument(
    content: string,
    params: {
      docType: DocumentType;
      title: string;
      project: string;
      feature?: string;
      tags?: string[];
      version?: string;
    }
  ): Promise<void> {
    console.log(`📄 [DocumentIndexer] Indexing ${params.docType}: ${params.title}`);
    
    // Chunk the document
    const result = await this.chunkEngine.process({
      source: `document-${params.docType}`,
      sourceType: 'text',
      content,
      metadata: {
        type: 'document',  // Collection type
        docType: params.docType,
        title: params.title,
        project: params.project,
        feature: params.feature || 'default',  // ✅ Provide default
        tags: (params.tags || []).join(','),  // ✅ Convert array to string for ChromaDB
        version: params.version,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        sourceType: 'generated' as const,
        timestamp: new Date().toISOString()  // ✅ Required by ChunkMetadata
      }
    });
    
    console.log(`   📚 Chunked into ${result.chunks.length} pieces (avg ${result.stats.avgTokens} tokens)`);
    
    // Convert to documents
    const documents = result.chunks.map(chunk => ({
      content: chunk.text,
      metadata: chunk.metadata
    }));
    
    // Store to documents collection
    await this.vectorDB.store(documents, params.project, 'documents');
    
    console.log(`   ✅ Indexed ${result.chunks.length} chunks to documents-${params.project}`);
  }
  
  /**
   * Delete a document from the index
   * 
   * @param project - Project name
   * @param docType - Document type
   * @param title - Document title
   */
  async deleteDocument(
    project: string,
    docType: DocumentType,
    title: string
  ): Promise<void> {
    console.log(`🗑️  [DocumentIndexer] Deleting ${docType}: ${title}`);
    
    await this.vectorDB.delete(
      project,
      { docType, title },
      'documents'
    );
    
    console.log(`   ✅ Deleted document from documents-${project}`);
  }
  
  /**
   * Update a document (delete old + index new)
   * 
   * @param content - New document content
   * @param title - Document title
   * @param options - Index options
   */
  async updateDesignDoc(
    content: string,
    title: string,
    options: DocumentIndexOptions
  ): Promise<void> {
    // Delete old version
    await this.deleteDocument(options.project, 'design', title);
    
    // Index new version
    await this.indexDesignDoc(content, title, options);
  }
  
  /**
   * Search documents by query
   * 
   * @param query - Search query
   * @param project - Project name
   * @param docType - Optional document type filter
   * @param maxResults - Maximum results to return
   * @returns Search results with scores
   */
  async searchDocuments(
    query: string,
    project: string,
    docType?: DocumentType,
    maxResults: number = 5
  ): Promise<Array<{
    content: string;
    score: number;
    metadata: DocumentMetadata;
  }>> {
    const where = docType ? { docType } : {};
    
    const results = await this.vectorDB.query(
      query,
      project,
      {
        k: maxResults,
        where,
        collectionType: 'documents',
        minScore: 0.5
      }
    );
    
    return results.map(r => ({
      content: r.content,
      score: r.score,
      metadata: r.metadata as DocumentMetadata
    }));
  }
}

