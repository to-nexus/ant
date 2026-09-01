/**
 * Workspace preview lane admission — one axis, one row per case.
 *
 * This is the second non-ambient credential lane in the system (the first is
 * `/ide/*`, locked by tests/http/ide-gate-admission.test.ts). It exists because
 * the file editor's HTML preview used to browse a mini static site through the
 * byte-transport route on the CONTROL PLANE origin: a link to a folder came back
 * as `400 {"error":"Path is a directory, not a file"}` rendered as JSON in the
 * frame, and on a split-host deployment even a valid file was refused by
 * `frame-ancestors 'self'`.
 *
 * The ticket is the ONLY credential here — the content listener has no
 * cookie-parser by design — so the rows below are what stands between a guessed
 * URL and someone's workspace.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'http';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import {
  createWorkspacePreviewLane,
  WORKSPACE_LANE_PREFIX,
} from '../../src/periphery/adapters/http/middleware/workspacePreviewLane';
import {
  mintWorkspacePreviewTicket,
} from '../../src/periphery/adapters/http/middleware/workspacePreviewTicket';
import type { NavTicketStore } from '../../src/periphery/adapters/http/middleware/navTicket';

/** The mint route resolves its store through the infrastructure factory. */
const storeHolder: { current: NavTicketStore | null } = { current: null };
vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
  getInfrastructureFactory: () => ({ getStateStore: () => storeHolder.current }),
}));

const ORG = 'o1';
const USER = 'u1';
const OTHER_USER = 'u2';
const PROJECT = 'p1';
const FEATURE = 'main';

/** In-memory ticket store that counts reads, so "refused before the store" is assertable. */
class FakeStore implements NavTicketStore {
  private readonly values = new Map<string, string>();
  reads = 0;
  async setKeyWithTTL(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async getKey(key: string): Promise<string | null> {
    this.reads += 1;
    return this.values.get(key) ?? null;
  }
}

let base: string;
let workspaces: string;
let store: FakeStore;
let server: Server;
let ticket: string;
let otherTicket: string;

const html = { Accept: 'text/html,application/xhtml+xml' };
const url = (tk: string, rel: string) => `${base}${WORKSPACE_LANE_PREFIX}/${tk}/${rel}`;

beforeAll(async () => {
  workspaces = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-ws-preview-'));
  const featureDir = path.join(workspaces, ORG, USER, PROJECT, 'features', FEATURE);
  fs.mkdirSync(path.join(featureDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(featureDir, 'sessions', 'architect'), { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'index.html'), '<h1>entry</h1>');
  fs.writeFileSync(path.join(featureDir, 'styles.css'), 'body{}');
  fs.writeFileSync(path.join(featureDir, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(featureDir, 'pages', 'index.html'), '<h1>pages</h1>');
  fs.writeFileSync(path.join(featureDir, 'sessions', 'architect', 'code.json'), '{"secret":1}');

  const otherDir = path.join(workspaces, ORG, OTHER_USER, PROJECT, 'features', FEATURE);
  fs.mkdirSync(otherDir, { recursive: true });
  fs.writeFileSync(path.join(otherDir, 'index.html'), '<h1>other tenant</h1>');

  store = new FakeStore();
  storeHolder.current = store;
  ticket = (await mintWorkspacePreviewTicket(store, {
    org: ORG, userId: USER, projectId: PROJECT, feature: FEATURE,
  })).ticket;
  otherTicket = (await mintWorkspacePreviewTicket(store, {
    org: ORG, userId: OTHER_USER, projectId: PROJECT, feature: FEATURE,
  })).ticket;

  const app = express();
  app.use(
    WORKSPACE_LANE_PREFIX,
    createWorkspacePreviewLane({
      workspaceResolver: new UnifiedWorkspaceResolver(workspaces),
      ticketStore: store,
    }),
  );
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as { port: number };
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  fs.rmSync(workspaces, { recursive: true, force: true });
});

describe('workspace preview lane — admission', () => {
  it('a valid ticket serves the feature root', async () => {
    const res = await fetch(url(ticket, 'index.html'), { headers: html });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>entry</h1>');
  });

  it('a link to a directory serves its index — the defect this lane fixes', async () => {
    const res = await fetch(url(ticket, 'pages/'), { headers: html });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>pages</h1>');
  });

  it('a directory without a trailing slash redirects with the ticket intact', async () => {
    const res = await fetch(url(ticket, 'pages'), { headers: html, redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${WORKSPACE_LANE_PREFIX}/${ticket}/pages/`);
  });

  it('a missing path 404s rather than borrowing the root index', async () => {
    const res = await fetch(url(ticket, 'nope.html'), { headers: html });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<h1>entry</h1>');
  });

  it('no ticket is refused', async () => {
    const res = await fetch(`${base}${WORKSPACE_LANE_PREFIX}/`, { headers: html });
    expect(res.status).toBe(401);
  });

  it('a malformed ticket is refused WITHOUT spending a store read', async () => {
    const before = store.reads;
    const res = await fetch(url('not-a-ticket', 'index.html'), { headers: html });
    expect(res.status).toBe(401);
    expect(store.reads).toBe(before);
  });

  it('an unknown (expired) ticket is refused', async () => {
    const res = await fetch(url('a'.repeat(64), 'index.html'), { headers: html });
    expect(res.status).toBe(401);
  });

  it('a refusal is a page, not a payload — it renders inside the iframe', async () => {
    const res = await fetch(url('a'.repeat(64), 'index.html'), { headers: html });
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('reopen the preview');
  });

  it('a state-changing method is refused outright, never passed along', async () => {
    const res = await fetch(url(ticket, 'index.html'), { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('another account\'s ticket reaches only that account\'s tree', async () => {
    const res = await fetch(url(otherTicket, 'index.html'), { headers: html });
    expect(res.status).toBe(200);
    // The root comes from the STORED owner, never from the URL, so this ticket
    // cannot be pointed at the first user's feature.
    expect(await res.text()).toContain('<h1>other tenant</h1>');
  });

  it('the reserved sessions namespace is not browsable', async () => {
    const res = await fetch(url(ticket, 'sessions/architect/code.json'));
    expect(res.status).toBe(404);
  });

  it('a normalized path into sessions is refused too', async () => {
    const res = await fetch(url(ticket, 'pages/../sessions/architect/code.json'));
    expect(res.status).toBe(404);
  });

  it('dotfiles stay refused — a feature root holds a written .env', async () => {
    const res = await fetch(url(ticket, '.env'));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('SECRET');
  });
});

describe('workspace preview lane — embedding headers', () => {
  it('drops the frame-blocking defaults helmet stamps on the content listener', async () => {
    const res = await fetch(url(ticket, 'index.html'), { headers: html });
    expect(res.headers.get('x-frame-options')).toBeNull();
    expect(res.headers.get('content-security-policy')).toContain('frame-ancestors');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('keeps the ticket out of the Referer and the crawlers out of the tree', async () => {
    const res = await fetch(url(ticket, 'index.html'), { headers: html });
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

/**
 * The round trip across the two processes. Minting happens on ant-api, where the
 * cookie, the approval gate and the same-origin guard already are; redemption
 * happens on ant-preview's content listener, which has none of them. Redis is the
 * only channel between them — there is no HTTP hop to test, so what must hold is
 * that the `basePath` one side composes is the URL the other side answers.
 */
describe('workspace preview lane — mint on the API, redeem on the content origin', () => {
  let apiServer: Server;
  let apiBase: string;

  beforeAll(async () => {
    const { createFilesRoutes } = await import(
      '../../src/periphery/adapters/http/routes/files.routes'
    );
    const resolver = new UnifiedWorkspaceResolver(workspaces);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: USER };
      (req as any).organization = { id: ORG, kind: 'team' };
      next();
    });
    app.use(createFilesRoutes({ projectService: { workspaceResolver: resolver } as any }));
    apiServer = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = apiServer.address() as { port: number };
    apiBase = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>(r => apiServer.close(() => r()));
  });

  const mint = (filePath: string) =>
    fetch(`${apiBase}/projects/${PROJECT}/features/${FEATURE}/files-preview-ticket`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });

  it('the minted basePath is exactly what the lane serves', async () => {
    const res = await mint('pages/index.html');
    expect(res.status).toBe(200);
    const { basePath } = await res.json();
    expect(basePath).toMatch(new RegExp(`^${WORKSPACE_LANE_PREFIX}/[0-9a-f]{64}/pages/$`));

    const served = await fetch(`${base}${basePath}`, { headers: html });
    expect(served.status).toBe(200);
    expect(await served.text()).toContain('<h1>pages</h1>');
  });

  it('a file at the feature root yields a base with no directory segment', async () => {
    const { basePath } = await (await mint('index.html')).json();
    expect(basePath).toMatch(new RegExp(`^${WORKSPACE_LANE_PREFIX}/[0-9a-f]{64}/$`));
    const served = await fetch(`${base}${basePath}`, { headers: html });
    expect(served.status).toBe(200);
    expect(await served.text()).toContain('<h1>entry</h1>');
  });

  it('refuses to mint for a path that is a directory', async () => {
    expect((await mint('pages')).status).toBe(404);
  });

  it('refuses to mint for a path that does not exist', async () => {
    expect((await mint('nope.html')).status).toBe(404);
  });

  it('refuses to mint for a path escaping the feature root', async () => {
    expect((await mint('../../../etc/passwd')).status).toBe(404);
  });

  it('requires a path', async () => {
    const res = await fetch(`${apiBase}/projects/${PROJECT}/features/${FEATURE}/files-preview-ticket`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
