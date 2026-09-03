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
import type { ToolExecutionContext, ToolResult } from '../types';
import { resolveToolPath, prependFixMessage } from './pathResolver';
import { isBinaryPath, formatByteSize } from '../../../../core/utils/binaryExtensions';
import { sniffToolFile, statToolFileSize } from './containedToolMeta';
import { coerceLineRange } from './lineRange';
import { findInAntSourceRoots } from '../antSource/core';

/**
 * Threshold above which a `read_file` call without `startLine`/`endLine`
 * is rejected. Files within this size return the full content unchanged.
 * Previously enforced only inside decompose's own discoveryTools fork —
 * lifted here so every read_file caller (decompose, worker tool loop,
 * design source-selector, etc.) shares the same anti-context-blowout
 * contract.
 */
export const READ_FILE_FULL_READ_LIMIT = 100_000;
// A range read still materialises the whole file before slicing, so it needs its
// own pre-read ceiling — otherwise `read_file(path, 1, 5)` on a multi-GB file
// allocates the whole thing (M-032). Generous enough for real source/doc files,
// bounded enough to keep one tool call from exhausting the job heap.
export const READ_FILE_RANGE_MAX_BYTES = 10_000_000;

// Reporting the size is the point, not decoration: this is the moment the model
// reaches for a binary and is told no. With no number in the reply it invented
// one — a fabricated "193.8 KB" that propagated into a spec and was then used to
// justify a design decision (zero-hunting-label). Size is the only property of
// an unreadable file it can legitimately reason about, so it must be here.
function binaryFileMessage(displayPath: string, sizeBytes?: number): string {
  const ext = path.extname(displayPath).toLowerCase();
  const size = sizeBytes !== undefined ? formatByteSize(sizeBytes) : undefined;
  console.log(`[readFile] ⚠️ Binary file detected: ${displayPath} (${ext || 'no extension'}${size ? `, ${size}` : ''})`);
  return `[Binary file: ${displayPath}]\nThis is a binary file${ext ? ` (${ext})` : ''} and cannot be read as text.\n${
    size
      ? `size: ${size} — this is the ONLY size figure for this file; never state one that is not reported here.\n`
      : `size: unknown — do NOT state or estimate one.\n`
  }\nTo check if file exists: use list_files("${path.dirname(displayPath)}")\nTo use in code: reference the path directly (e.g., url('${displayPath}') or <img src="${displayPath}" />)\nTo copy: use copy_file(source, destination)\n\nProceed with your next action.`;
}

/**
 * Not-found fallback: probe for a UNIQUE single-segment insertion that makes
 * the path exist — the dominant miss shape is a citation that omits one
 * intermediate directory (`codebase/ant-ui/src/x.ts` for a monorepo whose real
 * layout is `codebase/packages/ant-ui/src/x.ts`; small-longing-drive burned 5
 * turns rediscovering the tree from exactly this). Same philosophy as the
 * NFC/NFD Stage-2 fallback: byte-exact resolution first, a uniquely-matching
 * tolerant resolve on the miss path, ambiguity reported instead of guessed.
 * Bounded: one readDirectory per existing prefix, fileExists per subdirectory.
 */
async function probeSegmentInsertion(
  ctx: ToolExecutionContext,
  displayPath: string,
): Promise<{ match?: string; candidates: string[] }> {
  const segs = displayPath.split('/').filter(Boolean);
  const candidates: string[] = [];
  if (segs.length < 2) return { candidates };
  for (let i = 1; i < segs.length && candidates.length < 4; i++) {
    const prefix = segs.slice(0, i).join('/');
    const rest = segs.slice(i).join('/');
    try {
      if (!(await ctx.fileSystem.isDirectory(prefix))) continue;
      const entries = await ctx.fileSystem.readDirectory(prefix);
      for (const entry of entries) {
        if (!entry.isDirectory || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const candidate = `${prefix}/${entry.name}/${rest}`;
        if (await ctx.fileSystem.fileExists(candidate)) {
          candidates.push(candidate);
          if (candidates.length >= 4) break;
        }
      }
    } catch {
      // Unreadable prefix — keep probing the other split points.
    }
  }
  return candidates.length === 1 ? { match: candidates[0], candidates } : { candidates };
}

export async function handleReadFile(
  ctx: ToolExecutionContext,
  args: { path: string; startLine?: number | string; endLine?: number | string },
): Promise<ToolResult> {
  const { path: filePath } = args;
  const { startLine, endLine } = coerceLineRange(args);

  if (!filePath) {
    return { content: 'read_file requires path', error: 'read_file requires path' };
  }

  const fileSystem = ctx.fileSystem;

  // Extension fast path. Resolve first so the reply can carry a real size —
  // the contained sniff fstats anyway, so this costs nothing beyond the resolve.
  // Existence is verified BEFORE answering: this branch used to fabricate a
  // "[Binary file: …] size: unknown" success for paths that did not exist,
  // directly contradicting copy_file's not-found in the same transcript and
  // looping the agent (zinc-bracing-gavel).
  if (isBinaryPath(filePath)) {
    try {
      const early = await resolveToolPath(ctx, filePath);
      const exists = await fileSystem.fileExists(early.fsPath);
      if (!exists) {
        const errorMsg =
          `File not found: ${early.displayPath}\n\n` +
          `Before retrying: use list_files("${path.dirname(early.displayPath)}") to verify the exact path. ` +
          `Binary files cannot be authored by tools — if this file is missing it must be supplied (uploaded) or copied from an existing source via copy_file.`;
        return { content: errorMsg, error: `File not found: ${early.displayPath}` };
      }
      const sizeBytes = sniffToolFile(fileSystem.resolveAbsolute(early.fsPath)).size;
      return { content: binaryFileMessage(early.displayPath, sizeBytes) };
    } catch {
      // Unresolvable → report without a size rather than guessing.
      return { content: binaryFileMessage(filePath, undefined) };
    }
  }

  const resolved = await resolveToolPath(ctx, filePath);

  const isDir = await fileSystem.isDirectory(resolved.fsPath);
  if (isDir) {
    const content = `Path is a directory, not a file: ${resolved.displayPath}\n\n` +
      `To see files in this directory: use list_files("${resolved.displayPath}")\n` +
      `To read a specific file: use read_file("${resolved.displayPath}/filename")`;
    return { content };
  }

  // Content sniff — catches binary formats the extension set doesn't know
  // (.glb, .fbx, .ogg, …). A utf-8 read of these would return garbage bytes
  // that the LLM tends to discard as noise. Unreadable/missing paths return
  // false and fall through to the canonical not-found path below.
  try {
    const sniffed = sniffToolFile(fileSystem.resolveAbsolute(resolved.fsPath));
    if (sniffed.binary) {
      return { content: binaryFileMessage(resolved.displayPath, sniffed.size) };
    }
  } catch {
    // resolveAbsolute failure → let the normal read path surface the error.
  }

  const hasRange = typeof startLine === 'number' || typeof endLine === 'number';

  // Stat-first oversized check — refusing BEFORE reading avoids pulling
  // a huge file into memory just to discard it. The absolute path is
  // routed through the port's traversal-protected resolver so this
  // direct fs touch stays inside the workspace boundary.
  if (!hasRange) {
    try {
      const absPath = fileSystem.resolveAbsolute(resolved.fsPath);
      const size = statToolFileSize(absPath);
      if (size !== undefined && size > READ_FILE_FULL_READ_LIMIT) {
        const errorMsg =
          `Error: File too large for full read (${size.toLocaleString()} bytes). ` +
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
  } else {
    // Range read: bound the pre-read too (M-032). The slice happens after a full
    // materialise, so an unbounded range on a huge/growing file would still
    // allocate the whole file. Refuse before reading.
    try {
      const absPath = fileSystem.resolveAbsolute(resolved.fsPath);
      const size = statToolFileSize(absPath);
      if (size !== undefined && size > READ_FILE_RANGE_MAX_BYTES) {
        const errorMsg =
          `Error: File too large to range-read (${size.toLocaleString()} bytes; limit ${READ_FILE_RANGE_MAX_BYTES.toLocaleString()}). ` +
          `Narrow the file or split it before reading.`;
        console.error(`[readFile] ${errorMsg}`);
        return { content: errorMsg, error: errorMsg };
      }
    } catch {
      // stat failure falls through to the canonical not-found path below.
    }
  }

  const mergeIndex = await ctx.chatStatus.addReadingFile(resolved.displayPath, startLine, endLine);

  try {
    console.log(`[readFile] Reading file: ${resolved.displayPath} (fsPath: ${resolved.fsPath})`);
    // The pre-stat guards above give the better message, but they stat the path
    // and the read binds a different descriptor — a file grown/replaced in the
    // gap would still be materialised whole. Bound the actual read on its own
    // descriptor as the backstop (M-032). Full and range share this ceiling.
    const fileContent = await fileSystem.readFile(resolved.fsPath, {
      maxBytes: hasRange ? READ_FILE_RANGE_MAX_BYTES : READ_FILE_FULL_READ_LIMIT,
    });

    if (!fileContent) {
      // Tolerant resolve: a unique one-segment insertion (typically a missing
      // `packages/`-style monorepo level) is served directly with the corrected
      // path named — the alternative is the model spending list_files turns
      // rediscovering the tree. Ambiguity falls through to candidates-named error.
      const probe = await probeSegmentInsertion(ctx, resolved.displayPath);
      if (probe.match) {
        const note =
          `[Path corrected: "${resolved.displayPath}" does not exist — serving the unique match ` +
          `"${probe.match}". Use and cite the corrected path from now on.]`;
        await ctx.chatStatus.addReadComplete(resolved.displayPath, mergeIndex, { error: note });
        const inner = await handleReadFile(ctx, { ...args, path: probe.match });
        if (inner.error) return inner;
        return { ...inner, content: `${note}\n\n${inner.content}` };
      }
      let errorMsg =
        `File not found: ${resolved.displayPath}\n\n` +
        `Before retrying: use list_files("${path.dirname(resolved.displayPath)}") to verify the exact path, ` +
        `or if this file is meant to be new, call create_file("${resolved.displayPath}") to create it instead of reading it.`;
      if (probe.candidates.length > 1) {
        errorMsg =
          `File not found: ${resolved.displayPath}\n\n` +
          `Similar paths exist — specify the one you meant:\n` +
          probe.candidates.map((c) => `  - ${c}`).join('\n');
      }
      // Cross-namespace backstop: a bare platform-source citation (e.g. from a
      // sealed plan) gets Rule-4'd into codebase/ and misses — probe the
      // ORIGINAL path against the ant-source roots and redirect instead of
      // letting the model rediscover the tree (narrow-ending-flour). Paths the
      // model explicitly addressed to the workspace are not probed.
      const rawPath = String(filePath).replace(/^\.\//, '');
      const workspaceAddressed = /^(codebase|features|plan|architecture|visual|assets|meta|sessions)\//.test(rawPath);
      if (!workspaceAddressed && ctx.availableToolNames?.has('read_ant_source')) {
        const antHit = findInAntSourceRoots(rawPath);
        if (antHit) {
          errorMsg =
            `File not found: ${resolved.displayPath}\n\n` +
            `Note: "${rawPath}" exists in the PLATFORM source, not in this app's workspace. ` +
            `If you meant the platform file, read it with read_ant_source({ path: "${rawPath}", source: "${antHit}" }). ` +
            `Platform-source paths never resolve via read_file. Do not create this file.`;
        }
      }
      console.error(`[readFile] ❌ File not found: ${resolved.displayPath}`);
      await ctx.chatStatus.addReadComplete(resolved.displayPath, mergeIndex, { error: errorMsg });
      return { content: errorMsg, error: `File not found: ${resolved.displayPath}` };
    }

    // `chars`, not bytes: the byte ceilings above are enforced on the stat size,
    // and labelling this count "bytes" under-reports a CJK file by ~2x, which
    // reads as a truncated read that never happened.
    console.log(`[readFile] ✅ Read from disk: ${resolved.displayPath} (${fileContent.length} chars)`);

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
