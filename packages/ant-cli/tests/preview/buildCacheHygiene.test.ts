/**
 * Locks `ProcessSpawner.clearStaleIncrementalBuildCache` — the preview hygiene
 * step that purges stale TypeScript incremental build caches before a Node dev
 * server starts.
 *
 * RCA `full-missing-heron`: a NestJS backend committed `tsconfig.tsbuildinfo`
 * at the project root. `nest start --watch` (`deleteOutDir: true`) wiped dist/
 * but the root-level buildinfo survived, so `incremental: true` tsc reported
 * "Found 0 errors" yet emitted nothing — `dist/main.js` was never produced and
 * `node dist/main` crashed with MODULE_NOT_FOUND. The persisted preview
 * workspace makes this recur every restart, so the durable fix purges the
 * stale buildinfo before each dev start.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProcessSpawner } from '../../src/periphery/adapters/http/services/PreviewService/managers/ProcessSpawner';

// The method is private; exercise it via a typed escape hatch (same pattern as
// other unit tests that probe internal helpers).
const purge = (spawner: ProcessSpawner, dir: string): void =>
  (spawner as any).clearStaleIncrementalBuildCache(dir, () => {});

describe('ProcessSpawner.clearStaleIncrementalBuildCache', () => {
  let dir: string;
  const spawner = new ProcessSpawner();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-buildcache-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes root-level *.tsbuildinfo files', () => {
    fs.writeFileSync(path.join(dir, 'tsconfig.tsbuildinfo'), '{}');
    fs.writeFileSync(path.join(dir, 'tsconfig.build.tsbuildinfo'), '{}');

    purge(spawner, dir);

    expect(fs.existsSync(path.join(dir, 'tsconfig.tsbuildinfo'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'tsconfig.build.tsbuildinfo'))).toBe(false);
  });

  it('leaves source files and configs untouched', () => {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'main.ts'), 'export {};');
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, 'tsconfig.tsbuildinfo'), '{}');

    purge(spawner, dir);

    expect(fs.existsSync(path.join(dir, 'src', 'main.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'tsconfig.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'tsconfig.tsbuildinfo'))).toBe(false);
  });

  it('is idempotent — no throw when there is no cache to clear', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    expect(() => purge(spawner, dir)).not.toThrow();
    // second pass on an already-clean dir
    expect(() => purge(spawner, dir)).not.toThrow();
  });

  it('does not throw on a missing directory', () => {
    expect(() => purge(spawner, path.join(dir, 'does-not-exist'))).not.toThrow();
  });
});
