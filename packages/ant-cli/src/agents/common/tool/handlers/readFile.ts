/**
 * read_file handler — context-injected version
 */

import * as path from 'path';
import type { ToolExecutionContext, ToolResult } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { isBinaryPath } from '../../../../core/utils/binaryExtensions';

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

  const mergeIndex = await ctx.chatStatus.addReadingFile(resolved.displayPath);

  try {
    console.log(`[readFile] Reading file: ${resolved.displayPath} (fsPath: ${resolved.fsPath})`);
    const fileContent = await fileSystem.readFile(resolved.fsPath);

    if (!fileContent) {
      const errorMsg = `File not found: ${resolved.displayPath}`;
      console.error(`[readFile] ❌ ${errorMsg}`);
      await ctx.chatStatus.addReadComplete(resolved.displayPath, mergeIndex, errorMsg);
      return { content: errorMsg, error: errorMsg };
    }

    console.log(`[readFile] ✅ Read from disk: ${resolved.displayPath} (${fileContent.length} bytes)`);
    await ctx.chatStatus.addReadComplete(resolved.displayPath, mergeIndex);

    let result: string;
    if (startLine || endLine) {
      const lines = fileContent.split('\n');
      const totalLines = lines.length;
      const start = Math.max(1, startLine || 1);
      const end = Math.min(totalLines, endLine || totalLines);
      const slice = lines.slice(start - 1, end).join('\n');
      result = prependFixMessage(resolved, `[Lines ${start}-${end} of ${totalLines}]\n\n${slice}`);
    } else {
      result = prependFixMessage(resolved, fileContent);
    }

    return { content: result };
  } catch (e) {
    const errorMsg = (e as Error).message;
    console.error(`[readFile] ❌ Error:`, errorMsg);
    await ctx.chatStatus.addReadComplete(resolved.displayPath, mergeIndex, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
