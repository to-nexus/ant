/**
 * read_file handler — context-injected version.
 *
 * Contract:
 *   - Path goes through `resolveToolPath` → `normalizeToCodebasePath` SSOT
 *     (the same path the entire workspace tool surface uses).
 *   - Range arguments (`startLine`/`endLine`, 1-based, inclusive) slice
 *     the result; clamped to file length, `start > end` rejected.
 *   - Full reads of files larger than `READ_FILE_FULL_READ_LIMIT` are
 *     refused with a range-instruction error rather than silently
 *     truncated. The Compact ↔ Decompact cycle relies on this — the
 *     prompt-side compacted outline emits `L{N}: <heading>` markers and
 *     the LLM is expected to re-issue with that line number as
 *     `startLine` instead of pulling 100K+ chars in one shot.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ToolExecutionContext, ToolResult } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { isBinaryPath } from '../../../../core/utils/binaryExtensions';

/**
 * Threshold above which a `read_file` call without `startLine`/`endLine`
 * is rejected. Files within this size return the full content unchanged.
 * Previously enforced only inside decompose's own discoveryTools fork —
 * lifted here so every read_file caller (decompose, worker tool loop,
 * design source-selector, etc.) shares the same anti-context-blowout
 * contract.
 */
export const READ_FILE_FULL_READ_LIMIT = 100_000;

export async function handleReadFile(
  ctx: ToolExecutionContext,
  args: { path: string; startLine?: number; endLine?: number },
): Promise<ToolResult> {
  const { path: filePath, startLine, endLine } = args;

  if (!filePath) {
    return { content: 'read_file requires path', error: 'read_file requires path' };
  }

  if (isBinaryPath(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    console.log(`[readFile] ⚠️ Binary file detected: ${filePath} (${ext})`);
    const content = `[Binary file: ${filePath}]\nThis is a binary file (${ext}) and cannot be read as text.\n\nTo check if file exists: use list_files("${path.dirname(filePath)}")\nTo use in code: reference the path directly (e.g., url('${filePath}') or <img src="${filePath}" />)\nTo copy: use run_command("cp source dest")\n\nProceed with your next action.`;
    return { content };
  }

  const fileSystem = ctx.fileSystem;
  const resolved = await resolveToolPath(ctx, filePath);

  const isDir = await fileSystem.isDirectory(resolved.fsPath);
  if (isDir) {
    const content = `Path is a directory, not a file: ${resolved.displayPath}\n\n` +
      `To see files in this directory: use list_files("${resolved.displayPath}")\n` +
      `To read a specific file: use read_file("${resolved.displayPath}/filename")`;
    return { content };
  }

  const hasRange = typeof startLine === 'number' || typeof endLine === 'number';

  // Stat-first oversized check — refusing BEFORE reading avoids pulling
  // a huge file into memory just to discard it. The absolute path is
  // routed through the port's traversal-protected resolver so this
  // direct fs touch stays inside the workspace boundary.
  if (!hasRange) {
    try {
      const absPath = fileSystem.resolveAbsolute(resolved.fsPath);
      const stat = fs.statSync(absPath);
      if (stat.size > READ_FILE_FULL_READ_LIMIT) {
        const errorMsg =
          `Error: File too large for full read (${stat.size.toLocaleString()} bytes). ` +
          `Use \`read_file("${resolved.displayPath}", startLine, endLine)\` to read a specific range. ` +
          `Compacted documents in the prompt include line-numbered outlines ` +
          `(\`L{N}: <heading>\`) — pass those line numbers as startLine.`;
        console.error(`[readFile] ${errorMsg}`);
        return { content: errorMsg, error: errorMsg };
      }
    } catch {
      // statSync failure (file missing / permission) falls through to
      // fileSystem.readFile which produces the canonical "not found"
      // error path below. Never swallow into a misleading oversized
      // error.
    }
  } else if (typeof startLine === 'number' && typeof endLine === 'number' && startLine > endLine) {
    const errorMsg = `Error: startLine (${startLine}) > endLine (${endLine}) for ${resolved.displayPath}.`;
    return { content: errorMsg, error: errorMsg };
  }

  const mergeIndex = await ctx.chatStatus.addReadingFile(resolved.displayPath, startLine, endLine);

  try {
    console.log(`[readFile] Reading file: ${resolved.displayPath} (fsPath: ${resolved.fsPath})`);
    const fileContent = await fileSystem.readFile(resolved.fsPath);

    if (!fileContent) {
      const errorMsg = `File not found: ${resolved.displayPath}`;
      console.error(`[readFile] ❌ ${errorMsg}`);
      await ctx.chatStatus.addReadComplete(resolved.displayPath, mergeIndex, { error: errorMsg });
      return { content: errorMsg, error: errorMsg };
    }

    console.log(`[readFile] ✅ Read from disk: ${resolved.displayPath} (${fileContent.length} bytes)`);

    let result: string;
    if (hasRange) {
      const lines = fileContent.split('\n');
      const totalLines = lines.length;
      const start = Math.max(1, startLine || 1);
      const end = Math.min(totalLines, endLine || totalLines);
      const slice = lines.slice(start - 1, end).join('\n');
      await ctx.chatStatus.addReadComplete(resolved.displayPath, mergeIndex, {
        startLine: start,
        endLine: end,
        totalLines,
      });
      result = prependFixMessage(resolved, `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}`);
    } else {
      await ctx.chatStatus.addReadComplete(resolved.displayPath, mergeIndex);
      result = prependFixMessage(resolved, fileContent);
    }

    return { content: result };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`[readFile] ❌ Error:`, errorMsg);
    await ctx.chatStatus.addReadComplete(resolved.displayPath, mergeIndex, { error: errorMsg });
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
