import { ChunkStrategy } from "../types";

/**
 * Task-specific chunk policies
 * 
 * Defines optimal chunk strategies for different content types and tasks
 */

export type ChunkPolicyKey = 'learning-code' | 'learning-design' | 'code-analysis' | 'spec-parsing';

export const CHUNK_POLICIES: Record<ChunkPolicyKey, ChunkStrategy> = {
  /**
   * Policy for code generation learnings
   * - Preserve markdown structure (sections)
   * - Moderate chunk size for balanced context
   */
  'learning-code': {
    splitter: 'markdown',
    maxTokens: 500,
    overlapTokens: 50,
    preserveStructure: true
  },
  
  /**
   * Policy for design learnings
   * - Preserve markdown structure
   * - Larger chunks (design documents are more cohesive)
   */
  'learning-design': {
    splitter: 'markdown',
    maxTokens: 800,
    overlapTokens: 100,
    preserveStructure: true
  },
  
  /**
   * Policy for code analysis (codebase learning)
   * - AST-based splitting (functions, classes)
   * - Smaller chunks for precision
   */
  'code-analysis': {
    splitter: 'code',
    maxTokens: 300,
    overlapTokens: 30,
    preserveStructure: true
  },
  
  /**
   * Policy for spec/PRD parsing
   * - Markdown structure
   * - Large chunks (keep requirements together)
   */
  'spec-parsing': {
    splitter: 'markdown',
    maxTokens: 1000,
    overlapTokens: 150,
    preserveStructure: true
  }
};

/**
 * Get chunk strategy for a given task and content type
 */
export function getChunkStrategy(task: string, contentType: string): ChunkStrategy {
  const key: ChunkPolicyKey = `${contentType}-${task}` as ChunkPolicyKey;
  
  return CHUNK_POLICIES[key] || CHUNK_POLICIES['learning-code'];
}

