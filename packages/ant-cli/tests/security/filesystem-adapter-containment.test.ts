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

/**
 * M-NEW-005: `resolveAbsolute` is a lexical test, so a symlink planted inside the
 * workspace passed it and `readFile` followed it out. What this adapter reads is
 * put straight into a model prompt (execute's modify-target section, the
 * `read_file` tool result), so the sink was a live-secret file leaving in an
 * external provider request. Reads now go through the containment SSOT.
 */
describe('FileSystemAdapter read/write containment (M-NEW-005)', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fsa-symlink-'));
  const base = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(base, 'codebase', 'src'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'environ'), 'ANT_ENCRYPTION_KEY=live-secret', 'utf-8');
  fs.writeFileSync(path.join(base, 'codebase', 'src', 'real.ts'), 'export const ok = 1;', 'utf-8');
  const adapter = new FileSystemAdapter(base);

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reads a normal workspace file', async () => {
    expect(await adapter.readFile('codebase/src/real.ts')).toBe('export const ok = 1;');
  });

  it('refuses a leaf symlink pointing out of the workspace', async () => {
    fs.symlinkSync(path.join(outside, 'environ'), path.join(base, 'codebase', 'src', 'worker-env.ts'));
    expect(await adapter.readFile('codebase/src/worker-env.ts')).toBeNull();
  });

  it('refuses an intermediate directory symlink pointing out of the workspace', async () => {
    fs.symlinkSync(outside, path.join(base, 'jump'));
    expect(await adapter.readFile('jump/environ')).toBeNull();
  });

  it('follows a symlink that stays inside the workspace', async () => {
    fs.symlinkSync(path.join(base, 'codebase'), path.join(base, 'codebase-link'));
    expect(await adapter.readFile('codebase-link/src/real.ts')).toBe('export const ok = 1;');
  });

  it('refuses to write through a directory symlink pointing out of the workspace', async () => {
    await expect(adapter.writeFile('jump/planted.ts', 'payload')).rejects.toThrow();
    expect(fs.existsSync(path.join(outside, 'planted.ts'))).toBe(false);
  });

  it('still writes a normal nested workspace file', async () => {
    await adapter.writeFile('codebase/src/nested/new.ts', 'body');
    expect(fs.readFileSync(path.join(base, 'codebase/src/nested/new.ts'), 'utf-8')).toBe('body');
  });
});
