/**
 * Common utilities for tool handlers
 */

import { ArchitectGraphState } from '../../../state';
import { FileSystemPort } from '../../../../../../../core/ports/filesystem';

/**
 * Validate and get FileSystemPort
 * Throws error with proper logging if not available
 */
export function getFileSystem(state: ArchitectGraphState, toolName: string): FileSystemPort {
  const fileSystem = state.deps?.fileSystem;
  
  if (!fileSystem) {
    const errorMsg = `FileSystemPort not available for ${toolName}`;
    console.error(`[${toolName}] ❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
  
  return fileSystem;
}

/**
 * Wrap tool execution with error handling and logging
 */
export async function withErrorHandling<T>(
  toolName: string,
  operation: () => Promise<T>,
  context?: Record<string, any>
): Promise<T> {
  try {
    if (context) {
      console.log(`[${toolName}] Executing with:`, context);
    }
    
    const result = await operation();
    console.log(`[${toolName}] ✅ Success`);
    return result;
    
  } catch (error: any) {
    console.error(`[${toolName}] ❌ Error:`, error.message);
    if (context) {
      console.error(`[${toolName}] Context:`, context);
    }
    throw error;  // Re-throw - will be stored in toolResults.error
  }
}

/**
 * Log file operation
 */
export function logFileOperation(
  toolName: string,
  operation: string,
  path: string,
  details?: Record<string, any>
): void {
  const detailsStr = details ? ` (${JSON.stringify(details)})` : '';
  console.log(`[${toolName}] ${operation}: ${path}${detailsStr}`);
}

/**
 * Tool Path Resolution - PROJECT ROOT based
 *
 * All paths are relative to PROJECT ROOT (e.g., ant-ogf/).
 * - codebase/... for code files
 * - features/<feature>/inputs/assets/... for assets
 *
 * Simple and consistent for LLM.
 */
export type ResolvedToolPath = {
  /** Path as-is (project-root relative) */
  displayPath: string;
  /** Same as displayPath - project root relative */
  fsPath: string;
  /** Always 'workspace' since everything is project-root relative */
  scope: 'workspace' | 'repo';
};

const normalizeRel = (s: string) => s.replace(/\\/g, '/').replace(/^\.?\//, '').trim();

export async function resolveToolPath(
  state: ArchitectGraphState,
  rawPath: string
): Promise<ResolvedToolPath> {
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) {
    return { displayPath: rawPath, fsPath: rawPath, scope: 'workspace' };
  }

  const p = await import('path');
  const projectRoot = fileSystem.getWorkspaceRoot();

  // Absolute path: make it project-root relative
  if (p.isAbsolute(rawPath)) {
    const fsPath = normalizeRel(p.relative(projectRoot, rawPath));
    return { displayPath: fsPath, fsPath, scope: 'workspace' };
  }

  const rel = normalizeRel(rawPath);
  return { displayPath: rel, fsPath: rel, scope: 'workspace' };
}

export async function resolveToolDirectory(
  state: ArchitectGraphState,
  rawDir: string | undefined
): Promise<ResolvedToolPath> {
  const dir = rawDir ?? '.';
  return resolveToolPath(state, dir);
}

