/**
 * Session Path Utilities
 * 
 * Centralized path construction for agent-nested session files.
 * All session path construction MUST go through these functions
 * to ensure consistent directory structure across the codebase.
 * 
 * Directory structure:
 *   sessions/
 *     architect/
 *       design.json
 *       code.json
 *       learn.json
 *       debug/
 *         prompts/
 *         plans/
 *         logs/
 *         asks/
 *     planner/
 *       plan.json
 *       debug/
 *     chat.json          ← UI-level, not agent-nested
 */

import * as fs from 'fs';
import * as path from 'path';
import type { JobType, SessionableJobType } from '@ant/shared';

// ============================================
// Agent-Job Mapping
// ============================================

/** Maps a job type to its owning agent */
const JOB_TO_AGENT: Record<string, string> = {
  code: 'architect',
  design: 'architect',
  learn: 'architect',
  ask: 'architect',      // ask debug logs go under architect
  plan: 'planner',
};

/**
 * Get the agent name that owns a given job type.
 * 
 * @param jobType - The job type
 * @returns Agent name (e.g., 'architect', 'planner')
 * @throws Error if job type has no known agent mapping
 */
export function getAgentForJob(jobType: string): string {
  const agent = JOB_TO_AGENT[jobType];
  if (!agent) {
    throw new Error(`Unknown job type for agent mapping: ${jobType}`);
  }
  return agent;
}

// ============================================
// Session File Paths
// ============================================

/**
 * Get the full path to a session JSON file.
 * 
 * @example getSessionFilePath('/path/to/feature', 'architect', 'design')
 *   → '/path/to/feature/sessions/architect/design.json'
 * 
 * @param featurePath - Absolute path to the feature directory
 * @param agent - Agent name (e.g., 'architect', 'planner')
 * @param job - Job name used as filename (e.g., 'design', 'plan')
 * @returns Absolute path to the session file
 */
export function getSessionFilePath(featurePath: string, agent: string, job: string): string {
  return path.join(featurePath, 'sessions', agent, `${job}.json`);
}

/**
 * Get the session file path using job type (auto-resolves agent).
 * 
 * @example getSessionFilePathByJob('/path/to/feature', 'design')
 *   → '/path/to/feature/sessions/architect/design.json'
 * 
 * @param featurePath - Absolute path to the feature directory
 * @param jobType - The job type
 * @returns Absolute path to the session file
 */
export function getSessionFilePathByJob(featurePath: string, jobType: string): string {
  const agent = getAgentForJob(jobType);
  return getSessionFilePath(featurePath, agent, jobType);
}

// ============================================
// Chat Session (not agent-nested)
// ============================================

/**
 * Get the path to the chat session file (UI-level, not agent-nested).
 * 
 * @param featurePath - Absolute path to the feature directory
 * @returns Absolute path to chat.json
 */
export function getChatSessionPath(featurePath: string): string {
  return path.join(featurePath, 'sessions', 'chat.json');
}

// ============================================
// Debug Directories
// ============================================

/**
 * Get the debug directory path for an agent.
 * 
 * @example getSessionDebugDir('/path/to/feature', 'architect', 'prompts')
 *   → '/path/to/feature/sessions/architect/debug/prompts'
 * 
 * @param featurePath - Absolute path to the feature directory
 * @param agent - Agent name
 * @param subdir - Debug subdirectory (e.g., 'prompts', 'plans', 'logs', 'asks')
 * @returns Absolute path to the debug subdirectory
 */
export function getSessionDebugDir(featurePath: string, agent: string, subdir: string): string {
  return path.join(featurePath, 'sessions', agent, 'debug', subdir);
}

// ============================================
// Sessions Directory
// ============================================

/**
 * Get the sessions root directory.
 * 
 * @param featurePath - Absolute path to the feature directory
 * @param agent - Optional agent name. If provided, returns agent subdirectory.
 * @returns Absolute path to sessions directory or agent subdirectory
 */
export function getSessionsDir(featurePath: string, agent?: string): string {
  if (agent) {
    return path.join(featurePath, 'sessions', agent);
  }
  return path.join(featurePath, 'sessions');
}

// ============================================
// Search Helpers (for resume/continue)
// ============================================

/** All agent-job pairs that have session files */
export const SESSION_SEARCH_MAP: Array<{ agent: string; job: SessionableJobType }> = [
  { agent: 'architect', job: 'code' },
  { agent: 'architect', job: 'design' },
  { agent: 'architect', job: 'learn' },
  { agent: 'planner', job: 'plan' },
];

/**
 * Get all session file paths for a feature (for resume/continue search).
 * 
 * @param featurePath - Absolute path to the feature directory
 * @returns Array of { path, agent, job } for all possible session files
 */
export function getAllSessionPaths(featurePath: string): Array<{ path: string; agent: string; job: SessionableJobType }> {
  return SESSION_SEARCH_MAP.map(({ agent, job }) => ({
    path: getSessionFilePath(featurePath, agent, job),
    agent,
    job,
  }));
}

// ============================================
// Canonical Feature Directories (Single Source of Truth)
// ============================================

/**
 * Complete list of canonical (system-managed) directories within a feature.
 * 
 * These directories are:
 * - Created automatically when a feature is initialized
 * - Preserved on delete (only files inside are removed, directory structure is kept)
 * - Non-canonical (user-created) directories within these are fully deleted
 * 
 * Used by:
 * - getInitFeatureDirs() — creates all canonical dirs on feature init
 * - FileOperationService — smart delete preserves canonical dirs
 */
export const CANONICAL_FEATURE_DIRS: ReadonlyArray<string> = [
  // inputs
  'inputs',
  'inputs/sources',
  'inputs/directives',
  'inputs/directives/design',
  'inputs/directives/code',
  'inputs/directives/learn',
  'inputs/assets',
  'inputs/references',
  // outputs
  'outputs',
  'outputs/design',
  'outputs/evals',
  'outputs/evals/prd',
  'outputs/evals/ui-design',
  'outputs/evals/system-design',
  'outputs/evals/code',
  // sessions
  'sessions',
  'sessions/architect',
  'sessions/architect/debug',
  'sessions/architect/debug/prompts',
  'sessions/architect/debug/plans',
  'sessions/architect/debug/logs',
  'sessions/architect/debug/tokens',
  'sessions/planner',
  'sessions/planner/debug',
  'sessions/planner/debug/prompts',
];

/** Set for O(1) lookup of canonical directories */
const CANONICAL_FEATURE_DIRS_SET = new Set(CANONICAL_FEATURE_DIRS);

/**
 * Check if a relative path is a canonical feature directory.
 * 
 * @param relativePath - Path relative to feature root (e.g., 'inputs/sources')
 * @returns true if the path is a canonical directory
 */
export function isCanonicalDir(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
  return CANONICAL_FEATURE_DIRS_SET.has(normalized);
}

// ============================================
// Init Directories (for feature creation)
// ============================================

/**
 * Get all session directories that should be created when initializing a feature.
 * Derived from CANONICAL_FEATURE_DIRS (sessions/* entries only).
 * 
 * @param featurePath - Absolute path to the feature directory
 * @returns Array of directory paths to create
 */
export function getInitSessionDirs(featurePath: string): string[] {
  return CANONICAL_FEATURE_DIRS
    .filter(d => d.startsWith('sessions/'))
    .map(d => path.join(featurePath, d));
}

/**
 * Get all canonical directories that should be created when initializing a feature.
 * Derived from CANONICAL_FEATURE_DIRS (all entries).
 * 
 * @param featurePath - Absolute path to the feature directory
 * @returns Array of absolute directory paths to create
 */
export function getInitFeatureDirs(featurePath: string): string[] {
  // 'codebase' is excluded from CANONICAL_FEATURE_DIRS to avoid polluting
  // FEATURE_SIBLING_PREFIXES (which would break pathNormalizer Rule 3).
  // It is added here so the directory is always created on feature init.
  // WorktreeService may later replace it with a git worktree.
  return [
    path.join(featurePath, 'codebase'),
    ...CANONICAL_FEATURE_DIRS.map(d => path.join(featurePath, d)),
  ];
}

// ============================================
// Canonical Directory Clearing (Single Source of Truth)
// ============================================

export interface ClearCanonicalDirectoryOptions {
  /** If true, skip the 'sessions' directory entirely (used by transfer operations) */
  skipSessions?: boolean;
}

/**
 * Clear a canonical directory's contents while preserving canonical structure.
 * 
 * This is the SINGLE implementation for "empty a directory" across the codebase.
 * All artifact folder clearing MUST use this function to ensure consistent behavior:
 * 
 * - Files: deleted
 * - Canonical subdirectories: recursively cleared (structure preserved)
 * - Non-canonical subdirectories: fully deleted (rm -rf), including all nested content
 * 
 * @param dirPath - Absolute path to the directory to clear
 * @param relativePath - Path relative to feature root (e.g., 'outputs/evals')
 * @param options - Optional behavior configuration
 */
export async function clearCanonicalDirectory(
  dirPath: string,
  relativePath: string,
  options?: ClearCanonicalDirectoryOptions,
): Promise<void> {
  let items: fs.Dirent[];
  try {
    items = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const itemRelPath = `${relativePath}/${item.name}`;

    if (options?.skipSessions && item.name === 'sessions') continue;

    if (item.isDirectory()) {
      if (isCanonicalDir(itemRelPath)) {
        await clearCanonicalDirectory(itemPath, itemRelPath, options);
      } else {
        await fs.promises.rm(itemPath, { recursive: true, force: true });
      }
    } else {
      await fs.promises.unlink(itemPath);
    }
  }
}
