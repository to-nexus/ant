/**
 * Locks `PackageDetector.isBundlerWatchScript` — the SSOT discriminator that
 * keeps the preview server from spawning a library (build-watcher dev script)
 * as a runnable frontend.
 *
 * RCA `lucky-jumping-apple`: a monorepo `packages/ui` with `dev: "tsup --watch"`
 * was classified frontend (react dep) and included as a runnable target merely
 * because it had a `dev` script, then spawned via `npm run dev` on a port — a
 * useless preview entry. The fix excludes bundler-watch dev scripts. It is
 * EXCLUSION-based (not an allowlist) so apps with non-standard dev servers
 * (`node server.js`, `concurrently`, ...) stay included.
 */

import { describe, it, expect } from 'vitest';
import { PackageDetector } from '../../src/periphery/adapters/http/services/PreviewService/detectors/PackageDetector';

describe('PackageDetector.isBundlerWatchScript', () => {
  const d = new PackageDetector();

  it('excludes bundler watchers (the false-positive class)', () => {
    expect(d.isBundlerWatchScript('tsup --watch')).toBe(true);
    expect(d.isBundlerWatchScript('tsup')).toBe(true);
    expect(d.isBundlerWatchScript('rollup -c --watch')).toBe(true);
    expect(d.isBundlerWatchScript('rollup -cw')).toBe(true);
    expect(d.isBundlerWatchScript('tsc --watch')).toBe(true);
    expect(d.isBundlerWatchScript('tsc -w')).toBe(true);
    expect(d.isBundlerWatchScript('esbuild src/index.ts --bundle --watch')).toBe(true);
  });

  it('does NOT exclude real dev servers — standard', () => {
    expect(d.isBundlerWatchScript('next dev')).toBe(false);
    expect(d.isBundlerWatchScript('vite')).toBe(false);
    expect(d.isBundlerWatchScript('vite --port 3000')).toBe(false);
    expect(d.isBundlerWatchScript('react-scripts start')).toBe(false);
  });

  it('does NOT exclude real apps with NON-standard dev scripts (exclusion-side-effect guard)', () => {
    // The whole point of exclusion-based (vs allowlist): these must stay included.
    expect(d.isBundlerWatchScript('node server.js')).toBe(false);
    expect(d.isBundlerWatchScript('concurrently "npm:dev:*"')).toBe(false);
    expect(d.isBundlerWatchScript('storybook dev -p 6006')).toBe(false);
    expect(d.isBundlerWatchScript('make dev')).toBe(false);
    // a plain `rollup` build (no watch) is not a dev script we'd exclude here
    expect(d.isBundlerWatchScript('rollup -c')).toBe(false);
  });

  it('handles missing script', () => {
    expect(d.isBundlerWatchScript(undefined)).toBe(false);
    expect(d.isBundlerWatchScript('')).toBe(false);
  });
});
