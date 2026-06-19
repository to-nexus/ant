/**
 * Locks `resolveRunScript` / `hasRunnableScript` — the SSOT for "which npm
 * script starts a dev preview" and "is this package runnable".
 *
 * RCA `full-missing-heron`: a NestJS backend (idiomatic scaffold — scripts are
 * `start` / `start:dev`, NO `dev`) crashed under preview because the spawner
 * hardcoded `npm run dev` → `npm error Missing script: "dev"`. The frontend
 * worked only because vite/next have dedicated spawn branches that bypass
 * scripts. The fix resolves the project's own declared dev script instead of
 * assuming `dev`, preferring `start:dev` over plain `start` for backends
 * (backend `start` is typically `node dist/main`, requiring a prior build).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRunScript,
  hasRunnableScript,
} from '../../src/periphery/adapters/http/services/PreviewService/detectors/PackageDetector';

const pkg = (scripts: Record<string, string>) => ({ scripts });

describe('resolveRunScript', () => {
  it('NestJS backend → start:dev (preferred over plain start)', () => {
    const nest = pkg({
      build: 'nest build',
      start: 'node dist/main',
      'start:dev': 'nest start --watch',
    });
    expect(resolveRunScript(nest, 'backend')).toBe('start:dev');
  });

  it('plain Express backend → start', () => {
    expect(resolveRunScript(pkg({ start: 'node index.js' }), 'backend')).toBe('start');
  });

  it('backend with explicit dev → dev wins over everything', () => {
    const p = pkg({ dev: 'tsx watch src', start: 'node dist/main', 'start:dev': 'nest start --watch' });
    expect(resolveRunScript(p, 'backend')).toBe('dev');
  });

  it('Vite frontend → dev', () => {
    expect(resolveRunScript(pkg({ dev: 'vite', build: 'vite build' }), 'frontend')).toBe('dev');
  });

  it('CRA frontend (no dev) → start', () => {
    expect(resolveRunScript(pkg({ start: 'react-scripts start', build: 'react-scripts build' }), 'frontend')).toBe('start');
  });

  it('no runnable script → undefined (build-only library)', () => {
    expect(resolveRunScript(pkg({ build: 'tsc' }), 'backend')).toBeUndefined();
    expect(resolveRunScript(pkg({ build: 'tsc' }), 'frontend')).toBeUndefined();
  });

  it('ignores empty / whitespace script bodies', () => {
    expect(resolveRunScript(pkg({ dev: '   ', start: 'node index.js' }), 'backend')).toBe('start');
  });

  it('tolerates missing scripts object', () => {
    expect(resolveRunScript({}, 'backend')).toBeUndefined();
    expect(resolveRunScript(undefined, 'backend')).toBeUndefined();
  });
});

describe('hasRunnableScript (type-agnostic superset gate)', () => {
  it('true for any recognized dev-server script', () => {
    expect(hasRunnableScript(pkg({ 'start:dev': 'nest start --watch' }))).toBe(true);
    expect(hasRunnableScript(pkg({ dev: 'vite' }))).toBe(true);
    expect(hasRunnableScript(pkg({ start: 'node index.js' }))).toBe(true);
    expect(hasRunnableScript(pkg({ serve: 'http-server' }))).toBe(true);
  });

  it('false for build-only / script-less packages', () => {
    expect(hasRunnableScript(pkg({ build: 'tsc', test: 'jest' }))).toBe(false);
    expect(hasRunnableScript({})).toBe(false);
  });

  it('is a superset of the legacy `dev || start` gate (never drops a previously-included package)', () => {
    // Anything the old gate accepted, the new gate must still accept.
    expect(hasRunnableScript(pkg({ dev: 'x' }))).toBe(true);
    expect(hasRunnableScript(pkg({ start: 'x' }))).toBe(true);
  });
});
