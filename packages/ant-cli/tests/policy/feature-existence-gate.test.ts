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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as http from 'http';

import { createFilesRoutes } from '../../src/periphery/adapters/http/routes/files.routes';

describe('feature-existence gate on file routes', () => {
  let server: http.Server;

  const start = (exists: boolean, opts: { projectPath?: string } = {}) => {
    const writeFile = vi.fn(async () => ({ path: 'plan/a.md' }));
    const getFileTree = vi.fn(async () => [{ name: 'root', path: '', type: 'directory', children: [] }]);
    const setFileTreeCache = vi.fn(async () => {});

    const projectService = {
      writeFile,
      getFileTree,
      resolveExistingFeatureForMutation: async () => (exists ? '/tmp/feat' : null),
      workspaceResolver: {
        getFeaturePath: () => '/tmp/feat',
        // Only consulted by the universal-plane refusal; a path with no
        // config.json reads as a canonical project.
        getProjectPath: () => opts.projectPath ?? '/tmp/ant-no-such-project',
      },
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

  /**
   * A workspace project's plane root is `{project}/universal`, so the pseudo-
   * feature passes the existence authority. The three routes that then anchor a
   * write by NAME must refuse it — honouring them would write into the phantom
   * `features/universal` tree, which is invisible in the merged view. The
   * `universal/artifacts` mount owns those operations.
   */
  describe('universal plane', () => {
    let universalProject: string;

    const startUniversal = () => {
      universalProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-gate-universal-'));
      fs.writeFileSync(
        path.join(universalProject, 'config.json'),
        JSON.stringify({ projectType: 'universal' }),
      );
      return start(true, { projectPath: universalProject });
    };

    afterEach(() => {
      if (universalProject) fs.rmSync(universalProject, { recursive: true, force: true });
    });

    it('directory-create is refused with 409 universal-plane', async () => {
      const { base } = await startUniversal();
      const res = await fetch(`${base}/projects/p1/features/universal/directory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'briefs' }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('universal-plane');
      expect(fs.existsSync(path.join(universalProject, 'features'))).toBe(false);
    });

    it('upload is refused with 409 universal-plane', async () => {
      const { base } = await startUniversal();
      const form = new FormData();
      form.append('dirPath', '');
      form.append('files', new Blob(['x'], { type: 'text/markdown' }), 'a.md');
      const res = await fetch(`${base}/projects/p1/features/universal/upload`, { method: 'POST', body: form });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('universal-plane');
      expect(fs.existsSync(path.join(universalProject, 'features'))).toBe(false);
    });

    it('rename is refused with 409 universal-plane', async () => {
      const { base } = await startUniversal();
      const res = await fetch(`${base}/projects/p1/features/universal/rename`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ oldPath: 'a.md', newPath: 'b.md' }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('universal-plane');
    });

    it('PUT still writes — the container seam owns the path', async () => {
      const { base, spies } = await startUniversal();
      const res = await fetch(`${base}/projects/p1/features/universal/files/plan/a.md`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      });
      expect(res.status).toBe(200);
      expect(spies.writeFile).toHaveBeenCalledTimes(1);
    });
  });
});
