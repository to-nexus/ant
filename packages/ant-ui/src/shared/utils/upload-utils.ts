import {
  UPLOAD_BATCH_MAX_BYTES,
  UPLOAD_FILE_MAX_BYTES,
  UPLOAD_MAX_FILES_PER_REQUEST,
  UPLOAD_REQUEST_MAX_MB,
} from '@ant/shared';

import type { FileNode, UploadFileEntry } from '@/infrastructure/http/api/files';

/**
 * Upload identity is the file's path RELATIVE TO THE TARGET DIRECTORY, not its
 * bare name. A folder upload carries nested entries, so two files named
 * `index.md` under different sub-folders are distinct targets and must not
 * share a conflict verdict or a rename decision.
 */

/** Find uploads whose relative path already exists as a file under dirPath. */
export function findConflicts(
  fileTree: FileNode[],
  dirPath: string,
  entries: UploadFileEntry[],
): string[] {
  const targetDir = findDirectoryNode(fileTree, dirPath);
  if (!targetDir?.children) return [];

  const existing = new Set<string>();
  collectFilePaths(targetDir.children, '', existing);

  return entries
    .map((e) => normalizeRelativePath(e.relativePath))
    .filter((relPath) => existing.has(relPath));
}

/**
 * Generate a unique copy path by appending " (N)" before the extension of the
 * last segment, scanning existingPaths for the next available number.
 *
 * Example: "img/logo.png" -> "img/logo (1).png"
 */
export function getUniqueCopyPath(
  originalPath: string,
  existingPaths: string[],
): string {
  const slashIdx = originalPath.lastIndexOf('/');
  const dir = slashIdx >= 0 ? originalPath.slice(0, slashIdx + 1) : '';
  const name = slashIdx >= 0 ? originalPath.slice(slashIdx + 1) : originalPath;

  const dotIdx = name.lastIndexOf('.');
  const baseName = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : '';

  const pattern = new RegExp(
    `^${escapeRegExp(dir + baseName)} \\((\\d+)\\)${escapeRegExp(ext)}$`,
  );

  let maxN = 0;
  for (const path of existingPaths) {
    const match = path.match(pattern);
    if (match) {
      maxN = Math.max(maxN, parseInt(match[1], 10));
    }
  }

  return `${dir}${baseName} (${maxN + 1})${ext}`;
}

/**
 * Apply per-file conflict resolutions (overwrite or copy) to an upload list.
 * Keys are relative paths — the same identity findConflicts reported.
 */
export function applyPerFileResolutions(
  entries: UploadFileEntry[],
  perFile: Record<string, 'overwrite' | 'copy'>,
  existingPaths: string[],
): UploadFileEntry[] {
  const copyPaths = new Set(
    Object.entries(perFile)
      .filter(([, action]) => action === 'copy')
      .map(([path]) => path),
  );

  if (copyPaths.size === 0) return entries;

  const usedPaths = [...existingPaths];
  return entries.map((entry) => {
    const relPath = normalizeRelativePath(entry.relativePath);
    if (!copyPaths.has(relPath)) return entry;

    const newPath = getUniqueCopyPath(relPath, usedPaths);
    usedPaths.push(newPath);

    const newName = newPath.split('/').pop() || newPath;
    const renamedFile = new File([entry.file], newName, { type: entry.file.type });
    return { file: renamedFile, relativePath: newPath };
  });
}

/**
 * Convert a picked FileList to UploadFileEntry[]. A folder pick
 * (`webkitdirectory`) carries `webkitRelativePath` — that IS the structure the
 * upload must preserve, so it wins over the bare name.
 */
export function fileListToEntries(files: FileList): UploadFileEntry[] {
  return Array.from(files).map((f) => ({
    file: f,
    relativePath: normalizeRelativePath(f.webkitRelativePath || f.name),
  }));
}

/**
 * Every descendant path under dirPath (files and directories), relative to it —
 * the namespace a copy-renamed upload must not collide with.
 */
export function getAllExistingPaths(
  fileTree: FileNode[],
  dirPath: string,
): string[] {
  const targetDir = findDirectoryNode(fileTree, dirPath);
  if (!targetDir?.children) return [];

  const out: string[] = [];
  const walk = (nodes: FileNode[], prefix: string) => {
    for (const node of nodes) {
      const rel = prefix ? `${prefix}/${node.name}` : node.name;
      out.push(rel);
      if (node.children) walk(node.children, rel);
    }
  };
  walk(targetDir.children, '');
  return out;
}

// ── Internal helpers ─────────────────────────────────────────────────

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function collectFilePaths(nodes: FileNode[], prefix: string, out: Set<string>): void {
  for (const node of nodes) {
    const rel = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === 'file') out.add(rel);
    else if (node.children) collectFilePaths(node.children, rel, out);
  }
}

function findDirectoryNode(
  nodes: FileNode[],
  dirPath: string,
): FileNode | undefined {
  // '' / '.' address the tree root itself (writable-root mounts).
  if (dirPath === '' || dirPath === '.') return { name: '', path: '', type: 'directory', children: nodes };
  for (const node of nodes) {
    if (node.path === dirPath && node.type === 'directory') return node;
    if (node.children) {
      const found = findDirectoryNode(node.children, dirPath);
      if (found) return found;
    }
  }
  return undefined;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Batching ─────────────────────────────────────────────────────────

/**
 * A folder upload is split into requests the server will actually accept.
 *
 * Every lane sends paired parts per file (`files` + `relativePaths`), so an
 * unbatched drop of N files spends N+1 fields and 2N+1 parts. A 115-file folder
 * blew the multer field cap, multer aborted with a `MulterError` nobody handled,
 * and the user got an HTML 500 — hence a client that sizes its own requests from
 * the same constant the server enforces.
 */
export interface UploadBatchPlan {
  batches: UploadFileEntry[][];
  /** Past the per-file cap — unsendable, so reported rather than thrown at the server. */
  oversized: UploadFileEntry[];
  /** Σ file.size over batched entries — the denominator for cumulative progress. */
  totalBytes: number;
}

export interface PlanUploadBatchesOptions {
  maxFiles?: number;
  maxBytes?: number;
  /**
   * Entries that must land in the FIRST batch. `/import` validates
   * `agent.yaml` at the folder root on EVERY request, so the batch that creates
   * the agent has to carry it.
   */
  pinFirst?: (entry: UploadFileEntry) => boolean;
}

export function planUploadBatches(
  entries: UploadFileEntry[],
  options: PlanUploadBatchesOptions = {},
): UploadBatchPlan {
  const maxFiles = options.maxFiles ?? UPLOAD_MAX_FILES_PER_REQUEST;
  const maxBytes = options.maxBytes ?? UPLOAD_BATCH_MAX_BYTES;

  const oversized: UploadFileEntry[] = [];
  const sendable: UploadFileEntry[] = [];
  for (const entry of entries) {
    if (entry.file.size > UPLOAD_FILE_MAX_BYTES) oversized.push(entry);
    else sendable.push(entry);
  }

  // Pinned entries first, original order preserved within each group.
  const ordered = options.pinFirst
    ? [...sendable.filter(options.pinFirst), ...sendable.filter((e) => !options.pinFirst!(e))]
    : sendable;

  const batches: UploadFileEntry[][] = [];
  let current: UploadFileEntry[] = [];
  let currentBytes = 0;
  let totalBytes = 0;

  for (const entry of ordered) {
    const size = entry.file.size;
    // A single entry never gets its own budget check beyond the per-file cap
    // above, so an empty batch always accepts one — no infinite split.
    if (current.length > 0 && (current.length >= maxFiles || currentBytes + size > maxBytes)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += size;
    totalBytes += size;
  }
  if (current.length > 0) batches.push(current);

  // An empty input still gets ONE request, so the server's own "No files
  // uploaded" validation answers exactly as it did before batching. An input
  // that emptied only because every entry was oversized does NOT: the caller
  // reports that itself, and a 400 on top would be a second, misleading error.
  if (batches.length === 0 && oversized.length === 0) batches.push([]);

  return { batches, oversized, totalBytes };
}

/**
 * Some batches landed and then one failed.
 *
 * Reported rather than swallowed: files ARE on the server, so the caller must
 * refresh its tree, and the entries are still held in memory so a retry is a
 * real option.
 */
export class PartialUploadError extends Error {
  readonly uploadedCount: number;
  readonly totalCount: number;
  /** Declared explicitly: `Error.cause` needs a lib newer than this tsconfig targets. */
  readonly cause: unknown;

  constructor(uploadedCount: number, totalCount: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Uploaded ${uploadedCount} of ${totalCount} files, then failed: ${reason}`);
    this.name = 'PartialUploadError';
    this.uploadedCount = uploadedCount;
    this.totalCount = totalCount;
    this.cause = cause;
  }
}

export interface UploadBatchContext {
  index: number;
  count: number;
  /** True for the first batch only — the one a destructive field may ride. */
  isFirst: boolean;
  onBatchProgress: (loaded: number, total: number) => void;
}

export interface RunUploadBatchesOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Send the planned batches, strictly one at a time.
 *
 * Sequential on purpose, for two reasons. `UPLOAD_MAX_INFLIGHT_PER_USER` is a
 * cluster-wide per-account budget shared with the user's other tabs, so a
 * fan-out would 429 itself. And sequencing makes "the destructive field rides
 * only on batch 1" a property of this driver rather than a race: the two
 * replace lanes (`replaceDir`, `/import` + `overwrite`) `fs.rmSync` before
 * writing, so a reordered batch 2 would be deleted by batch 1.
 */
export async function runUploadBatches<R>(
  plan: UploadBatchPlan,
  send: (batch: UploadFileEntry[], ctx: UploadBatchContext) => Promise<R>,
  options: RunUploadBatchesOptions = {},
): Promise<R[]> {
  const { batches, totalBytes } = plan;
  const results: R[] = [];
  let doneBytes = 0;
  let uploadedCount = 0;
  const totalCount = batches.reduce((n, b) => n + b.length, 0);

  for (let index = 0; index < batches.length; index++) {
    if (options.signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

    const batch = batches[index];
    const batchBytes = batch.reduce((n, e) => n + e.file.size, 0);
    const base = doneBytes;

    try {
      results.push(
        await send(batch, {
          index,
          count: batches.length,
          isFirst: index === 0,
          // Cumulative, so the caller's progress bar stays monotonic instead of
          // resetting to zero on every batch.
          onBatchProgress: (loaded, total) =>
            options.onProgress?.(
              base + (total > 0 ? (loaded / total) * batchBytes : 0),
              totalBytes,
            ),
        }),
      );
    } catch (err) {
      // Nothing landed yet — leave the original error, so every existing
      // error path (and its typed `code`) behaves exactly as before.
      if (index === 0) throw err;
      throw new PartialUploadError(uploadedCount, totalCount, err);
    }

    uploadedCount += batch.length;
    doneBytes += batchBytes;
    options.onProgress?.(doneBytes, totalBytes);
  }

  return results;
}

// ── Refusal messages ─────────────────────────────────────────────────

/**
 * The one owner of upload-refusal `code` → i18n key.
 *
 * i18n-free so it stays testable and shared: each panel calls `t(key, params)`.
 * Returns null for anything not an upload refusal, leaving the caller's generic
 * handler in charge.
 */
export function uploadRefusalMessage(e: {
  status?: number;
  code?: string;
  limit?: number;
  limitMb?: number;
}): { key: string; params?: Record<string, unknown> } | null {
  switch (e.code) {
    case 'UPLOAD_REQUEST_TOO_LARGE':
      return { key: 'error.uploadTooLarge', params: { limitMb: UPLOAD_REQUEST_MAX_MB } };
    case 'UPLOAD_TOO_MANY_FILES':
      return { key: 'error.uploadTooManyFiles', params: { limit: e.limit ?? UPLOAD_MAX_FILES_PER_REQUEST } };
    case 'UPLOAD_FILE_TOO_LARGE':
      return {
        key: 'error.uploadFileTooLarge',
        params: { limitMb: e.limitMb ?? Math.floor(UPLOAD_FILE_MAX_BYTES / (1024 * 1024)) },
      };
    case 'UPLOAD_FIELD_TOO_LARGE':
    case 'UPLOAD_MALFORMED':
    case 'UPLOAD_UNEXPECTED_FIELD':
      return { key: 'error.uploadMalformed' };
    case 'UPLOAD_CONCURRENCY_LIMIT':
      return { key: 'error.uploadTooManyInFlight' };
    case 'UPLOAD_POD_BUSY':
    case 'UPLOAD_ACCOUNT_BUSY':
      return { key: 'error.uploadServerBusy' };
  }
  // A proxy's own 413 carries an HTML body and no `code` — the same
  // unmappable-refusal class this whole seam exists to remove. `docker/nginx.conf`
  // caps at 100m while the app advertises 200 MiB, so this is reachable today.
  if (e.status === 413) {
    return { key: 'error.uploadTooLarge', params: { limitMb: UPLOAD_REQUEST_MAX_MB } };
  }
  return null;
}

/**
 * Turn a failed batched upload into the error a definition-lane caller should
 * surface, translated.
 *
 * `destructive` means batch 1 already `rmSync`'d the target, so the folder on
 * disk is now an incomplete replacement — a materially different thing to tell
 * someone than "some files did not upload", and the reason the two lanes get
 * different keys. Anything that is not a partial failure passes through
 * untouched, so existing typed errors keep their own handling.
 */
export function partialUploadMessage(
  err: unknown,
  t: (key: string, params?: Record<string, unknown>) => string,
  opts: { dir?: string; destructive?: boolean } = {},
): unknown {
  if (!(err instanceof PartialUploadError)) return err;
  const params = {
    done: err.uploadedCount,
    total: err.totalCount,
    reason: err.cause instanceof Error ? err.cause.message : String(err.cause),
    ...(opts.dir ? { dir: opts.dir } : {}),
  };
  return new Error(
    t(opts.destructive ? 'import.uploadPartialReplace' : 'import.uploadPartial', params),
  );
}
