/**
 * SharedFileBuffer
 *
 * Shared file state across all parallel workers.
 * Provides per-file mutex for write serialization and version-based OCC
 * (Optimistic Concurrency Control) for stale detection.
 *
 * All workers read from and write through this buffer, ensuring cross-worker
 * visibility and preventing blind overwrites.
 *
 * Path normalization uses normalizeToCodebasePath() for consistency with
 * the tool handlers.
 */

import { AsyncMutex } from '../../../../../core/utils/AsyncMutex';
import { normalizeToCodebasePath } from '../../../../../core/utils/pathNormalizer';
import type { FileSystemPort } from '../../../../../core/ports/filesystem';

export interface FileEntry {
  content: string;
  workerId: number;
  taskName?: string;
  version: number;
  lastModified: number;
}

export interface WriteResult {
  success: boolean;
  /** Cross-worker ownership conflict (new file created by another worker) */
  conflict?: boolean;
  /** Version mismatch (edit based on outdated content) */
  stale?: boolean;
  error?: string;
  /** Task name of the conflicting owner (for UI messages) */
  ownerTask?: string;
  /** Current file content on conflict (for direct merge without read_file) */
  currentContent?: string;
}

export interface WriteOptions {
  /** Expected version from previous read. Mismatch -> stale. */
  expectedVersion?: number;
  /** True for new file creation. Fails if another worker owns the file. */
  isNewFile?: boolean;
  /** True for a create_file overwrite of a pre-existing file. Fails if another worker modified it. */
  isOverwrite?: boolean;
  /** Task name for conflict messages. */
  taskName?: string;
}

/**
 * Build the conflict message shown to the LLM when a `create_file` write
 * collides with a prior committed write (cross-worker OR cross-task on same
 * worker).
 *
 * The message presents three channel choices with the `edit_file` tool as the DEFAULT
 * for cross-task continuation. `append_file` is narrowed to physical-tail-concat
 * use cases (CSS cascade / .gitignore / log entry) so the LLM does not
 * mistakenly append to JSON/config files where middle-insert is the correct
 * shape.
 *
 * The tail preview is capped at 200 chars to keep retry body size bounded
 * (max_tokens cliff regression guard — body inclusion is never demanded).
 */
function buildClobberConflictMessage(params: {
  filePath: string;
  priorTaskName?: string;
  priorVersion: number;
  priorSize: number;
  priorTail: string;
  emittedSize: number;
}): string {
  const {
    filePath,
    priorTaskName,
    priorVersion,
    priorSize,
    priorTail,
    emittedSize,
  } = params;
  const ownerLabel = priorTaskName ? `task "${priorTaskName}"` : 'a sibling writer';
  const tailHintLine =
    emittedSize > 0 && emittedSize < priorSize
      ? `\nHint: your body (${emittedSize} bytes) is smaller than the existing content (${priorSize} bytes) — you are likely modifying middle content or extending the tail, not replacing the whole file. Call the edit_file tool, do NOT call create_file with overwrite.`
      : '';
  return (
    `File "${filePath}" was already committed by ${ownerLabel} ` +
    `(size: ${priorSize} bytes, version: ${priorVersion}, ` +
    `tail: ${JSON.stringify(priorTail)}).\n\n` +
    `Your emitted body is ${emittedSize} bytes. Before retry, choose ONE channel:\n\n` +
    `1. PARTIAL modification of existing content (DEFAULT — most cross-task ` +
    `continuation falls here: adding an import, inserting a JSON property, ` +
    `changing a value, adjusting a block) — call the edit_file TOOL:\n` +
    `       edit_file { "path": "${filePath}",\n` +
    `                   "old_str": "...existing snippet to match...",\n` +
    `                   "new_str": "...new snippet..." }\n\n` +
    `2. ADDITION that physically concatenates at the file's END without ` +
    `affecting prior content (ONLY for tail-naturally-extending files — ` +
    `CSS cascade tail layers, .gitignore line, log entry) — call append_file:\n` +
    `       append_file { "path": "${filePath}",\n` +
    `                     "content": "...new tail content..." }\n\n` +
    `3. COMPLETE rewrite — your body intentionally REPLACES all ${priorSize} ` +
    `existing bytes (rare; verify this is your true intent) — call create_file ` +
    `with explicit overwrite:\n` +
    `       create_file { "path": "${filePath}",\n` +
    `                     "content": "...complete new file content...",\n` +
    `                     "overwrite": true }\n\n` +
    `Hint: the edit_file tool is the default for cross-task continuation. ` +
    `Use append_file ONLY when content naturally belongs at the file's physical end.` +
    tailHintLine
  );
}

export class SharedFileBuffer {
  private files = new Map<string, FileEntry>();
  private fileLocks = new Map<string, AsyncMutex>();
  private codebaseRel: string;
  /** Workers authorized to overwrite another worker's file (post-conflict merge) */
  private authorizedWriters = new Map<string, Set<number>>();
  /**
   * Paths deleted through the buffer since their last write. A tombstone
   * guards against a stale cross-worker READ (buffered pre-delete content) or a
   * stale-version EDIT resurrecting the file after a sibling worker deleted it.
   * A legitimate re-creation (`isNewFile`) clears the tombstone and proceeds.
   */
  private deleted = new Set<string>();

  constructor(codebaseRel: string = 'codebase') {
    this.codebaseRel = codebaseRel;
  }

  /**
   * Normalize path using the same function as existingFiles Set and tool handlers.
   * Public so WorkerFileSystem can use the same normalization for readVersions keys.
   */
  normalizePath(filePath: string): string {
    const { normalized } = normalizeToCodebasePath(filePath, this.codebaseRel);
    return normalized;
  }

  private getFileLock(filePath: string): AsyncMutex {
    const normalized = this.normalizePath(filePath);
    let lock = this.fileLocks.get(normalized);
    if (!lock) {
      lock = new AsyncMutex();
      this.fileLocks.set(normalized, lock);
    }
    return lock;
  }

  /**
   * Read file content from shared buffer (cross-worker visible).
   * Returns content + version, or null if not buffered.
   */
  read(filePath: string): { content: string; version: number } | null {
    const normalized = this.normalizePath(filePath);
    const entry = this.files.get(normalized);
    if (!entry) return null;
    return { content: entry.content, version: entry.version };
  }

  /**
   * Check if file exists in shared buffer.
   */
  has(filePath: string): boolean {
    return this.files.has(this.normalizePath(filePath));
  }

  /**
   * Get owner info for a file.
   */
  getOwner(filePath: string): FileEntry | undefined {
    return this.files.get(this.normalizePath(filePath));
  }

  /**
   * Authorize a worker to overwrite a file owned by another worker.
   * Called after a conflict is detected and the merge instruction is injected
   * into the LLM conversation. The next writeNewFile() by this worker will
   * succeed (ownership takeover) instead of returning a conflict.
   */
  authorizeWriter(filePath: string, workerId: number): void {
    const normalized = this.normalizePath(filePath);
    let set = this.authorizedWriters.get(normalized);
    if (!set) {
      set = new Set();
      this.authorizedWriters.set(normalized, set);
    }
    set.add(workerId);
  }

  /**
   * Write with version-based OCC and cross-worker conflict detection.
   *
   * All file writes go through this single method:
   * 1. Acquire per-file mutex (serialize concurrent writes)
   * 2. If expectedVersion provided: check for stale content (editFile path)
   * 3. If isOverwrite: check if another worker modified the file (create_file overwrite of a pre-existing file)
   * 4. If isNewFile: check for cross-worker ownership conflict (create_file on a new file)
   * 5. Write to buffer + disk
   * 6. Release mutex
   */
  async write(
    filePath: string,
    content: string,
    workerId: number,
    delegate: FileSystemPort,
    options: WriteOptions = {},
  ): Promise<WriteResult> {
    const lock = this.getFileLock(filePath);

    return await lock.runExclusive(async () => {
      const normalized = this.normalizePath(filePath);
      const existing = this.files.get(normalized);

      // 0. Tombstone check — a sibling worker deleted this path through the
      // buffer. A create (`isNewFile`) or a fresh write with no version basis
      // legitimately re-creates it, so lift the tombstone and continue. An
      // edit/overwrite whose basis predates the deletion is a stale
      // resurrection — reject so the worker re-reads and observes the file is
      // gone instead of writing its prior content back to disk.
      if (this.deleted.has(normalized)) {
        if (
          options.isNewFile ||
          (options.expectedVersion === undefined && !options.isOverwrite)
        ) {
          this.deleted.delete(normalized);
        } else {
          return {
            success: false,
            stale: true,
            error:
              `File "${filePath}" was deleted by a sibling task since you last ` +
              `read it. Do not re-emit its prior content; if you intend to ` +
              `recreate it, write it as a new file.`,
          };
        }
      }

      // 1. Version-based stale check (editFile path)
      // If expectedVersion is provided, the caller read this file before editing.
      // If the version changed since that read, another worker modified it.
      if (options.expectedVersion !== undefined && existing) {
        if (existing.version !== options.expectedVersion) {
          return {
            success: false,
            stale: true,
            ownerTask: existing.taskName,
            error:
              `File "${filePath}" was modified by task "${existing.taskName}" ` +
              `since you last read it (version ${options.expectedVersion} -> ${existing.version}). ` +
              `Read the current content first.`,
          };
        }
      }

      // 2. Overwrite-without-explicit-intent check (create_file on a pre-existing file)
      // The worker is overwriting a file that another worker OR a prior task on
      // the same worker has committed. Without explicit `overwrite="true"`, the
      // overwriter's content would silently discard the other writer's changes.
      // Task-level (not worker-level) comparison closes the same-worker
      // sequential cross-task gap (e.g. ds-tokens -> batch-zw6xc on Worker 0).
      if (
        options.isOverwrite &&
        existing &&
        (existing.workerId !== workerId ||
          existing.taskName !== options.taskName)
      ) {
        const authorized = this.authorizedWriters.get(normalized);
        if (authorized?.has(workerId)) {
          authorized.delete(workerId);
          if (authorized.size === 0) this.authorizedWriters.delete(normalized);
          // Fall through to write section below
        } else {
          return {
            success: false,
            conflict: true,
            ownerTask: existing.taskName,
            currentContent: existing.content,
            error: buildClobberConflictMessage({
              filePath,
              priorTaskName: existing.taskName,
              priorVersion: existing.version,
              priorSize: existing.content.length,
              priorTail: existing.content.slice(-200),
              emittedSize: content.length,
            }),
          };
        }
      }

      // 3. Cross-writer ownership check (new file creation path)
      // If this is a new file creation and another worker OR a prior task on
      // the same worker already created it, check if this worker was authorized
      // (post-conflict merge / takeover via explicit overwrite="true" intent).
      if (
        options.isNewFile &&
        existing &&
        (existing.workerId !== workerId ||
          existing.taskName !== options.taskName)
      ) {
        const authorized = this.authorizedWriters.get(normalized);
        if (authorized?.has(workerId)) {
          // Worker was told about the conflict and instructed to merge.
          // Allow the write (ownership takeover).
          authorized.delete(workerId);
          if (authorized.size === 0) this.authorizedWriters.delete(normalized);
          // Fall through to write section below
        } else {
          return {
            success: false,
            conflict: true,
            ownerTask: existing.taskName,
            currentContent: existing.content,
            error: buildClobberConflictMessage({
              filePath,
              priorTaskName: existing.taskName,
              priorVersion: existing.version,
              priorSize: existing.content.length,
              priorTail: existing.content.slice(-200),
              emittedSize: content.length,
            }),
          };
        }
      }

      // 4. Write: new file, same worker re-write, or legitimate overwrite
      const newVersion = (existing?.version || 0) + 1;
      this.files.set(normalized, {
        content,
        workerId,
        taskName: options.taskName,
        version: newVersion,
        lastModified: Date.now(),
      });
      await delegate.writeFile(filePath, content);

      return { success: true };
    });
  }

  /**
   * Delete a file through the buffer — symmetric with `write()`.
   *
   * Runs under the per-file mutex so it serializes against concurrent writes,
   * removes the on-disk file AND the buffer entry (so cross-worker `has()` /
   * `read()` / `fileExists()` / `getAllWrittenPaths()` reflect the deletion),
   * and records a tombstone that blocks a stale re-write from resurrecting it.
   *
   * Without this, `delete_file` bypassed the buffer: the entry survived, a
   * sibling worker still read the pre-delete content, and a later write
   * re-materialized the file which the filesystem-truth `git add '.'` commit
   * then re-committed.
   */
  async delete(
    filePath: string,
    _workerId: number,
    delegate: FileSystemPort,
  ): Promise<void> {
    const lock = this.getFileLock(filePath);
    await lock.runExclusive(async () => {
      const normalized = this.normalizePath(filePath);
      await delegate.deleteFile(filePath);
      this.files.delete(normalized);
      this.authorizedWriters.delete(normalized);
      this.deleted.add(normalized);
    });
  }

  /**
   * Invalidate a single file entry so the next read falls back to disk.
   * Called after run_command modifies files outside the buffer's awareness.
   */
  invalidate(filePath: string): boolean {
    const normalized = this.normalizePath(filePath);
    return this.files.delete(normalized);
  }

  /**
   * Invalidate all buffered files whose normalized path equals or starts with
   * the given prefix. Returns the number of entries removed.
   *
   * Used after run_command to flush stale entries — shell commands can modify
   * any file under codebase/ and the buffer has no way to detect which ones
   * changed, so the caller invalidates the whole subtree conservatively.
   */
  invalidateByPrefix(prefix: string): number {
    const normalizedPrefix = this.normalizePath(prefix);
    let count = 0;
    for (const key of this.files.keys()) {
      if (key === normalizedPrefix || key.startsWith(normalizedPrefix + '/')) {
        this.files.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Get files written by OTHER workers (for cross-worker context injection).
   */
  getWrittenFilesByOtherWorkers(
    workerId: number,
  ): Array<{ path: string; taskName?: string }> {
    const result: Array<{ path: string; taskName?: string }> = [];
    for (const [path, entry] of this.files) {
      if (entry.workerId !== workerId) {
        result.push({ path, taskName: entry.taskName });
      }
    }
    return result;
  }

  /**
   * Get files written by tasks OTHER than the current task.
   * Unlike getWrittenFilesByOtherWorkers (which filters by workerId),
   * this filters by taskName — so files written by earlier tasks on the
   * SAME worker are included. This is critical when Worker 0 handles
   * setup → foundation → feature sequentially: the feature task must
   * see foundation files even though they share the same workerId.
   */
  getWrittenByOtherTasks(
    currentTaskName: string,
  ): Array<{ path: string; taskName?: string }> {
    const result: Array<{ path: string; taskName?: string }> = [];
    for (const [path, entry] of this.files) {
      if (entry.taskName !== currentTaskName) {
        result.push({ path, taskName: entry.taskName });
      }
    }
    return result;
  }

  /**
   * Get all written file paths (for existingFiles Set expansion).
   */
  getAllWrittenPaths(): string[] {
    return Array.from(this.files.keys());
  }
}
