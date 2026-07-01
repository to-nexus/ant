/**
 * read_reference_file handler — read one file from a registered reference
 * project (sibling ANT project). Read-only. Path is relative to that project's
 * codebase root. dir-mode uses a scoped FileSystemAdapter (traversal-guarded);
 * git-mode reads the tree-ish via `git show`.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { AdapterFactory } from '../../../../infrastructure/adapters/AdapterFactory';
import { isBinaryPath } from '../../../../core/utils/binaryExtensions';
import { getRefDeps, isRegistered, notRegisteredError } from '../reference/handlerSupport';
import { resolveReferenceCodebase, ReferenceTargetError } from '../reference/resolve';
import { refGitRead } from '../reference/refGit';

const READ_REFERENCE_FULL_READ_LIMIT = 100_000;

export async function handleReadReferenceFile(
  ctx: ToolExecutionContext,
  args: { project: string; path: string; branch?: string; startLine?: number; endLine?: number },
): Promise<ToolResult> {
  const { project, path: filePath, branch, startLine, endLine } = args;
  if (!project || !filePath) {
    const msg = 'read_reference_file requires "project" and "path"';
    return { content: msg, error: msg };
  }
  if (!isRegistered(ctx, project)) {
    const msg = notRegisteredError(project, ctx);
    return { content: msg, error: msg };
  }
  if (isBinaryPath(filePath)) {
    return { content: `[Binary file: ${filePath}] cannot be read as text.` };
  }

  const deps = getRefDeps(ctx);
  if ('error' in deps) return { content: deps.error, error: deps.error };

  try {
    const resolution = await resolveReferenceCodebase(deps.workspaceResolver, deps.userContext, {
      project,
      branch,
    });

    let content: string;
    if (resolution.mode === 'git') {
      content = await refGitRead(resolution.gitDir, resolution.ref, filePath);
    } else {
      const adapter = AdapterFactory.createFileSystemAdapterWithPath(resolution.absPath);
      const isDir = await adapter.isDirectory(filePath);
      if (isDir) {
        return {
          content: `Path is a directory: ${filePath}. Use list_reference_files({ project: "${project}", directory: "${filePath}" }).`,
        };
      }
      const read = await adapter.readFile(filePath);
      if (read == null) {
        const msg = `File not found in "${project}": ${filePath}`;
        return { content: msg, error: msg };
      }
      content = read;
    }

    const hasRange = typeof startLine === 'number' || typeof endLine === 'number';
    if (!hasRange && content.length > READ_REFERENCE_FULL_READ_LIMIT) {
      const msg =
        `Error: reference file too large for full read (${content.length.toLocaleString()} bytes). ` +
        `Re-issue with startLine/endLine to read a range.`;
      return { content: msg, error: msg };
    }

    if (hasRange) {
      const lines = content.split('\n');
      const total = lines.length;
      const start = Math.max(1, startLine || 1);
      const end = Math.min(total, endLine || total);
      if (start > end) {
        const msg = `Error: startLine (${start}) > endLine (${end}).`;
        return { content: msg, error: msg };
      }
      const slice = lines.slice(start - 1, end).join('\n');
      return { content: `[${project}] ${filePath} [lines ${start}-${end} of ${total}]\n\n${slice}` };
    }

    return { content: `[${project}] ${filePath}\n\n${content}` };
  } catch (e) {
    const msg = e instanceof ReferenceTargetError ? e.message : (e as Error).message;
    console.error(`[readReferenceFile] ❌ ${msg}`);
    return { content: `Error: ${msg}`, error: msg };
  }
}
