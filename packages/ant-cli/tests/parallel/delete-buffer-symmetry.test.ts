/**
 * SharedFileBuffer / WorkerFileSystem delete-symmetry regression —
 * vivid-orbiting-dodge RCA guard.
 *
 * Defect: `WorkerFileSystem.deleteFile` bypassed `SharedFileBuffer` entirely.
 * Every write path routes through `sharedBuffer.write()` (buffer map + version +
 * disk), but delete went straight to the disk delegate and never invalidated
 * the buffer. So after a `delete_file`, the buffer still reported the file as
 * live (`has()`→true, `read()`→stale content), a sibling worker read the
 * pre-delete content, and a later write re-materialized the file — which the
 * filesystem-truth `git add '.'` commit then re-committed. Net effect: a
 * successfully-deleted file reappeared in the persisted codebase.
 *
 * Fix: `SharedFileBuffer.delete()` is symmetric with `write()` (per-file mutex,
 * removes disk + buffer entry, records a tombstone that rejects a stale
 * resurrection); `WorkerFileSystem.deleteFile` routes through it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SharedFileBuffer } from '../../src/agents/architect/graph/code/parallel/SharedFileBuffer';
import {
  WorkerFileSystem,
  FileConflictError,
} from '../../src/agents/architect/graph/code/parallel/WorkerFileSystem';
import type { FileSystemPort } from '../../src/core/ports/filesystem';

class FakeFS implements Partial<FileSystemPort> {
  written = new Map<string, string>();
  deleted: string[] = [];
  async writeFile(path: string, content: string): Promise<void> {
    this.written.set(path, content);
  }
  async deleteFile(path: string): Promise<void> {
    this.deleted.push(path);
    this.written.delete(path);
  }
  async readFile(path: string): Promise<string | null> {
    return this.written.has(path) ? this.written.get(path)! : null;
  }
  async fileExists(path: string): Promise<boolean> {
    return this.written.has(path);
  }
}

describe('SharedFileBuffer.delete — symmetric with write', () => {
  let buf: SharedFileBuffer;
  let fs: FakeFS;

  beforeEach(() => {
    buf = new SharedFileBuffer('codebase');
    fs = new FakeFS();
  });

  it('removes both the disk file and the buffer entry', async () => {
    await buf.write('codebase/old.ts', 'stale', 0, fs as any, {
      isNewFile: true,
      taskName: 'split',
    });
    expect(buf.has('codebase/old.ts')).toBe(true);

    await buf.delete('codebase/old.ts', 1, fs as any);

    expect(fs.deleted).toContain('codebase/old.ts');
    expect(buf.has('codebase/old.ts')).toBe(false);
    expect(buf.read('codebase/old.ts')).toBeNull();
    expect(buf.getAllWrittenPaths()).not.toContain('codebase/old.ts');
  });

  it('tombstones the path so a stale edit cannot resurrect it', async () => {
    await buf.write('codebase/old.ts', 'stale', 0, fs as any, {
      isNewFile: true,
      taskName: 'split',
    });
    await buf.delete('codebase/old.ts', 1, fs as any);

    // A write whose basis predates the deletion (edit / overwrite) is stale.
    const staleEdit = await buf.write('codebase/old.ts', 'stale', 2, fs as any, {
      expectedVersion: 1,
      taskName: 'sibling',
    });
    expect(staleEdit.success).toBe(false);
    expect(staleEdit.stale).toBe(true);

    const staleOverwrite = await buf.write(
      'codebase/old.ts',
      'stale',
      2,
      fs as any,
      { isOverwrite: true, taskName: 'sibling' },
    );
    expect(staleOverwrite.success).toBe(false);
    expect(staleOverwrite.stale).toBe(true);
  });

  it('allows a legitimate re-creation (isNewFile) and lifts the tombstone', async () => {
    await buf.write('codebase/old.ts', 'v1', 0, fs as any, {
      isNewFile: true,
      taskName: 'split',
    });
    await buf.delete('codebase/old.ts', 1, fs as any);

    const recreate = await buf.write('codebase/old.ts', 'fresh', 1, fs as any, {
      isNewFile: true,
      taskName: 'recreate',
    });
    expect(recreate.success).toBe(true);
    expect(buf.has('codebase/old.ts')).toBe(true);
    expect(fs.written.get('codebase/old.ts')).toBe('fresh');
  });
});

describe('WorkerFileSystem.deleteFile — routes through the buffer', () => {
  it('makes the deletion visible via has/fileExists/readFile', async () => {
    const buf = new SharedFileBuffer('codebase');
    const fs = new FakeFS();
    const worker = new WorkerFileSystem(fs as any, buf, 0, 'split');

    await worker.writeNewFile('codebase/old.ts', 'stale');
    expect(await worker.fileExists('codebase/old.ts')).toBe(true);

    await worker.deleteFile('codebase/old.ts');

    expect(buf.has('codebase/old.ts')).toBe(false);
    expect(await worker.fileExists('codebase/old.ts')).toBe(false);
    expect(await worker.readFile('codebase/old.ts')).toBeNull();
    expect(fs.deleted).toContain('codebase/old.ts');
  });

  it('prevents cross-worker resurrection: sibling that read pre-delete content cannot write it back', async () => {
    const buf = new SharedFileBuffer('codebase');
    const fs = new FakeFS();
    const workerA = new WorkerFileSystem(fs as any, buf, 0, 'delete-task');
    const workerB = new WorkerFileSystem(fs as any, buf, 1, 'sibling-task');

    // Monolith exists; sibling B reads it into its context (version tracked).
    await workerA.writeNewFile('codebase/monolith.test.ts', 'stale cases');
    const seen = await workerB.readFile('codebase/monolith.test.ts');
    expect(seen).toBe('stale cases');

    // A deletes it.
    await workerA.deleteFile('codebase/monolith.test.ts');

    // B re-emits the stale content it saw earlier → must be rejected, not resurrected.
    await expect(
      workerB.writeFile('codebase/monolith.test.ts', 'stale cases'),
    ).rejects.toBeInstanceOf(FileConflictError);

    expect(buf.has('codebase/monolith.test.ts')).toBe(false);
    expect(fs.written.has('codebase/monolith.test.ts')).toBe(false);
  });
});
