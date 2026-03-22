/**
 * Code Context Types
 * 
 * Standardized interfaces for codebase context across all nodes
 */

import { GitDiffSummary } from '../../codebase/GitDiffSummary';

/**
 * Base code context (common structure)
 */
export interface BaseCodeContext {
  filePaths: string[];
  files: Array<{
    path: string;
    content: string;
  }>;
  gitDiff?: GitDiffSummary;
  stats: {
    filesLoaded: number;
    estimatedTokens: number;
  };
}

/**
 * Main project code context
 * Source: decompose (paths only), plan (with content), or codeGen (accumulated)
 */
export interface ProjectCodeContext extends BaseCodeContext {
  source: 'decompose' | 'plan' | 'execute' | 'codeGen';
  directoryTree?: string;
}

/**
 * Reference project code context
 */
export interface ReferenceCodeContext extends BaseCodeContext {
  project: string;
  branch?: string;
}

/**
 * Aggregated code contexts for prompt
 */
export interface AggregatedCodeContexts {
  project?: ProjectCodeContext;
  references: ReferenceCodeContext[];
}

