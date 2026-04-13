/**
 * search_code handler — context-injected version
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { resolveToolDirectory, prependFixMessage } from './pathResolver';

function matchFilePattern(filePath: string, pattern: string): boolean {
  const p = pattern.replace(/\\/g, '/');

  if (p.startsWith('.') && !p.includes('/')) {
    return filePath.endsWith(p);
  }

  if (p.endsWith('/')) {
    return filePath.includes(p);
  }

  if (p.includes('*')) {
    const regexStr = p
      .replace(/\*\*\//g, '(.+/)?')
      .replace(/\*/g, '[^/]*');
    const regex = new RegExp(`(^|/)${regexStr}$`);
    return regex.test(filePath);
  }

  return filePath.includes(p);
}

export async function handleSearchCode(
  ctx: ToolExecutionContext,
  args: { pattern: string; file_pattern?: string },
): Promise<ToolResult> {
  const { pattern, file_pattern } = args;

  if (!pattern) {
    return { content: 'search_code requires pattern', error: 'search_code requires pattern' };
  }

  const fileSystem = ctx.fileSystem;

  const wantsWorkspaceScope = (() => {
    const fp = (file_pattern || '').replace(/\\/g, '/').replace(/^\.?\//, '');
    return fp.startsWith('features/') || fp.startsWith('inputs/') || fp.startsWith('outputs/') || fp.startsWith('sessions/');
  })();
  const resolvedRoot = await resolveToolDirectory(ctx, wantsWorkspaceScope ? 'features' : '.');

  const searchingIndex = await ctx.chatStatus.showStatus('searching_code', { pattern, file_pattern });

  try {
    const segments = resolvedRoot.fsPath.split('/');
    const isInsideDeps = segments.includes('node_modules') || segments.includes('vendor');
    const excludes = isInsideDeps
      ? ['.git']
      : ['node_modules', '.git', 'dist', 'build'];

    console.log(`[searchCode] Listing files: ${resolvedRoot.displayPath} (fsPath: ${resolvedRoot.fsPath}, excludes: ${excludes})`);

    const files = await fileSystem.listFiles(resolvedRoot.fsPath, excludes);
    console.log(`[searchCode] Found ${files.length} files total`);

    const filteredFiles = file_pattern
      ? files.filter(f => matchFilePattern(f, file_pattern))
      : files;

    console.log(`[searchCode] Filtered to ${filteredFiles.length} files (pattern: ${file_pattern || 'none'})`);

    const results: string[] = [];
    for (const file of filteredFiles.slice(0, 50)) {
      const content = await fileSystem.readFile(file);
      if (!content) continue;

      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (line.includes(pattern)) {
          results.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    console.log(`[searchCode] Found ${results.length} matches for "${pattern}"`);

    if (results.length === 0) {
      const errorMsg = `No matches found for pattern "${pattern}"${file_pattern ? ` in files matching "${file_pattern}"` : ''}`;
      console.error(`[searchCode] ❌ ${errorMsg}`);

      await ctx.chatStatus.showStatus('searched_code', {
        pattern,
        filesCount: 0,
        totalMatches: 0,
        filesList: [],
        error: errorMsg,
        _mergeIndex: searchingIndex,
      });

      return { content: errorMsg, error: errorMsg };
    }

    const matchedFiles = Array.from(new Set(results.map(r => r.split(':')[0])));
    await ctx.chatStatus.showStatus('searched_code', {
      pattern,
      filesCount: matchedFiles.length,
      totalMatches: results.length,
      filesList: matchedFiles,
      _mergeIndex: searchingIndex,
    });

    return { content: prependFixMessage(resolvedRoot, results.join('\n')) };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`[searchCode] ❌ Error:`, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
