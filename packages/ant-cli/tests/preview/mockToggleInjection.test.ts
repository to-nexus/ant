/**
 * Locks `ProcessSpawner.mockToggleDefaults` — the Service Virtualization §6
 * runtime mock-boot guarantee.
 *
 * A greenfield app declares its mock toggle only in `.env.example`, which the
 * spawner never copies to `.env`. Without a spawn-time default the generated
 * factory reads an unset toggle and boots the production adapter →
 * ECONNREFUSED. The spawner therefore seeds every business connection's toggle
 * to `true`, BELOW `.env` in the env chain so an explicit `.env` `=false`
 * (the user opting into the real backend) always wins.
 *
 * See docs/internals/38-service-virtualization.md §6.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProcessSpawner } from '../../src/periphery/adapters/http/services/PreviewService/managers/ProcessSpawner';
import type { ServiceConnection } from '../../src/core/ports/portRegistry';

const defaults = (
  spawner: ProcessSpawner,
  connections: ServiceConnection[] | undefined,
  packageSource: string | undefined,
  pkgPath: string,
): Record<string, string> =>
  (spawner as any).mockToggleDefaults(connections, packageSource, pkgPath);

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

describe('ProcessSpawner.mockToggleDefaults (SV §6)', () => {
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

  it('Next.js: emits bare + NEXT_PUBLIC_ toggle, set true', () => {
    writePkg({ next: '15.0.0' });
    const env = defaults(spawner, [businessConn()], '*', dir);
    expect(env['USE_MOCK_BACKEND_API']).toBe('true');
    expect(env['NEXT_PUBLIC_USE_MOCK_BACKEND_API']).toBe('true');
  });

  it('Vite: emits bare + VITE_ toggle', () => {
    writePkg({ vite: '5.0.0' });
    const env = defaults(spawner, [businessConn()], '*', dir);
    expect(env['USE_MOCK_BACKEND_API']).toBe('true');
    expect(env['VITE_USE_MOCK_BACKEND_API']).toBe('true');
  });

  it('backend (no bundler): emits bare toggle only', () => {
    writePkg({ express: '4.0.0' });
    const env = defaults(spawner, [businessConn()], '*', dir);
    expect(env['USE_MOCK_BACKEND_API']).toBe('true');
    expect(env['NEXT_PUBLIC_USE_MOCK_BACKEND_API']).toBeUndefined();
    expect(env['VITE_USE_MOCK_BACKEND_API']).toBeUndefined();
  });

  it('infrastructure connection → no toggle (never virtualized)', () => {
    writePkg({ next: '15.0.0' });
    const infra: ServiceConnection = {
      id: 'postgres',
      name: 'postgres',
      category: 'infrastructure',
      envVar: 'DATABASE_URL',
      value: 'postgres://localhost:5432/db',
      resolution: { type: 'docker', service: 'postgres' },
      source: '*',
      // no virtualization
    };
    const env = defaults(spawner, [infra], '*', dir);
    expect(env).toEqual({});
  });

  it('covers a pattern-detected toggle name that differs from conn.name', () => {
    writePkg({ vite: '5.0.0' });
    // Detector derived the toggle from a nameHint ("API"), not the synthetic id.
    const conn = businessConn({
      id: 'api#1',
      name: 'api#1',
      virtualization: { toggleEnvVar: 'USE_MOCK_API', active: false },
    });
    const env = defaults(spawner, [conn], '*', dir);
    expect(env['USE_MOCK_API']).toBe('true');
    expect(env['VITE_USE_MOCK_API']).toBe('true');
  });

  it('filters by package source — foreign-package connection is skipped', () => {
    writePkg({ next: '15.0.0' });
    const conn = businessConn({ source: 'apps/web' });
    expect(defaults(spawner, [conn], 'apps/api', dir)).toEqual({});
    expect(defaults(spawner, [conn], 'apps/web', dir)['USE_MOCK_BACKEND_API']).toBe('true');
  });

  it('no connections → empty', () => {
    writePkg({ next: '15.0.0' });
    expect(defaults(spawner, [], '*', dir)).toEqual({});
    expect(defaults(spawner, undefined, '*', dir)).toEqual({});
  });
});
