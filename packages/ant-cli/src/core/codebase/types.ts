/**
 * Codebase Retrieval Types
 * 
 * Defines all interfaces and types for the hybrid retrieval system.
 */

/**
 * File source types - where the file was discovered
 */
export type FileSource = 
  | { type: 'vector'; score: number }           // Vector DB semantic search
  | { type: 'keyword'; matches: number }        // Keyword text search
  | { type: 'git-changed' }                     // Git working tree changes
  | { type: 'import-graph'; connectedTo: string[] }; // Import dependency connection

/**
 * File with detailed source information
 */
export interface FileWithSource {
  path: string;
  sources: FileSource[];          // Multiple sources possible
  priority: 'high' | 'normal';    // Overall priority (high = Git changed)
  hasLocalChanges: boolean;       // Has uncommitted changes
}

/**
 * Search result from a single strategy
 */
export interface SearchResult {
  files: Array<{
    path: string;
    source: FileSource;
  }>;
  strategy: 'vector' | 'keyword';
}

/**
 * Code context with version information
 */
export interface CodeContext {
  code: string;                   // Current working tree (formatted)
  codeHead?: string;              // Git HEAD version (for changed files only)
  files: FileWithSource[];        // Files with source tracking
  strategy: 'hybrid';             // Always hybrid now
  lessons?: Array<{               // Lessons from unified search
    content: string;
    score: number;
    relatedFiles: string[];
    tags: string[];
    timestamp: string;
    directive?: string;
  }>;
  stats: {
    filesLoaded: number;
    filesChanged: number;         // Number of files with local changes
    estimatedTokens: number;
    sourceBreakdown: {            // Source statistics
      vectorSearch: number;
      keywordSearch: number;
      gitChanged: number;
      importGraph: number;
    };
  };
}

/**
 * Retrieve options
 */
export interface RetrieveOptions {
  project?: string;               // ✅ Project name for Vector DB namespace
  mode?: 'generate' | 'refactor' | 'explain';  // ✅ Code mode for optimization
  maxTokens?: number;             // Max tokens to load (default: 100K ~75KB)
  maxFiles?: number;              // Max number of files (default: 15)
  exclude?: string[];             // Patterns to exclude
  includeContext?: boolean;       // Include surrounding files (default: true)
  useAST?: boolean;               // Use AST analysis (default: true)
  useImportGraph?: boolean;       // Use import graph (default: true)
  cache?: any;                    // Optional cache instance
}

/**
 * Batch result for streaming
 */
export interface BatchResult {
  batchNumber: number;
  files: string[];
  code: string;
  estimatedTokens: number;
}

/**
 * Batch retrieve options
 */
export interface BatchRetrieveOptions {
  batchSize?: number;
  maxBatches?: number;
  maxTokensPerBatch?: number;
  exclude?: string[];
  strategy?: 'ast' | 'grep';
}

