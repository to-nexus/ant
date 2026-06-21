/**
 * Locks `ProcessSpawner.backfillMockToggles` — the file-based default-ON
 * guarantee that replaced the former runtime `mockToggleDefaults` injection.
 *
 * Default-ON now lives in `.env` (one SSOT): a greenfield business connection
 * whose toggle is absent gets `=true` written (framework-preferred name) so the
 * generated factory reads a real value and boots mocked instead of hitting
 * ECONNREFUSED. Idempotent — an explicit `.env` toggle (the user opting into
 * the real backend via the UI) is preserved.
 *
 * See docs/internals/38-service-virtualization.md §6.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProcessSpawner } from '../../src/periphery/adapters/http/services/PreviewService/managers/ProcessSpawner';
import type { ServiceConnection } from '../../src/core/ports/portRegistry';

const backfill = (
  spawner: ProcessSpawner,
  connections: ServiceConnection[] | undefined,
  packageSource: string | undefined,
  pkgPath: string,
): void => (spawner as any).backfillMockToggles(connections, packageSource, pkgPath);

const readEnv = (dir: string): string => {
  const p = path.join(dir, '.env');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
};

const businessConn = (over: Partial<ServiceConnection> = {}): ServiceConnection => ({
  id: 'backend-api',
  name: 'backend-api',
  category: 'business',
  envVar: 'NEXT_PUBLIC_API_BASE_URL',
  value: '',
  resolution: { type: 'url', url: '' },
  source: '*',
  virtualization: { toggleEnvVar: 'USE_MOCK_BACKEND_API', active: false },
  ...over,
});

describe('ProcessSpawner.backfillMockToggles (SV §6, file SSOT)', () => {
  let dir: string;
  const spawner = new ProcessSpawner();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-svtoggle-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writePkg = (deps: Record<string, string>) =>
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: deps }));

  it('Next.js: writes the NEXT_PUBLIC_ toggle = true to .env', () => {
    writePkg({ next: '15.0.0' });
    backfill(spawner, [businessConn()], '*', dir);
    expect(readEnv(dir)).toContain('NEXT_PUBLIC_USE_MOCK_BACKEND_API=true');
  });

  it('Vite: writes the VITE_ toggle', () => {
    writePkg({ vite: '5.0.0' });
    backfill(spawner, [businessConn()], '*', dir);
    expect(readEnv(dir)).toContain('VITE_USE_MOCK_BACKEND_API=true');
  });

  it('backend (no bundler): writes the bare toggle only', () => {
    writePkg({ express: '4.0.0' });
    backfill(spawner, [businessConn()], '*', dir);
    const env = readEnv(dir);
    expect(env).toContain('USE_MOCK_BACKEND_API=true');
    expect(env).not.toContain('NEXT_PUBLIC_');
    expect(env).not.toContain('VITE_');
  });

  it('infrastructure connection → .env untouched (never virtualized)', () => {
    writePkg({ next: '15.0.0' });
    const infra: ServiceConnection = {
      id: 'postgres',
      name: 'postgres',
      category: 'infrastructure',
      envVar: 'DATABASE_URL',
      value: 'postgres://localhost:5432/db',
      resolution: { type: 'docker', service: 'postgres' },
      source: '*',
    };
    backfill(spawner, [infra], '*', dir);
    expect(readEnv(dir)).toBe('');
  });

  it('preserves an explicit user toggle (=false) — idempotent skip', () => {
    writePkg({ next: '15.0.0' });
    fs.writeFileSync(path.join(dir, '.env'), 'NEXT_PUBLIC_USE_MOCK_BACKEND_API=false\n');
    backfill(spawner, [businessConn()], '*', dir);
    const env = readEnv(dir);
    expect(env).toContain('NEXT_PUBLIC_USE_MOCK_BACKEND_API=false');
    expect(env).not.toContain('=true');
  });

  it('idempotent — a second backfill adds no duplicate line', () => {
    writePkg({ vite: '5.0.0' });
    backfill(spawner, [businessConn()], '*', dir);
    backfill(spawner, [businessConn()], '*', dir);
    const occurrences = readEnv(dir)
      .split('\n')
      .filter(l => l.includes('USE_MOCK_BACKEND_API')).length;
    expect(occurrences).toBe(1);
  });

  it('covers a pattern-detected toggle name that differs from conn.name', () => {
    writePkg({ vite: '5.0.0' });
    const conn = businessConn({
      id: 'api#1',
      name: 'api#1',
      virtualization: { toggleEnvVar: 'USE_MOCK_API', active: false },
    });
    backfill(spawner, [conn], '*', dir);
    expect(readEnv(dir)).toContain('VITE_USE_MOCK_API=true');
  });

  it('filters by package source — foreign-package connection is skipped', () => {
    writePkg({ next: '15.0.0' });
    const conn = businessConn({ source: 'apps/web' });
    backfill(spawner, [conn], 'apps/api', dir);
    expect(readEnv(dir)).toBe('');
    backfill(spawner, [conn], 'apps/web', dir);
    expect(readEnv(dir)).toContain('USE_MOCK_BACKEND_API=true');
  });

  it('no connections → .env untouched', () => {
    writePkg({ next: '15.0.0' });
    backfill(spawner, [], '*', dir);
    backfill(spawner, undefined, '*', dir);
    expect(readEnv(dir)).toBe('');
  });
});
