/**
 * compressPathsByFolder — fold full-folder selections into a single
 * `folder` entry, leaving partial / single-file selections untouched.
 */
import { describe, it, expect, vi } from 'vitest';
import { compressPathsByFolder } from '../../../src/core/context/compressPathsByFolder';
import type { FileSystemPort } from '../../../src/core/ports/filesystem';

function makeFS(
  layout: Record<string, Array<{ name: string; isDirectory: boolean }>>,
  failOn: Set<string> = new Set(),
): FileSystemPort {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    fileExists: vi.fn(),
    deleteFile: vi.fn(),
    readDirectory: vi.fn(async (p: string) => {
      if (failOn.has(p)) throw new Error(`mock fail on ${p}`);
      return layout[p] ?? [];
    }),
    createDirectory: vi.fn(),
    listFiles: vi.fn(),
    isDirectory: vi.fn(),
    copyFile: vi.fn(),
    moveFile: vi.fn(),
  } as unknown as FileSystemPort;
}

describe('compressPathsByFolder', () => {
  it('returns empty for empty input', async () => {
    const out = await compressPathsByFolder([], makeFS({}));
    expect(out).toEqual([]);
  });

  it('keeps a single file as a file entry', async () => {
    const out = await compressPathsByFolder(
      ['architecture/spec/spec-auth.md'],
      makeFS({}),
    );
    expect(out).toEqual([{ kind: 'file', path: 'architecture/spec/spec-auth.md' }]);
  });

  it('compresses a fully-matched folder into one folder entry', async () => {
    const fs = makeFS({
      'architecture/spec': [
        { name: 'spec-auth.md', isDirectory: false },
        { name: 'spec-payment.md', isDirectory: false },
        { name: 'spec-user.md', isDirectory: false },
      ],
    });
    const out = await compressPathsByFolder(
      [
        'architecture/spec/spec-auth.md',
        'architecture/spec/spec-payment.md',
        'architecture/spec/spec-user.md',
      ],
      fs,
    );
    expect(out).toEqual([
      { kind: 'folder', path: 'architecture/spec', fileCount: 3 },
    ]);
  });

  it('keeps partial folder selection as individual files', async () => {
    const fs = makeFS({
      'architecture/spec': [
        { name: 'spec-auth.md', isDirectory: false },
        { name: 'spec-payment.md', isDirectory: false },
        { name: 'spec-user.md', isDirectory: false },
      ],
    });
    const out = await compressPathsByFolder(
      ['architecture/spec/spec-auth.md', 'architecture/spec/spec-payment.md'],
      fs,
    );
    expect(out).toEqual([
      { kind: 'file', path: 'architecture/spec/spec-auth.md' },
      { kind: 'file', path: 'architecture/spec/spec-payment.md' },
    ]);
  });

  it('ignores sub-directories when judging full-folder match', async () => {
    const fs = makeFS({
      'architecture/spec': [
        { name: 'spec-auth.md', isDirectory: false },
        { name: 'spec-user.md', isDirectory: false },
        { name: 'nested', isDirectory: true },
      ],
    });
    const out = await compressPathsByFolder(
      [
        'architecture/spec/spec-auth.md',
        'architecture/spec/spec-user.md',
      ],
      fs,
    );
    expect(out).toEqual([
      { kind: 'folder', path: 'architecture/spec', fileCount: 2 },
    ]);
  });

  it('mixes compressed folder and stand-alone file in different parents', async () => {
    const fs = makeFS({
      'architecture/spec': [
        { name: 'spec-auth.md', isDirectory: false },
        { name: 'spec-user.md', isDirectory: false },
      ],
      'plan': [
        { name: 'prd.md', isDirectory: false },
        { name: 'gdd.md', isDirectory: false },
      ],
    });
    const out = await compressPathsByFolder(
      [
        'architecture/spec/spec-auth.md',
        'architecture/spec/spec-user.md',
        'plan/prd.md', // partial — plan has 2 files but only 1 selected
      ],
      fs,
    );
    expect(out).toEqual([
      { kind: 'folder', path: 'architecture/spec', fileCount: 2 },
      { kind: 'file', path: 'plan/prd.md' },
    ]);
  });

  it('preserves the original first-occurrence order', async () => {
    const fs = makeFS({
      'a': [
        { name: 'x.md', isDirectory: false },
        { name: 'y.md', isDirectory: false },
      ],
      'b': [{ name: 'z.md', isDirectory: false }],
    });
    const out = await compressPathsByFolder(
      ['b/z.md', 'a/x.md', 'a/y.md'],
      fs,
    );
    expect(out).toEqual([
      { kind: 'file', path: 'b/z.md' },
      { kind: 'folder', path: 'a', fileCount: 2 },
    ]);
  });

  it('dedupes repeated paths before grouping', async () => {
    const fs = makeFS({
      'spec': [
        { name: 'a.md', isDirectory: false },
        { name: 'b.md', isDirectory: false },
      ],
    });
    const out = await compressPathsByFolder(
      ['spec/a.md', 'spec/b.md', 'spec/a.md'],
      fs,
    );
    expect(out).toEqual([{ kind: 'folder', path: 'spec', fileCount: 2 }]);
  });

  it('falls back to files when readDirectory throws', async () => {
    const fs = makeFS(
      {},
      new Set(['architecture/spec']),
    );
    const out = await compressPathsByFolder(
      ['architecture/spec/spec-auth.md', 'architecture/spec/spec-user.md'],
      fs,
    );
    expect(out).toEqual([
      { kind: 'file', path: 'architecture/spec/spec-auth.md' },
      { kind: 'file', path: 'architecture/spec/spec-user.md' },
    ]);
  });

  it('does not compress when parent is root (.)', async () => {
    const fs = makeFS({
      '.': [
        { name: 'a.md', isDirectory: false },
        { name: 'b.md', isDirectory: false },
      ],
    });
    const out = await compressPathsByFolder(['a.md', 'b.md'], fs);
    expect(out).toEqual([
      { kind: 'file', path: 'a.md' },
      { kind: 'file', path: 'b.md' },
    ]);
  });
});
