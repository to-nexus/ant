/**
 * WorkerFileSystem
 *
 * Per-worker wrapper around FileSystemPort that routes all reads/writes
 * through SharedFileBuffer for cross-worker visibility and conflict detection.
 *
 * Features:
 * - readFile: checks SharedFileBuffer first, falls back to disk
 * - writeFile: delegates to SharedFileBuffer.write() with OCC (version check)
 * - writeNewFile: for <file> tag / createFile — uses isNewFile flag for ownership check
 * - Tracks read versions in readVersions map for stale detection
 */

import type { FileSystemPort } from '../../../../../core/ports/filesystem';
import { SharedFileBuffer, WriteResult } from './SharedFileBuffer';

/**
 * Custom error thrown when a file write conflict is detected.
 * Distinguishes between stale (version mismatch) and conflict (cross-worker ownership).
 */
export class FileConflictError extends Error {
  readonly stale: boolean;
  readonly conflict: boolean;

  constructor(message: string, stale?: boolean, conflict?: boolean) {
    super(message);
    this.name = 'FileConflictError';
    this.stale = !!stale;
    this.conflict = !!conflict;
  }
}

export interface NewFileWriteResult {
  success: boolean;
  error?: string;
  ownerTask?: string;
  /** Current file content on conflict (for direct merge without read_file) */
  currentContent?: string;
}

export class WorkerFileSystem implements FileSystemPort {
  private readVersions = new Map<string, number>();

  constructor(
    private readonly delegate: FileSystemPort,
    readonly sharedBuffer: SharedFileBuffer,
    private readonly workerId: number,
    private readonly taskName?: string,
  ) {}

  // ─── Read ────────────────────────────────────────────────────────

  async readFile(path: string): Promise<string | null> {
    // Check shared buffer first (cross-worker visibility)
    const entry = this.sharedBuffer.read(path);
    if (entry) {
      this.readVersions.set(this.sharedBuffer.normalizePath(path), entry.version);
      return entry.content;
    }

    // Fall back to disk
    const content = await this.delegate.readFile(path);
    if (content !== null) {
      // v0 = disk original, not yet in SharedFileBuffer
      this.readVersions.set(this.sharedBuffer.normalizePath(path), 0);
    }
    return content;
  }

  // ─── Write (edit path — uses OCC version check) ──────────────────

  async writeFile(path: string, content: string): Promise<void> {
    const normalized = this.sharedBuffer.normalizePath(path);
    const expectedVersion = this.readVersions.get(normalized);

    const result = await this.sharedBuffer.write(
      path,
      content,
      this.workerId,
      this.delegate,
      {
        expectedVersion,
        taskName: this.taskName,
      },
    );

    if (!result.success) {
      throw new FileConflictError(result.error!, result.stale, result.conflict);
    }

    // Clear tracked version after successful write
    this.readVersions.delete(normalized);
  }

  // ─── Write New File (<file> tag / createFile — ownership check) ──

  /**
   * Write a new file. Returns result instead of throwing to allow graceful
   * error collection in FileRenderer (fileErrors array).
   */
  async writeNewFile(path: string, content: string): Promise<NewFileWriteResult> {
    const result = await this.sharedBuffer.write(
      path,
      content,
      this.workerId,
      this.delegate,
      {
        isNewFile: true,
        taskName: this.taskName,
      },
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        ownerTask: result.ownerTask,
        currentContent: result.currentContent,
      };
    }

    return { success: true };
  }

  // ─── Delegate methods (pass through unchanged) ───────────────────

  async fileExists(path: string): Promise<boolean> {
    // Check shared buffer first
    if (this.sharedBuffer.has(path)) return true;
    return this.delegate.fileExists(path);
  }

  async deleteFile(path: string): Promise<void> {
    return this.delegate.deleteFile(path);
  }

  async readDirectory(
    path: string,
  ): Promise<Array<{ name: string; isDirectory: boolean }>> {
    return this.delegate.readDirectory(path);
  }

  async createDirectory(path: string): Promise<void> {
    return this.delegate.createDirectory(path);
  }

  async listFiles(path: string, exclude?: string[]): Promise<string[]> {
    return this.delegate.listFiles(path, exclude);
  }

  async isDirectory(path: string): Promise<boolean> {
    return this.delegate.isDirectory(path);
  }

  async copyFile(
    src: string,
    dest: string,
    overwrite?: boolean,
  ): Promise<void> {
    return this.delegate.copyFile(src, dest, overwrite);
  }

  async moveFile(
    src: string,
    dest: string,
    overwrite?: boolean,
  ): Promise<void> {
    return this.delegate.moveFile(src, dest, overwrite);
  }

  async copyDirectory(src: string, dest: string): Promise<void> {
    return this.delegate.copyDirectory(src, dest);
  }

  async moveDirectory(src: string, dest: string): Promise<void> {
    return this.delegate.moveDirectory(src, dest);
  }

  getRootPath(): string {
    return this.delegate.getRootPath();
  }

  getWorkspaceRoot(): string {
    return this.delegate.getWorkspaceRoot();
  }
}
