/**
 * Phase 1 — `launchMode` SSOT regression guard.
 *
 * Locks the FE rename from `backendMode` → `launchMode` and the priority
 * order of `determineInitialLaunchMode()`:
 *   1. legacy `'ant-ui:backend-mode'` migrates into `'ant-ui:launch-mode'`
 *   2. localStorage `'ant-ui:launch-mode'` wins over env
 *   3. `VITE_CLOUD_BACKEND_BASE` same-origin → 'cloud' (managed build)
 *   4. default → 'local'
 *
 * The source-level scan also enforces that no `state.backendMode` field
 * reference or `STORAGE_KEYS.BACKEND_MODE` key reference creeps back into
 * `packages/ant-ui/src`. The single legitimate occurrence of the legacy
 * key is the migration helper itself (`launchModeInit.ts`).
 *
 * `ant-ui` runs vitest in node-environment (no jsdom). The behaviour
 * specs therefore stub `localStorage` + `window.location` per case.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdir, readFile } from 'fs/promises';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..', 'src');
const MIGRATION_HELPER = path.join(SRC_ROOT, 'domain', 'store', 'launchModeInit.ts');

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('launchMode rename — source-level guard', () => {
  it('no `backendMode` field reference survives in ant-ui/src', async () => {
    const files = await walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      const text = await readFile(f, 'utf-8');
      if (/\bbackendMode\b|\bsetBackendMode\b|\bgetBackendMode\b/.test(text)) {
        offenders.push(path.relative(SRC_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('legacy storage key only appears inside the migration helper', async () => {
    const files = await walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      if (f === MIGRATION_HELPER) continue;
      const text = await readFile(f, 'utf-8');
      if (/['"]ant-ui:backend-mode['"]/.test(text) || /STORAGE_KEYS\.BACKEND_MODE/.test(text)) {
        offenders.push(path.relative(SRC_ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('new STORAGE_KEYS entry is named LAUNCH_MODE', async () => {
    const storage = await readFile(path.join(SRC_ROOT, 'domain', 'store', 'storage.ts'), 'utf-8');
    expect(storage).toMatch(/LAUNCH_MODE:\s*['"]ant-ui:launch-mode['"]/);
  });

  it('ConfigState carries `launchMode` (not `backendMode`)', async () => {
    const types = await readFile(path.join(SRC_ROOT, 'domain', 'store', 'types.ts'), 'utf-8');
    expect(types).toMatch(/launchMode:\s*'local'\s*\|\s*'cloud'/);
    expect(types).not.toMatch(/backendMode:\s*'local'\s*\|\s*'cloud'/);
  });
});

// Minimal localStorage stub so node-environment vitest can exercise the
// helper without spinning up jsdom (which `ant-ui` does not depend on).
function installBrowserStubs(href: string) {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { location: new URL(href) });
  return storage;
}

describe('determineInitialLaunchMode() — resolution priority', () => {
  const MANAGED = 'https://ant.crosstoken.io';

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv('VITE_CLOUD_BACKEND_BASE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('1) migrates legacy `ant-ui:backend-mode` → `ant-ui:launch-mode` and returns the legacy value', async () => {
    const storage = installBrowserStubs(MANAGED + '/app');
    storage.setItem('ant-ui:backend-mode', 'cloud');
    const { determineInitialLaunchMode } = await import('../../src/domain/store/launchModeInit');
    expect(determineInitialLaunchMode()).toBe('cloud');
    expect(storage.getItem('ant-ui:launch-mode')).toBe('cloud');
    expect(storage.getItem('ant-ui:backend-mode')).toBeNull();
  });

  it('2) localStorage wins over VITE_CLOUD_BACKEND_BASE', async () => {
    const storage = installBrowserStubs(MANAGED + '/app');
    storage.setItem('ant-ui:launch-mode', 'local');
    vi.stubEnv('VITE_CLOUD_BACKEND_BASE', MANAGED);
    const { determineInitialLaunchMode } = await import('../../src/domain/store/launchModeInit');
    expect(determineInitialLaunchMode()).toBe('local');
  });

  it('3) no localStorage + same-origin cloudBase → cloud (managed build)', async () => {
    installBrowserStubs(MANAGED + '/app');
    vi.stubEnv('VITE_CLOUD_BACKEND_BASE', MANAGED);
    const { determineInitialLaunchMode } = await import('../../src/domain/store/launchModeInit');
    expect(determineInitialLaunchMode()).toBe('cloud');
  });

  it('4) no localStorage + cloudBase unset → local default', async () => {
    installBrowserStubs('http://localhost:5173/');
    const { determineInitialLaunchMode } = await import('../../src/domain/store/launchModeInit');
    expect(determineInitialLaunchMode()).toBe('local');
  });

  it('5) no localStorage + cloudBase external-origin → local (Persona A localhost dev)', async () => {
    installBrowserStubs('http://localhost:5173/');
    vi.stubEnv('VITE_CLOUD_BACKEND_BASE', MANAGED);
    const { determineInitialLaunchMode } = await import('../../src/domain/store/launchModeInit');
    expect(determineInitialLaunchMode()).toBe('local');
  });

  it('isManagedBuild mirrors same-origin detection', async () => {
    installBrowserStubs(MANAGED + '/app');
    vi.stubEnv('VITE_CLOUD_BACKEND_BASE', MANAGED);
    const { isManagedBuild } = await import('../../src/domain/store/launchModeInit');
    expect(isManagedBuild()).toBe(true);
  });

  it('isManagedBuild is false on external-origin cloudBase', async () => {
    installBrowserStubs('http://localhost:5173/');
    vi.stubEnv('VITE_CLOUD_BACKEND_BASE', MANAGED);
    const { isManagedBuild } = await import('../../src/domain/store/launchModeInit');
    expect(isManagedBuild()).toBe(false);
  });
});
