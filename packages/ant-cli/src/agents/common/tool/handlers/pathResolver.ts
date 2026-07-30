/**
 * Tool Path Resolution — extracted from Code job's handler utils
 *
 * Resolves and auto-corrects paths relative to project root (via FileSystemPort).
 * Works with ToolExecutionContext instead of graph state.
 */

import { normalizeToCodebasePath, normalizeRelPath } from '../../../../core/utils/pathNormalizer';
import type { ToolExecutionContext } from '../types';

export interface ResolvedToolPath {
  displayPath: string;
  fsPath: string;
  scope: 'workspace' | 'repo';
  wasFixed: boolean;
  fixMessage?: string;
}

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
  ctx: ToolExecutionContext,
  rawPath: string,
): Promise<ResolvedToolPath> {
  const fileSystem = ctx.fileSystem;
  const p = await import('path');
  const projectRoot = fileSystem.getRootPath();

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

export async function resolveToolDirectory(
  ctx: ToolExecutionContext,
  rawDir: string | undefined,
): Promise<ResolvedToolPath> {
  // Workspace-root listing ('' / '.') is a legitimate read and must NOT fall
  // into normalizeToCodebasePath's Rule 4 catch-all (which rewrites it to
  // `codebase/.`). Listing the feature root is how an agent discovers the
  // sibling artifact trees (plan/ architecture/ visual/ assets/ meta/) —
  // the silent redirect made attached workspace assets undiscoverable
  // (fierce-gaining-gully). Rule 4 stays authoritative for FILE paths; the
  // RAC gate (`decideRacGate`) still classifies '.' via its own
  // normalization and allows it — that divergence is intentional (gate:
  // allow, handler: list the actual root).
  const rel = normalizeRelPath(rawDir ?? '.');
  if (rel === '' || rel === '.') {
    return { displayPath: '.', fsPath: '.', scope: 'workspace', wasFixed: false };
  }
  return resolveToolPath(ctx, rawDir ?? '.');
}

export function prependFixMessage(resolved: ResolvedToolPath, result: string): string {
  if (resolved.wasFixed && resolved.fixMessage) {
    return `${resolved.fixMessage}\n\n${result}`;
  }
  return result;
}
