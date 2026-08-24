/**
 * read_reference_file handler — read one file from a registered reference
 * project (sibling ANT project). Read-only. Path is relative to that project's
 * codebase root. dir-mode uses a scoped FileSystemAdapter (traversal-guarded);
 * git-mode reads the tree-ish via `git show`.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { AdapterFactory } from '../../../../infrastructure/adapters/AdapterFactory';
import { isBinaryPath } from '../../../../core/utils/binaryExtensions';
import { sniffToolFile } from './containedToolMeta';
import { getRefDeps, isRegistered, notRegisteredError } from '../reference/handlerSupport';
import { resolveReferenceCodebase, ReferenceTargetError } from '../reference/resolve';
import { refGitRead, RefGitTooLargeError } from '../reference/refGit';

const READ_REFERENCE_FULL_READ_LIMIT = 100_000;
// A range read still materialises the whole object before slicing, so it needs
// its own pre-read ceiling (M-032).
const READ_REFERENCE_RANGE_MAX_BYTES = 10_000_000;

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
    const resolution = await resolveReferenceCodebase(
      deps.workspaceResolver,
      deps.userContext,
      { project, branch },
      ctx.project,
    );

    const hasRange = typeof startLine === 'number' || typeof endLine === 'number';
    // A range read still buffers the whole object, so bound the pre-read for
    // both modes (M-032): the larger ceiling for range, the full-read cap
    // otherwise.
    const preReadLimit = hasRange ? READ_REFERENCE_RANGE_MAX_BYTES : READ_REFERENCE_FULL_READ_LIMIT;

    let content: string;
    if (resolution.mode === 'git') {
      try {
        content = await refGitRead(resolution.gitDir, resolution.ref, filePath, preReadLimit);
      } catch (e) {
        if (e instanceof RefGitTooLargeError) {
          const msg =
            `Error: reference file too large (${e.size.toLocaleString()} bytes; limit ${e.limit.toLocaleString()}). ` +
            (hasRange ? 'Narrow the file before reading.' : 'Re-issue with startLine/endLine to read a range.');
          return { content: msg, error: msg };
        }
        throw e;
      }
    } else {
      const adapter = AdapterFactory.createFileSystemAdapterWithPath(resolution.absPath);
      const isDir = await adapter.isDirectory(filePath);
      if (isDir) {
        return {
          content: `Path is a directory: ${filePath}. Use list_reference_files({ project: "${project}", directory: "${filePath}" }).`,
        };
      }
      // Content sniff — parity with read_file's two-tier gate: catches binary
      // formats the extension set doesn't know. Missing paths fall through to
      // the canonical not-found reply below. The sniff also yields the size, so
      // an oversized object is refused BEFORE it is read into memory (M-032).
      try {
        const sniffed = sniffToolFile(adapter.resolveAbsolute(filePath));
        if (sniffed.binary) {
          return { content: `[Binary file: ${filePath}] cannot be read as text.` };
        }
        if (sniffed.size !== undefined && sniffed.size > preReadLimit) {
          const msg =
            `Error: reference file too large (${sniffed.size.toLocaleString()} bytes; limit ${preReadLimit.toLocaleString()}). ` +
            (hasRange ? 'Narrow the file before reading.' : 'Re-issue with startLine/endLine to read a range.');
          return { content: msg, error: msg };
        }
      } catch {
        // resolveAbsolute failure → normal read path surfaces the error.
      }
      const read = await adapter.readFile(filePath);
      if (read == null) {
        const msg = `File not found in "${project}": ${filePath}`;
        return { content: msg, error: msg };
      }
      content = read;
    }

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
