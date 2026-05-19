/**
 * IDE stub interceptors — short-circuits cosmetic-noise paths before they
 * hit the proxy middleware. Two interceptors:
 *
 *   1. /ide/{key}/.../favicon.ico            → 204 No Content
 *   2. /ide/{key}/.../vsda/rust/web/vsda.js  → 200 application/javascript
 *      /ide/{key}/.../vsda/rust/web/vsda_bg.wasm → 200 application/wasm
 *
 * Anything else under /ide/ must fall through to the next middleware. We bind
 * a real Express app to port 0 and use fetch — same pattern as auth-me-route /
 * chatRoutes tests (no supertest).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express, { Request, Response } from 'express';
import { createIdeFaviconStub, createIdeVsdaStub } from '../../src/periphery/adapters/http/middleware/ideStubInterceptors';

async function startApp(): Promise<{ url: string; close: () => Promise<void>; sentinelHits: { count: number } }> {
  const app = express();
  const sentinelHits = { count: 0 };
  app.use(createIdeFaviconStub());
  app.use(createIdeVsdaStub());
  // Sentinel — if interceptors pass `next()`, this handler responds 599 so
  // the test can detect fall-through.
  app.use('/ide/', (_req: Request, res: Response) => {
    sentinelHits.count += 1;
    res.status(599).send('FELL_THROUGH');
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
        sentinelHits,
      });
    });
  });
}

describe('IDE stub interceptors', () => {
  let app: Awaited<ReturnType<typeof startApp>>;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /ide/{key}/favicon.ico → 204 (no fall-through to proxy)', async () => {
    const before = app.sentinelHits.count;
    const res = await fetch(`${app.url}/ide/org:user:proj:base/favicon.ico`);
    expect(res.status).toBe(204);
    expect(app.sentinelHits.count).toBe(before);
  });

  it('GET /ide/{key}/.../vsda/rust/web/vsda.js → 200 application/javascript with empty module body', async () => {
    const before = app.sentinelHits.count;
    const res = await fetch(`${app.url}/ide/org:user:proj:base/stable-abcdef/static/node_modules/vsda/rust/web/vsda.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/javascript/);
    const body = await res.text();
    expect(body).toBe('export {};\n');
    expect(app.sentinelHits.count).toBe(before);
  });

  it('GET /ide/{key}/.../vsda/rust/web/vsda_bg.wasm → 200 application/wasm with valid WASM magic+version', async () => {
    const before = app.sentinelHits.count;
    const res = await fetch(`${app.url}/ide/org:user:proj:base/stable-abcdef/static/node_modules/vsda/rust/web/vsda_bg.wasm`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/wasm/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(8);
    expect(Array.from(bytes)).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    expect(app.sentinelHits.count).toBe(before);
  });

  it('GET /ide/{key}/some/other/asset.js → falls through to next middleware', async () => {
    const before = app.sentinelHits.count;
    const res = await fetch(`${app.url}/ide/org:user:proj:base/stable-abcdef/static/out/nls.messages.js`);
    expect(res.status).toBe(599);
    expect(app.sentinelHits.count).toBe(before + 1);
  });

  it('GET /api/anything (not /ide/) → falls through (interceptors must NOT match outside /ide/)', async () => {
    // Mount a different sentinel at /api/ to assert pass-through there
    // (avoids polluting the /ide/ sentinel counter).
    const res = await fetch(`${app.url}/api/favicon.ico`);
    // Express returns 404 since no /api handler is registered — proves
    // the favicon interceptor didn't intercept paths outside /ide/.
    expect(res.status).toBe(404);
  });
});
