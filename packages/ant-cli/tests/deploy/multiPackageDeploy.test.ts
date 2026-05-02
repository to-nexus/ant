import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  DeployMetaStore,
  type DeployMeta,
} from '../../src/infrastructure/deploy/DeployMetaStore';

/**
 * v1 → v2 in-memory lift contract.
 *
 * Pre-multi-package builds wrote `meta.json` with single-package fields at the
 * top level. After the upgrade, `read()` must return a v2-shaped object
 * (`packages: [...]`) so DeployService can rehydrate all packages with the
 * same code path. The on-disk file stays v1 until the next `write()` overwrites
 * it — confirms the migration is forward-only and idempotent.
 */
describe('DeployMetaStore v1 → v2 lift', () => {
  let workspacePath: string;
  let store: DeployMetaStore;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-deploy-meta-'));
    store = new DeployMetaStore();
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it('lifts a v1 meta.json into the v2 packages[] shape on read', async () => {
    const v1 = {
      version: 1,
      tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat',
      framework: 'nextjs',
      workspacePath,
      buildOutputDir: path.join(workspacePath, '.next'),
      basePath: '/deploy/org--user--proj--feat',
      urlKey: 'org--user--proj--feat',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const dir = path.join(workspacePath, '.deploy');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(v1));

    const lifted = await store.read(workspacePath);
    expect(lifted).not.toBeNull();
    expect(lifted!.version).toBe(2);
    expect(lifted!.packages).toHaveLength(1);

    const pkg = lifted!.packages[0];
    // The lift must preserve every field needed by `startStaticServer`:
    expect(pkg.name).toBe('root');
    expect(pkg.slug).toBe('root');
    expect(pkg.framework).toBe('nextjs');
    expect(pkg.workspacePath).toBe(workspacePath);
    expect(pkg.buildOutputDir).toBe(path.join(workspacePath, '.next'));
    expect(pkg.basePath).toBe('/deploy/org--user--proj--feat');
    expect(pkg.urlKey).toBe('org--user--proj--feat');
  });

  it('reads a v2 meta.json untouched (no double-lift)', async () => {
    const v2: DeployMeta = {
      version: 2,
      tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat',
      workspacePath,
      packages: [
        {
          name: 'apps/web',
          slug: 'apps-web',
          framework: 'nextjs',
          workspacePath: path.join(workspacePath, 'apps', 'web'),
          buildOutputDir: path.join(workspacePath, 'apps', 'web', '.next'),
          basePath: '/deploy/org--user--proj--feat--apps-web',
          urlKey: 'org--user--proj--feat--apps-web',
        },
        {
          name: 'apps/admin',
          slug: 'apps-admin',
          framework: 'vite',
          workspacePath: path.join(workspacePath, 'apps', 'admin'),
          buildOutputDir: path.join(workspacePath, 'apps', 'admin', 'dist'),
          basePath: '/deploy/org--user--proj--feat--apps-admin',
          urlKey: 'org--user--proj--feat--apps-admin',
        },
      ],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    await store.write(workspacePath, v2);

    const read = await store.read(workspacePath);
    expect(read).toEqual(v2);
  });

  it('returns null for a corrupt / future-version meta', async () => {
    const dir = path.join(workspacePath, '.deploy');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ version: 99 }));

    const result = await store.read(workspacePath);
    expect(result).toBeNull();
  });

  it('returns null when meta.json does not exist', async () => {
    const result = await store.read(workspacePath);
    expect(result).toBeNull();
  });

  it('write+read v2 round-trip preserves all fields', async () => {
    const v2: DeployMeta = {
      version: 2,
      tenantId: 'org', userId: 'user', projectId: 'proj', feature: 'feat',
      workspacePath,
      packages: [
        {
          name: 'web',
          slug: 'web',
          framework: 'vite',
          workspacePath,
          buildOutputDir: path.join(workspacePath, 'dist'),
          basePath: '/deploy/org--user--proj--feat',
          urlKey: 'org--user--proj--feat',
        },
      ],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    await store.write(workspacePath, v2);

    const back = await store.read(workspacePath);
    expect(back).toEqual(v2);
  });
});

/**
 * Aggregate phase rule (mirror of DeployService.aggregatePhase). Pinned here
 * because the FE renders the deploy badge based on this aggregate — drift
 * would silently flip the UI between "running" and "error" for the same
 * package combination.
 */
describe('Deploy aggregate phase', () => {
  function aggregatePhase(packages: Array<{ phase: string }>): string {
    if (packages.length === 0) return 'idle';
    if (packages.some(p => p.phase === 'error')) return 'error';
    if (packages.some(p => p.phase === 'building')) return 'building';
    if (packages.some(p => p.phase === 'deploying')) return 'deploying';
    if (packages.some(p => p.phase === 'starting')) return 'starting';
    if (packages.every(p => p.phase === 'running')) return 'running';
    if (packages.every(p => p.phase === 'hibernated')) return 'hibernated';
    if (packages.every(p => p.phase === 'stopped')) return 'stopped';
    return packages.find(p => p.phase !== 'running')?.phase || 'running';
  }

  it('any error → error', () => {
    expect(aggregatePhase([{ phase: 'running' }, { phase: 'error' }])).toBe('error');
  });

  it('all running → running', () => {
    expect(aggregatePhase([{ phase: 'running' }, { phase: 'running' }])).toBe('running');
  });

  it('any building → building', () => {
    expect(aggregatePhase([{ phase: 'running' }, { phase: 'building' }])).toBe('building');
  });

  it('all hibernated → hibernated', () => {
    expect(aggregatePhase([{ phase: 'hibernated' }, { phase: 'hibernated' }])).toBe('hibernated');
  });

  it('mixed running + hibernated → first non-running phase (degrades gracefully)', () => {
    expect(aggregatePhase([{ phase: 'running' }, { phase: 'hibernated' }])).toBe('hibernated');
  });

  it('empty packages → idle', () => {
    expect(aggregatePhase([])).toBe('idle');
  });
});
