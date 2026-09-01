/**
 * `/ide/*` gate admission — one axis, one row per case (H-013).
 *
 * The gate has three admission lanes and one ownership check, in this order:
 * session cookie → JWT → (bearer | trusted cookie origin | nav ticket) → owner.
 * The cookie-origin predicate itself is covered by `same-origin-guard.test.ts`;
 * this table covers what the gate does with it, and in particular that the
 * nav-ticket lane admits ONLY the iframe's document navigation.
 *
 * The real `ServerConfigurator.setupIdeProxyAuth` is mounted — a replica of the
 * wiring would drift from the wiring it claims to guard.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';

import { createIDEKey } from '../../src/infrastructure/state/redisKeyUtils';

const store = new Map<string, string>();
const fakeStore = {
  setKeyWithTTL: async (k: string, v: string) => { store.set(k, v); },
  getKey: async (k: string) => store.get(k) ?? null,
};

vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
  getInfrastructureFactory: () => ({ getStateStore: () => fakeStore }),
}));

const { mintIdeNavTicket } = await import('../../src/periphery/adapters/http/middleware/ideNavTicket');
const { mintWorkspacePreviewTicket } = await import(
  '../../src/periphery/adapters/http/middleware/workspacePreviewTicket'
);
const { ServerConfigurator } = await import(
  '../../src/periphery/adapters/http/express/config/ServerConfigurator'
);

const OWNER = { org: 'acme', userId: 'u1', projectId: 'shop', feature: 'main' };
const OTHER = { org: 'acme', userId: 'u2', projectId: 'shop', feature: 'main' };
const KEY = createIDEKey(OWNER.org, OWNER.userId, OWNER.projectId, OWNER.feature);
const OTHER_KEY = createIDEKey(OTHER.org, OTHER.userId, OTHER.projectId, OTHER.feature);

const SESSION = 'ant_session=fake-token';
const FE = 'https://app.example.com';

const ticketFor = async (owner = OWNER) => (await mintIdeNavTicket(fakeStore, owner)).ticket;

describe('/ide/* gate admission', () => {
  let server: http.Server;
  let baseUrl: string;
  let savedFrontend: string | undefined;

  beforeEach(async () => {
    savedFrontend = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = FE;
    store.clear();

    const app = express();
    const configurator = new (ServerConfigurator as any)(
      {} as any,
      { authService: {}, jwtService: { verify: () => ({ sub: OWNER.userId, org: OWNER.org, email: 'u1@example.com' }) } },
    );
    app.use(cookieParser());
    configurator.setupIdeProxyAuth(app);
    // Stands in for the proxy: admission is observable as 200, and the echoed
    // url proves the ticket never reaches the upstream.
    app.use('/ide/', (req, res) => { res.status(200).json({ url: req.url }); });

    await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (savedFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = savedFrontend;
  });

  const call = (opts: {
    path: string;
    method?: string;
    site?: string;
    origin?: string;
    cookie?: string;
    navigation?: boolean;
  }) => {
    const headers: Record<string, string> = {};
    if (opts.site) headers['Sec-Fetch-Site'] = opts.site;
    if (opts.origin) headers['Origin'] = opts.origin;
    if (opts.cookie !== undefined) headers['Cookie'] = opts.cookie;
    if (opts.navigation) {
      headers['Sec-Fetch-Mode'] = 'navigate';
      headers['Sec-Fetch-Dest'] = 'iframe';
    }
    return fetch(`${baseUrl}${opts.path}`, { method: opts.method ?? 'GET', headers });
  };

  it('401s without a session cookie — before any origin or ticket work', async () => {
    expect((await call({ path: `/ide/${KEY}/` })).status).toBe(401);
  });

  it('admits same-origin with no ticket', async () => {
    const res = await call({ path: `/ide/${KEY}/`, cookie: SESSION, site: 'same-origin' });
    expect(res.status).toBe(200);
  });

  it('admits same-site carrying the registered frontend Origin (split-host fetch)', async () => {
    const res = await call({ path: `/ide/${KEY}/`, cookie: SESSION, site: 'same-site', origin: FE });
    expect(res.status).toBe(200);
  });

  it('REFUSES same-site navigation with no Origin and no ticket — the H-013 source', async () => {
    const res = await call({ path: `/ide/${KEY}/`, cookie: SESSION, site: 'same-site', navigation: true });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Cross-origin request refused');
  });

  it('admits the iframe navigation with a valid ticket', async () => {
    const res = await call({
      path: `/ide/${KEY}/?folder=%2Fworkspace&ant_nav=${await ticketFor()}`,
      cookie: SESSION, site: 'same-site', navigation: true,
    });
    expect(res.status).toBe(200);
  });

  it('strips the ticket before the proxy sees it', async () => {
    const res = await call({
      path: `/ide/${KEY}/?folder=%2Fworkspace&ant_nav=${await ticketFor()}`,
      cookie: SESSION, site: 'same-site', navigation: true,
    });
    const { url } = await res.json();
    expect(url).not.toContain('ant_nav');
    expect(url).toContain('folder=%2Fworkspace');
  });

  it('strips the ticket even when the origin lane admitted first', async () => {
    // A same-origin deployment mints tickets it never needs. They must still not
    // reach openvscode or the proxy's request log.
    const res = await call({
      path: `/ide/${KEY}/?ant_nav=${await ticketFor()}`,
      cookie: SESSION, site: 'same-origin',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).url).not.toContain('ant_nav');
  });

  it('REFUSES a ticket on a state-changing method — the lane is navigation-only', async () => {
    const res = await call({
      path: `/ide/${KEY}/?ant_nav=${await ticketFor()}`,
      method: 'POST', cookie: SESSION, site: 'same-site',
    });
    expect(res.status).toBe(403);
  });

  it('REFUSES a ticket minted for a different serverKey', async () => {
    const ticket = await ticketFor({ ...OWNER, projectId: 'other-project' });
    const res = await call({ path: `/ide/${KEY}/?ant_nav=${ticket}`, cookie: SESSION, site: 'same-site' });
    expect(res.status).toBe(403);
  });

  it("REFUSES a valid ticket presented with another account's session", async () => {
    const ticket = await ticketFor(OTHER);
    const res = await call({ path: `/ide/${OTHER_KEY}/?ant_nav=${ticket}`, cookie: SESSION, site: 'same-site' });
    expect(res.status).toBe(403);
  });

  it.each([
    ['unknown', 'a'.repeat(64)],
    ['malformed', 'not-a-ticket'],
  ])('REFUSES an %s ticket', async (_label, ticket) => {
    const res = await call({ path: `/ide/${KEY}/?ant_nav=${ticket}`, cookie: SESSION, site: 'same-site' });
    expect(res.status).toBe(403);
  });

  it('REFUSES a workspace-preview ticket — the two lanes share a primitive, not a scope', async () => {
    // Both lanes mint through `navTicket.ts` into the same Redis. The scope
    // prefix is what stops a content-origin browsing ticket being spent here.
    const { ticket } = await mintWorkspacePreviewTicket(fakeStore, {
      org: OWNER.org, userId: OWNER.userId, projectId: OWNER.projectId, feature: OWNER.feature,
    });
    const res = await call({ path: `/ide/${KEY}/?ant_nav=${ticket}`, cookie: SESSION, site: 'same-site' });
    expect(res.status).toBe(403);
  });

  it('keeps the ownership gate behind the ticket lane (H-001)', async () => {
    // A ticket is bound to its owner, so reaching another account's key means
    // the ticket lane was skipped — the owner gate must still refuse.
    const res = await call({ path: `/ide/${OTHER_KEY}/`, cookie: SESSION, site: 'same-origin' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Forbidden: IDE belongs to another account');
  });
});
