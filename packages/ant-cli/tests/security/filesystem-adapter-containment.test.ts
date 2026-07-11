import { describe, it, expect, afterAll } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';

// C3 (security review): the relative-path branch of resolveAbsolute must reject
// a sibling directory that merely shares the basePath as a string prefix
// (e.g. /ws/proj vs /ws/proj-secrets). Previously the missing path.sep let it
// through.
describe('FileSystemAdapter.resolveAbsolute containment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsa-'));
  const base = path.join(root, 'proj');
  fs.mkdirSync(path.join(root, 'proj-secrets'), { recursive: true });
  const adapter = new FileSystemAdapter(base);

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('rejects a prefix-sibling escape via relative path', () => {
    expect(() => adapter.resolveAbsolute('../proj-secrets/x')).toThrow(/traversal/i);
  });

  it('allows an in-workspace relative path', () => {
    expect(adapter.resolveAbsolute('sub/file.txt')).toBe(path.join(base, 'sub/file.txt'));
  });

  it('allows the workspace root itself', () => {
    expect(adapter.resolveAbsolute('.')).toBe(base);
  });
});
