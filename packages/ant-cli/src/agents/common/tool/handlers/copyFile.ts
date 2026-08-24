/**
 * copy_file handler — byte-faithful file placement.
 *
 * The ONLY path by which an agent can put a binary file into the codebase.
 * Every authoring surface (`create_file`, `append_file`, `edit_file`) funnels
 * through `FileSystemAdapter.writeFile(content: string)` and writes as utf-8,
 * so binary targets are hard-refused there — and a utf-8 decode→re-encode round
 * trip is irreversible (valid-crating-prawn: a 119KB `.glb` came back 198KB,
 * saturated with U+FFFD, and the loader silently fell back to a primitive).
 *
 * Before this tool existed, `writeBufferVerified` — the byte-safe SSOT — was
 * reachable only from the HTTP upload routes and design's `download_asset`, so a
 * code job had no way at all to place an asset the user had supplied
 * (level-dashing-plumb). The plan phase could *declare* the placement via
 * `implementation.assets[]` and nothing could carry it out.
 *
 * The source is verified too, not just the write: placing an already-corrupt
 * file would reproduce the original incident one layer down, with the copy
 * reported as success.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import type { ToolExecutionContext, ToolResult, ToolSideEffect } from '../types';
import { WorkspacePathResolver } from '../../../../core/config/WorkspacePathResolver';
import { toBaseRelative, readBufferContainedBase } from '../../../../core/config/containedIo';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { rejectCodebaseMutate, shouldRejectCodebaseMutate } from './codebaseGate';
import { verifyBufferIntegrity, writeBufferVerifiedContained, CorruptedFileError } from '../../../../core/utils/binaryIntegrity';
import { formatByteSize } from '../../../../core/utils/binaryExtensions';

export async function handleCopyFile(
  ctx: ToolExecutionContext,
  args: { source?: string; destination?: string },
): Promise<ToolResult> {
  const { source, destination } = args;

  if (!source || !destination) {
    const msg = 'copy_file requires both source and destination';
    return { content: msg, error: msg };
  }

  try {
    const resolvedSource = await resolveToolPath(ctx, source);
    const resolvedDest = await resolveToolPath(ctx, destination);

    if (shouldRejectCodebaseMutate(ctx, resolvedDest)) {
      const rejection = rejectCodebaseMutate('copy_file', resolvedDest);
      await ctx.chatStatus.failFileCreation(resolvedDest.displayPath, rejection.error);
      return rejection;
    }

    const root = ctx.fileSystem.getRootPath();
    const srcAbs = path.resolve(root, resolvedSource.fsPath);
    const destAbs = path.resolve(root, resolvedDest.fsPath);

    if (srcAbs === destAbs) {
      const msg = `copy_file source and destination are the same path (${resolvedSource.displayPath}) — nothing to copy.`;
      return { content: msg, error: msg };
    }

    // Descriptor-contained source read when in the multi-tenant base
    // (M-NEW-005/024 posture); raw read only outside it (repoType:'local').
    let buffer: Buffer | undefined;
    const srcBr = toBaseRelative(WorkspacePathResolver.getPhysicalWorkspacesPath(), srcAbs);
    if (srcBr) {
      const res = readBufferContainedBase(srcBr);
      if (res.ok) buffer = res.bytes;
    } else {
      buffer = await fs.readFile(srcAbs).catch(() => undefined);
    }
    if (!buffer) {
      const msg =
        `copy_file source not found: ${resolvedSource.displayPath}\n` +
        `Use list_files("${path.dirname(resolvedSource.displayPath)}") to see what is actually there. ` +
        `A source must be a file that already exists — copy_file places existing bytes, it cannot author them.`;
      return { content: msg, error: msg };
    }

    // Reject a corrupt SOURCE before writing. Placing known-bad bytes and
    // reporting success is the failure this tool exists to end.
    const sourceDefect = verifyBufferIntegrity(resolvedSource.displayPath, buffer);
    if (sourceDefect) {
      const msg =
        `copy_file refused: source ${resolvedSource.displayPath} is corrupted — ${sourceDefect}\n` +
        `Do NOT copy it and do NOT substitute a placeholder. Report the corrupted source so it can be re-supplied.`;
      await ctx.chatStatus.failFileCreation(resolvedDest.displayPath, msg);
      return { content: msg, error: msg };
    }

    const existed = await fs
      .stat(destAbs)
      .then((s) => s.isFile())
      .catch(() => false);

    // writeBufferVerifiedContained: descriptor-bound mkdir -p + byte-faithful
    // write + written-size verification, root-reparent-safe (H-017), failing
    // loud rather than leaving a bad asset in place.
    await writeBufferVerifiedContained(root, destAbs, buffer);

    const sizeLabel = formatByteSize(buffer.length);
    console.log(
      `✅ [CopyFile] ${resolvedSource.displayPath} → ${resolvedDest.displayPath} (${sizeLabel}${existed ? ', overwrote existing' : ''})`,
    );

    await ctx.chatStatus.showStatus('copied_file', {
      source: resolvedSource.displayPath,
      destination: resolvedDest.displayPath,
      size: buffer.length,
      overwrote: existed,
    });
    ctx.recordFileTouch?.(existed ? 'update' : 'create', resolvedDest.displayPath);

    const sideEffects: ToolSideEffect[] = [
      existed
        ? { type: 'fileModified', path: resolvedDest.displayPath }
        : { type: 'fileCreated', path: resolvedDest.displayPath },
    ];

    const verb = existed ? 'Replaced' : 'Placed';
    const resultMsg =
      `${verb} ${resolvedDest.displayPath} with a byte-for-byte copy of ${resolvedSource.displayPath} (${sizeLabel}). ` +
      `Integrity verified. Reference the destination path from code.`;

    return {
      content: prependFixMessage(resolvedDest, prependFixMessage(resolvedSource, resultMsg)),
      sideEffects,
    };
  } catch (e) {
    const errorMsg =
      e instanceof CorruptedFileError
        ? `copy_file failed integrity verification: ${e.message}`
        : (e as Error).message;
    await ctx.chatStatus.failFileCreation(destination, errorMsg);
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
