/**
 * The universal (workspace) artifact mutation routes must refresh the file tree
 * for EVERY client of the workspace, not just the tab that made the call.
 *
 * These six endpoints had no `fileTreeNotifier` at all — `createCustomAgentRoutes`
 * did not even accept one — so a directory or file created here was invisible to
 * any other tab until a browser refresh. The codespace peer
 * (`files.routes.ts`) has always notified; this pins the universal parity.
 *
 * The notify is mounted ONCE on the artifacts sub-router rather than copied per
 * route (`files.routes.ts` hand-copies it five times), so the structural row at
 * the bottom is the real guard: a seventh route cannot skip it.
 *
 * No supertest: a real Express app + node:http on port 0, called via fetch
 * (mirrors tests/http/universal-feature-download.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import http from 'node:http';
import express from 'express';
import { UNIVERSAL_FEATURE } from '@ant/shared';

import { createCustomAgentRoutes } from '../../src/periphery/adapters/http/routes/customAgents.routes';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { ensureUniversalContainer } from '../../src/core/customAgents/universalContainer';

const PROJECT_ID = 'ws1';
const ORG = 'o1';
const USER = 'u1';

/** `res.on('finish')` fires after the response, so the spy lands a tick later. */
const settle = () => new Promise((r) => setImmediate(r));

describe('universal artifact mutations — file tree notify', () => {
  let tmpWorkspaces: string;
  let projectPath: string;
  let artifactsRoot: string;
  let server: http.Server;
  let baseUrl: string;
  // Typed with the port's arity — `typecheck:tests` is CI-blocking and a bare
  // vi.fn() does not satisfy the notifier signature.
  let notify: Mock<(projectId: string, featureName: string, userContext?: any) => Promise<void>>;

  beforeEach(async () => {
    tmpWorkspaces = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-universal-mut-'));
    projectPath = path.join(tmpWorkspaces, ORG, USER, PROJECT_ID);
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ projectType: 'universal' }),
      'utf-8',
    );
    ensureUniversalContainer(projectPath);
    artifactsRoot = path.join(projectPath, 'universal', 'artifacts');

    notify = vi.fn(async (_projectId: string, _featureName: string, _userContext?: any) => {});
    const resolver = new UnifiedWorkspaceResolver(tmpWorkspaces);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: USER };
      (req as any).organization = { id: ORG, kind: 'team' };
      next();
    });
    app.use(
      createCustomAgentRoutes({
        workspaceResolver: resolver,
        organizationRepository: {} as any,
        fileTreeNotifier: { notifyFileTreeUpdate: notify },
      }),
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpWorkspaces, { recursive: true, force: true });
  });

  const url = (tail: string) => `${baseUrl}/projects/${PROJECT_ID}/universal/artifacts${tail}`;
  const post = (tail: string, body: unknown) =>
    fetch(url(tail), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  // route × case → expected status × expected notify count
  it('GET /tree never notifies', async () => {
    const res = await fetch(url('/tree'));
    await settle();
    expect(res.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(0);
  });

  it('POST /mkdir notifies on success and addresses the universal pseudo-feature', async () => {
    const res = await post('/mkdir', { path: 'deliverables' });
    await settle();
    expect(res.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    // `mergeParams` on the sub-router is what keeps projectId reachable here —
    // without it this is `undefined` and the notify silently targets nothing.
    expect(notify).toHaveBeenCalledWith(PROJECT_ID, UNIVERSAL_FEATURE, expect.anything());
  });

  it('POST /mkdir does NOT notify when rejected (reserved name)', async () => {
    const res = await post('/mkdir', { path: 'sessions' });
    await settle();
    expect(res.status).toBe(400);
    expect(notify).toHaveBeenCalledTimes(0);
  });

  it('POST /create-file notifies on success, not on a duplicate', async () => {
    const ok = await post('/create-file', { path: 'notes.md' });
    await settle();
    expect(ok.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);

    const dupe = await post('/create-file', { path: 'notes.md' });
    await settle();
    expect(dupe.status).toBeGreaterThanOrEqual(400);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('POST /rename notifies on success, not for a canonical root', async () => {
    await fs.writeFile(path.join(artifactsRoot, 'a.md'), 'x', 'utf-8');
    const ok = await post('/rename', { path: 'a.md', newName: 'b.md' });
    await settle();
    expect(ok.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);

    const bad = await post('/rename', { path: 'plan', newName: 'plans' });
    await settle();
    expect(bad.status).toBe(400);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('DELETE /file notifies for a leaf, not for a missing path', async () => {
    await fs.writeFile(path.join(artifactsRoot, 'gone.md'), 'x', 'utf-8');
    const ok = await fetch(url('/file?path=gone.md'), { method: 'DELETE' });
    await settle();
    expect(ok.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);

    const missing = await fetch(url('/file?path=nope.md'), { method: 'DELETE' });
    await settle();
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('survives a missing notifier (the dep is optional)', async () => {
    // Local dev / tests may mount the routes without a bridge; a mutation must
    // still succeed rather than throwing inside the finish hook.
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: USER };
      (req as any).organization = { id: ORG, kind: 'team' };
      next();
    });
    app.use(
      createCustomAgentRoutes({
        workspaceResolver: new UnifiedWorkspaceResolver(tmpWorkspaces),
        organizationRepository: {} as any,
      }),
    );
    const bare = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const addr = bare.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      const res = await fetch(
        `http://127.0.0.1:${p}/projects/${PROJECT_ID}/universal/artifacts/mkdir`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: 'no-notifier' }),
        },
      );
      await settle();
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => bare.close(() => resolve()));
    }
  });

  it('EVERY non-GET route on the artifacts mount notifies (no hand-listing)', async () => {
    // Enumerated from the router stack rather than a hardcoded path list, so a
    // seventh mutation route added without the hook fails the build.
    const routes = collectArtifactRoutes(
      createCustomAgentRoutes({
        workspaceResolver: new UnifiedWorkspaceResolver(tmpWorkspaces),
        organizationRepository: {} as any,
      }),
    );
    expect(routes.length).toBeGreaterThan(0);
    const nonGet = routes.filter((r) => r.methods.some((m) => m !== 'get'));
    // All mutation routes live behind the ONE sub-router that carries the hook.
    expect(nonGet.length).toBeGreaterThanOrEqual(5);
    expect(routes.every((r) => r.behindHook)).toBe(true);
  });
});

/**
 * Report the artifacts sub-router's routes, plus whether that sub-router carries
 * a non-route middleware layer (the notify hook) alongside them.
 *
 * The sub-router is identified by the routes it owns (`/tree` + `/mkdir` are
 * unique to the artifacts mount), not by its mount path: Express 5 layers expose
 * `matchers`, not a readable `regexp`, so the path string is not recoverable.
 */
function collectArtifactRoutes(
  router: any,
): Array<{ path: string; methods: string[]; behindHook: boolean }> {
  for (const layer of router.stack ?? []) {
    const sub = layer.handle;
    if (!sub?.stack) continue;

    const routes = sub.stack.filter((l: any) => l.route);
    const paths = routes.map((l: any) => l.route.path);
    if (!paths.includes('/tree') || !paths.includes('/mkdir')) continue;

    // A middleware layer inside the sub-router = the mount-level notify hook.
    const behindHook = sub.stack.some((l: any) => !l.route);
    return routes.map((l: any) => ({
      path: l.route.path,
      methods: Object.keys(l.route.methods ?? {}),
      behindHook,
    }));
  }
  return [];
}

// ── upload readability gate ──────────────────────────────────────────────────
//
// The store admits only what the agent plane can read: the upload route runs
// the SAME classifier as read_file (extension fast-path + head sniff over
// NUL/utf-8 validity). A folder upload sheds only its unreadable members and
// names each one — never a silent skip, never dead weight in the store.

describe('universal artifact upload — readability gate', () => {
  let tmpWorkspaces: string;
  let projectPath: string;
  let artifactsRoot: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tmpWorkspaces = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-universal-upload-'));
    projectPath = path.join(tmpWorkspaces, ORG, USER, PROJECT_ID);
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'config.json'),
      JSON.stringify({ projectType: 'universal' }),
      'utf-8',
    );
    ensureUniversalContainer(projectPath);
    artifactsRoot = path.join(projectPath, 'universal', 'artifacts');

    const resolver = new UnifiedWorkspaceResolver(tmpWorkspaces);
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { id: USER };
      (req as any).organization = { id: ORG, kind: 'team' };
      next();
    });
    app.use(createCustomAgentRoutes({ workspaceResolver: resolver, organizationRepository: {} as any }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpWorkspaces, { recursive: true, force: true });
  });

  const uploadFiles = async (entries: Array<{ name: string; bytes: Buffer | string }>) => {
    const form = new FormData();
    form.append('dirPath', 'inbox');
    for (const e of entries) {
      const bytes = typeof e.bytes === 'string' ? Buffer.from(e.bytes, 'utf-8') : e.bytes;
      form.append('files', new Blob([new Uint8Array(bytes)]), e.name);
      form.append('relativePaths', e.name);
    }
    return fetch(`${baseUrl}/projects/${PROJECT_ID}/universal/artifacts/upload`, {
      method: 'POST',
      body: form,
    });
  };

  it('utf-8 CSV is admitted and lands on disk', async () => {
    const res = await uploadFiles([{ name: 'ledger.csv', bytes: 'id,amount\n1,1000\n2,2000\n' }]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadedFiles).toEqual(['inbox/ledger.csv']);
    expect(body.rejected).toBeUndefined();
    await expect(fs.readFile(path.join(artifactsRoot, 'inbox/ledger.csv'), 'utf-8')).resolves.toContain('amount');
  });

  it('a known-binary extension is refused whole (415) and never written', async () => {
    const res = await uploadFiles([{ name: 'report.xlsx', bytes: 'looks like text but the extension is authoritative' }]);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.code).toBe('UNREADABLE_FILES');
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].path).toBe('inbox/report.xlsx');
    expect(body.rejected[0].reason).toContain('text format');
    await expect(fs.access(path.join(artifactsRoot, 'inbox/report.xlsx'))).rejects.toThrow();
  });

  it('NUL bytes under an unknown extension are sniffed binary', async () => {
    const res = await uploadFiles([{ name: 'dump.customfmt', bytes: Buffer.from([0x41, 0x00, 0x42]) }]);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.rejected[0].reason).toContain('binary');
  });

  it('legacy-encoded (non-utf-8) text names the encoding fix, not "binary"', async () => {
    // 0xB0 0xA1 is "가" in EUC-KR/CP949 — the classic Korean-Excel CSV export.
    const res = await uploadFiles([{ name: 'legacy.csv', bytes: Buffer.from([0xb0, 0xa1, 0x2c, 0x31, 0x0a]) }]);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.rejected[0].reason).toContain('UTF-8');
    expect(body.rejected[0].reason).not.toContain('binary');
  });

  it('a folder upload sheds only unreadable members — partial 200 with a named rejection', async () => {
    const res = await uploadFiles([
      { name: 'good.csv', bytes: 'a,b\n1,2\n' },
      { name: 'sheet.xlsx', bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]) },
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadedFiles).toEqual(['inbox/good.csv']);
    expect(body.rejected).toEqual([{ path: 'inbox/sheet.xlsx', reason: expect.stringContaining('text format') }]);
    await expect(fs.access(path.join(artifactsRoot, 'inbox/good.csv'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(artifactsRoot, 'inbox/sheet.xlsx'))).rejects.toThrow();
  });

  // ── vision channel: images are consumable, so they are admitted ────────────

  const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

  it('a PNG (magic bytes) is admitted — the vision channel consumes it', async () => {
    const res = await uploadFiles([{ name: 'screen.png', bytes: PNG_HEAD }]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadedFiles).toEqual(['inbox/screen.png']);
    expect(body.rejected).toBeUndefined();
  });

  it('bytes decide, not the extension: PNG bytes under a .csv name are admitted', async () => {
    const res = await uploadFiles([{ name: 'mislabeled.csv', bytes: PNG_HEAD }]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadedFiles).toEqual(['inbox/mislabeled.csv']);
  });

  it('text bytes under a .png name are refused — no channel consumes them (read_file stubs .png, vision sees no image)', async () => {
    const res = await uploadFiles([{ name: 'fake.png', bytes: 'just,text\n' }]);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.rejected[0].reason).toContain('Images are accepted');
  });
});
