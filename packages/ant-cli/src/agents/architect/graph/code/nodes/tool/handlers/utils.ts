/**
 * Common utilities for tool handlers
 */

import { ArchitectGraphState } from '../../../state';
import { FileSystemPort } from '../../../../../../../core/ports/filesystem';
import { normalizeToCodebasePath, normalizeRelPath } from '../../../../../../../core/utils/pathNormalizer';

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
  /** True if the path was auto-corrected (e.g., missing codebase/ prefix) */
  wasFixed: boolean;
  /** Human-readable correction message to prepend to tool result */
  fixMessage?: string;
};

/**
 * Detect and auto-correct common path mistakes made by LLM.
 * 
 * Delegates to the shared normalizeToCodebasePath() function to ensure
 * read paths (tool handlers) and write paths (FileRenderer) are consistent.
 * 
 * Common mistakes corrected:
 * 1. app/page.tsx → codebase/app/page.tsx (missing codebase/ prefix)
 * 2. src/app/page.tsx → codebase/src/app/page.tsx (preserve src/, prepend codebase/)
 * 3. features/xxx/codebase/... → codebase/... (codebase is at project root)
 * 
 * CRITICAL: src/ is NEVER stripped. It is a valid project directory.
 * Stripping src/ caused read/write path mismatches and duplicate file creation.
 */
function autoCorrectCodebasePath(rawPath: string): { corrected: string; wasFixed: boolean; reason?: string } {
  const result = normalizeToCodebasePath(rawPath);

  if (result.wasFixed) {
    console.warn(`\n⚠️  [PATH AUTO-FIX] ${result.reason}`);
    console.warn(`   ❌ Requested: ${normalizeRelPath(rawPath)}`);
    console.warn(`   ✅ Corrected: ${result.normalized}\n`);
  }

  return { corrected: result.normalized, wasFixed: result.wasFixed, reason: result.reason };
}

export async function resolveToolPath(
  state: ArchitectGraphState,
  rawPath: string
): Promise<ResolvedToolPath> {
  const fileSystem = state.deps?.fileSystem;
  if (!fileSystem) {
    return { displayPath: rawPath, fsPath: rawPath, scope: 'workspace', wasFixed: false };
  }

  const p = await import('path');
  const projectRoot = fileSystem.getRootPath();

  // Absolute path: make it project-root relative
  if (p.isAbsolute(rawPath)) {
    const fsPath = normalizeRelPath(p.relative(projectRoot, rawPath));
    const { corrected, wasFixed } = autoCorrectCodebasePath(fsPath);
    const fixMessage = wasFixed
      ? `⚠️ Path corrected: "${fsPath}" → "${corrected}". Always use codebase/ prefix for code files.`
      : undefined;
    return { displayPath: corrected, fsPath: corrected, scope: 'workspace', wasFixed, fixMessage };
  }

  const rel = normalizeRelPath(rawPath);
  
  const { corrected, wasFixed } = autoCorrectCodebasePath(rel);
  const fixMessage = wasFixed
    ? `⚠️ Path corrected: "${rel}" → "${corrected}". Always use codebase/ prefix for code files.`
    : undefined;
  
  if (wasFixed) {
    console.log(`[resolveToolPath] Auto-corrected path: ${rel} → ${corrected}`);
  }
  
  return { displayPath: corrected, fsPath: corrected, scope: 'workspace', wasFixed, fixMessage };
}

/**
 * Prepend path correction feedback to a tool result string.
 * If the path was auto-corrected, the LLM sees the correction so it learns
 * to use codebase/ prefix in subsequent calls.
 */
export function prependFixMessage(resolved: ResolvedToolPath, result: string): string {
  if (resolved.wasFixed && resolved.fixMessage) {
    return `${resolved.fixMessage}\n\n${result}`;
  }
  return result;
}

export async function resolveToolDirectory(
  state: ArchitectGraphState,
  rawDir: string | undefined
): Promise<ResolvedToolPath> {
  const dir = rawDir ?? '.';
  return resolveToolPath(state, dir);
}

