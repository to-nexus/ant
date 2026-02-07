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

/**
 * Detect and auto-correct common path mistakes made by LLM
 * 
 * Common mistakes:
 * 1. app/page.tsx → codebase/app/page.tsx (missing codebase/ prefix)
 * 2. src/app/page.tsx → codebase/app/page.tsx (wrong Next.js structure)
 * 3. features/xxx/codebase/... → codebase/... (codebase is at project root)
 * 
 * Returns corrected path and logs warning
 */
function autoCorrectCodebasePath(rawPath: string): { corrected: string; wasFixed: boolean; reason?: string } {
  const normalized = normalizeRel(rawPath);
  
  // Pattern 1: features/<feature>/codebase/... → codebase/...
  // This is a critical error - LLM thinks codebase is inside features
  const featureCodebaseMatch = normalized.match(/^features\/[^/]+\/codebase\/(.+)$/);
  if (featureCodebaseMatch) {
    const corrected = `codebase/${featureCodebaseMatch[1]}`;
    console.warn(`\n⚠️  [PATH AUTO-FIX] Detected wrong path structure!`);
    console.warn(`   ❌ Requested: ${normalized}`);
    console.warn(`   ✅ Corrected: ${corrected}`);
    console.warn(`   💡 Reason: codebase/ is at PROJECT ROOT, not inside features/\n`);
    return { corrected, wasFixed: true, reason: 'codebase is at project root, not inside features' };
  }
  
  // Pattern 2: src/app/... or src/components/... (common Next.js confusion)
  // Only fix if it looks like a typical frontend file
  if (normalized.startsWith('src/') && !normalized.startsWith('src/test')) {
    const withoutSrc = normalized.substring(4); // remove 'src/'
    const corrected = `codebase/${withoutSrc}`;
    console.warn(`\n⚠️  [PATH AUTO-FIX] Detected src/ prefix (not used in this project)`);
    console.warn(`   ❌ Requested: ${normalized}`);
    console.warn(`   ✅ Corrected: ${corrected}`);
    console.warn(`   💡 Reason: This project uses codebase/app/, not src/app/\n`);
    return { corrected, wasFixed: true, reason: 'project uses codebase/, not src/' };
  }
  
  // Pattern 3: app/... or components/... without codebase/ prefix
  // Common frontend directories that should be under codebase/
  const frontendDirs = ['app/', 'components/', 'public/', 'styles/', 'lib/', 'utils/', 'hooks/', 'pages/', 'frontend/'];
  for (const dir of frontendDirs) {
    if (normalized.startsWith(dir) && !normalized.startsWith('codebase/')) {
      const corrected = `codebase/${normalized}`;
      console.warn(`\n⚠️  [PATH AUTO-FIX] Missing codebase/ prefix`);
      console.warn(`   ❌ Requested: ${normalized}`);
      console.warn(`   ✅ Corrected: ${corrected}`);
      console.warn(`   💡 Reason: All code files must be under codebase/\n`);
      return { corrected, wasFixed: true, reason: 'code files must be under codebase/' };
    }
  }
  
  // Pattern 4: Common config files without codebase/ prefix
  const configFiles = ['package.json', 'tsconfig.json', 'next.config', 'tailwind.config', 'postcss.config', '.eslintrc', '.gitignore'];
  for (const configFile of configFiles) {
    if (normalized === configFile || normalized.startsWith(`${configFile.split('.')[0]}.`)) {
      const corrected = `codebase/${normalized}`;
      console.warn(`\n⚠️  [PATH AUTO-FIX] Config file missing codebase/ prefix`);
      console.warn(`   ❌ Requested: ${normalized}`);
      console.warn(`   ✅ Corrected: ${corrected}`);
      console.warn(`   💡 Reason: Config files are inside codebase/\n`);
      return { corrected, wasFixed: true, reason: 'config files are inside codebase/' };
    }
  }
  
  return { corrected: normalized, wasFixed: false };
}

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
    // Still apply auto-correction for absolute paths converted to relative
    const { corrected } = autoCorrectCodebasePath(fsPath);
    return { displayPath: corrected, fsPath: corrected, scope: 'workspace' };
  }

  const rel = normalizeRel(rawPath);
  
  // ✅ Apply auto-correction for common LLM path mistakes
  const { corrected, wasFixed, reason } = autoCorrectCodebasePath(rel);
  
  if (wasFixed) {
    // Track the correction for debugging/learning
    console.log(`[resolveToolPath] Auto-corrected path: ${rel} → ${corrected}`);
  }
  
  return { displayPath: corrected, fsPath: corrected, scope: 'workspace' };
}

export async function resolveToolDirectory(
  state: ArchitectGraphState,
  rawDir: string | undefined
): Promise<ResolvedToolPath> {
  const dir = rawDir ?? '.';
  return resolveToolPath(state, dir);
}

