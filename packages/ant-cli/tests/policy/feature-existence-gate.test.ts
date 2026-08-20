/**
 * Feature-existence authority gate — M-NEW-017 / M-NEW-008.
 *
 * File mutation and file-tree cache routes must resolve the authoritative
 * feature reference (`ProjectService.resolveExistingFeatureForMutation`) BEFORE
 * touching disk or Redis. An arbitrary `:feature` slug that was never created
 * must not materialize a ghost feature directory (M-NEW-017) or a 24h ghost
 * file-tree cache key (M-NEW-008). One axis, one file, one row per route.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import type * as http from 'http';

import { createFilesRoutes } from '../../src/periphery/adapters/http/routes/files.routes';

describe('feature-existence gate on file routes', () => {
  let server: http.Server;

  const start = (exists: boolean) => {
    const writeFile = vi.fn(async () => ({ path: 'plan/a.md' }));
    const getFileTree = vi.fn(async () => [{ name: 'root', path: '', type: 'directory', children: [] }]);
    const setFileTreeCache = vi.fn(async () => {});

    const projectService = {
      writeFile,
      getFileTree,
      resolveExistingFeatureForMutation: async () => (exists ? '/tmp/feat' : null),
      workspaceResolver: { getFeaturePath: () => '/tmp/feat' },
    } as any;
    const stateStore = { getFileTreeCache: async () => null, setFileTreeCache } as any;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: 'u1' };
      (req as any).organization = { id: 'o1', kind: 'team' };
      next();
    });
    app.use(createFilesRoutes({ projectService, stateStore }));
    return new Promise<{ base: string; spies: { writeFile: any; getFileTree: any; setFileTreeCache: any } }>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        resolve({
          base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
          spies: { writeFile, getFileTree, setFileTreeCache },
        });
      });
    });
  };

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('PUT to a nonexistent feature is 404 and writes nothing', async () => {
    const { base, spies } = await start(false);
    const res = await fetch(`${base}/projects/p1/features/ghost/files/plan/a.md`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    });
    expect(res.status).toBe(404);
    expect(spies.writeFile).not.toHaveBeenCalled();
  });

  it('PUT to an existing feature proceeds to the write', async () => {
    const { base, spies } = await start(true);
    const res = await fetch(`${base}/projects/p1/features/real/files/plan/a.md`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    });
    expect(res.status).toBe(200);
    expect(spies.writeFile).toHaveBeenCalledTimes(1);
  });

  it('directory-create on a nonexistent feature is 404', async () => {
    const { base } = await start(false);
    const res = await fetch(`${base}/projects/p1/features/ghost/directory`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'newdir' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET tree on a nonexistent feature is 404 and writes no cache key', async () => {
    const { base, spies } = await start(false);
    const res = await fetch(`${base}/projects/p1/features/ghost/files`);
    expect(res.status).toBe(404);
    expect(spies.getFileTree).not.toHaveBeenCalled();
    expect(spies.setFileTreeCache).not.toHaveBeenCalled();
  });
});
