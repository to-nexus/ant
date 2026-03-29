/**
 * Agent & Project Types
 * 
 * Defines agent job types, codebase profiles, task artifacts, and project context.
 * These are fundamental to how agents interact with the codebase.
 */

import type { ParsedUiDocs } from './uiDoc';
import type { EnvironmentDetection } from './environment';

// ============================================
// Agent Job Types
// ============================================

/**
 * All agent job types in the system.
 * For task-decomposable jobs only, use JobType/DecomposableJobType from task.ts
 */
export type AgentJob = 'design' | 'code' | 'learn' | 'ask' | 'review' | 'plan' | 'doc';

// ============================================
// Codebase Profile
// ============================================

/** Detected language, framework, and environment information */
export interface CodebaseProfile {
  language: string;
  framework?: string;
  version?: string;
  packageManager?: string;
  environment?: EnvironmentDetection;
  [key: string]: any;
}

// ============================================
// Task Artifacts
// ============================================

/** Common input materials for both design and code tasks */
export interface TaskArtifacts {
  prd?: string;
  /** All text files from inputs/sources/ keyed by filename. */
  sourceDocuments?: Record<string, string>;
  prdSpec?: string;
  directive?: string;
  design?: string;
  designDocPath?: string;
  code?: string;
  parsedUiDocs?: ParsedUiDocs;
  profile?: CodebaseProfile;
  lessons?: any;
  hasUiDoc?: boolean;
  isSpecDriven?: boolean;
  figmaAvailable?: boolean;
  figmaStartNodeId?: string;
}

// ============================================
// Project Context
// ============================================

/** All metadata about current project and workspace */
export interface ProjectContext {
  project: string;
  workingDir: string;
  memory?: string;
  userLanguage?: 'en' | 'ko' | 'ja' | 'zh';
  [key: string]: any;
}

// ============================================
// Vector DB Collection
// ============================================

/** Types of collections in the vector database */
export type CollectionType = 
  | 'codebase'     // Source code chunks
  | 'lessons'      // Learned patterns
  | 'context';     // User preferences (future)

/** Get collection name from type and project */
export function getCollectionName(type: CollectionType, project: string): string {
  return `${type}-${project}`;
}
