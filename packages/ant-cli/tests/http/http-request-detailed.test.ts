import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { httpRequestDetailed } from '../../src/infrastructure/ide/readiness';

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/json') {
      res.setHeader('content-type', 'application/json');
      res.setHeader('set-cookie', 'session=secret-token; HttpOnly');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, who: 'app' }));
      return;
    }
    if (req.url === '/redirect') {
      res.statusCode = 302;
      res.setHeader('location', '/login');
      res.end();
      return;
    }
    if (req.url === '/big') {
      res.statusCode = 200;
      res.end('x'.repeat(5000));
      return;
    }
    if (req.url === '/echo' && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        res.statusCode = 201;
        res.end(body);
      });
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('httpRequestDetailed', () => {
  it('returns status, latency, allowlisted headers and body; reduces set-cookie to presence', async () => {
    const r = await httpRequestDetailed(`${base}/json`);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(typeof r.latencyMs).toBe('number');
    expect(r.headers?.['content-type']).toContain('application/json');
    // Cookie value MUST NOT leak — presence only.
    expect(r.headers?.['set-cookie']).toBe('<present>');
    expect(JSON.stringify(r.headers)).not.toContain('secret-token');
    expect(r.bodySnippet).toContain('"who":"app"');
  });

  it('captures the redirect chain when not following', async () => {
    const r = await httpRequestDetailed(`${base}/redirect`);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(302);
    expect(r.redirectChain).toEqual([{ status: 302, location: '/login' }]);
  });

  it('bounds the body snippet and flags truncation', async () => {
    const r = await httpRequestDetailed(`${base}/big`);
    expect(r.bodyTruncated).toBe(true);
    expect((r.bodySnippet ?? '').length).toBe(2000);
  });

  it('sends method + body for POST', async () => {
    const r = await httpRequestDetailed(`${base}/echo`, {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(r.status).toBe(201);
    expect(r.bodySnippet).toBe('{"a":1}');
  });

  it('never throws on a connection failure — returns ok:false with an error', async () => {
    // Port 1 is unreachable; bounded timeout keeps the call from hanging.
    const r = await httpRequestDetailed('http://127.0.0.1:1/', { timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});
