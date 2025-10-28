/**
 * Chunking Pipeline Types
 * 
 * Defines data structures for the 6-stage chunking pipeline:
 * Loader → Splitter → Cleaner → Annotator → Encoder → VectorSink
 */

/**
 * Input to the chunking engine
 */
export interface ChunkInput {
  /** Source identifier (file path, url, etc.) */
  source: string;
  
  /** Source type for loader selection */
  sourceType: 'text' | 'file' | 'git' | 'api';
  
  /** Optional pre-loaded content (skips loader) */
  content?: string;
  
  /** Metadata to be propagated */
  metadata: ChunkMetadata;
}

/**
 * Metadata attached to chunks
 */
export interface ChunkMetadata {
  /** Type of content */
  type: 'learning' | 'code' | 'design' | 'spec';
  
  /** Task context */
  task?: 'code' | 'design' | 'learn';
  
  /** Project identifier */
  project: string;
  
  /** Feature/module identifier */
  feature: string;
  
  /** Source file path (if applicable) */
  filePath?: string;
  
  /** Programming language (if code) */
  language?: string;
  
  /** Timestamp */
  timestamp: string;
  
  /** Additional custom metadata */
  [key: string]: any;
}

/**
 * Raw loaded content before splitting
 */
export interface LoadedContent {
  /** Text content */
  text: string;
  
  /** Content type (for splitter selection) */
  contentType: 'markdown' | 'code' | 'plain';
  
  /** Original metadata */
  metadata: ChunkMetadata;
}

/**
 * Chunk after splitting (before cleaning)
 */
export interface RawChunk {
  /** Chunk text */
  text: string;
  
  /** Position in original document */
  index: number;
  
  /** Start character position */
  startPos: number;
  
  /** End character position */
  endPos: number;
  
  /** Metadata */
  metadata: ChunkMetadata;
}

/**
 * Chunk after cleaning
 */
export interface CleanedChunk {
  /** Cleaned text */
  text: string;
  
  /** Original text (before cleaning) */
  originalText: string;
  
  /** Position information */
  index: number;
  startPos: number;
  endPos: number;
  
  /** Metadata */
  metadata: ChunkMetadata;
}

/**
 * Final chunk with complete metadata (ready for embedding)
 */
export interface Chunk {
  /** Final text content */
  text: string;
  
  /** Unique identifier */
  id: string;
  
  /** Token count estimate */
  tokens: number;
  
  /** Position information */
  index: number;
  startPos: number;
  endPos: number;
  
  /** Complete metadata */
  metadata: ChunkMetadata & {
    /** Section/heading this chunk belongs to */
    section?: string;
    
    /** Hierarchy level (0 = root) */
    level?: number;
    
    /** Parent chunk ID (if hierarchical) */
    parentId?: string;
  };
}

/**
 * Chunk strategy configuration
 */
export interface ChunkStrategy {
  /** Splitter type */
  splitter: 'markdown' | 'code' | 'token' | 'semantic';
  
  /** Maximum tokens per chunk */
  maxTokens: number;
  
  /** Overlap tokens between chunks */
  overlapTokens: number;
  
  /** Whether to preserve structure (headings, functions) */
  preserveStructure: boolean;
}

/**
 * Chunk result with statistics
 */
export interface ChunkResult {
  /** Final chunks */
  chunks: Chunk[];
  
  /** Statistics */
  stats: {
    originalLength: number;
    totalChunks: number;
    avgChunkSize: number;
    avgTokens: number;
  };
}

