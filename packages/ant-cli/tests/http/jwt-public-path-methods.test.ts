/**
 * `createJwtAuthMiddleware` public-path exemptions are method-aware (M-010).
 *
 * A public path was previously exempt for ANY method, so `POST /health` skipped
 * the JWT gate and reached the body parser mounted behind it. The exemption now
 * names the method its route serves; a mismatched method must authenticate
 * (401 without a cookie) before the parser ever runs.
 *
 * Same pattern as pending-jwt-guard.test.ts — real Express app on port 0.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';

import { createJwtAuthMiddleware, createPublicRequestMatcher } from '../../src/periphery/adapters/http/middleware/jwtAuth';
import type { JwtService } from '../../src/infrastructure/auth/JwtService';

// A stub verifier: any token throws (we only exercise the public-path leg and
// the 401-before-parser leg, never a valid session).
const jwtService = { verify: () => { throw new Error('no token'); } } as unknown as JwtService;

let server: http.Server;
let baseUrl: string;
let parserHits = 0;

beforeAll(async () => {
  const app = express();
  app.use(
    createJwtAuthMiddleware({
      jwtService,
      publicPaths: [
        { path: '/health', methods: ['GET'] },
        { path: '/internal/tls-ask', methods: ['GET'] },
        '/legacy-any', // legacy string form: exempt for any method
      ],
    }),
  );
  // Body parser mounted BEHIND the gate — it must never run for a request the
  // gate should have rejected. A counter proves the ordering.
  app.use((req, _res, next) => { parserHits++; next(); });
  app.all('/health', (_req, res) => res.json({ ok: true }));
  app.all('/internal/tls-ask', (_req, res) => res.json({ ok: true }));
  app.all('/legacy-any', (_req, res) => res.json({ ok: true }));

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('jwtAuth public-path method awareness (M-010)', () => {
  it('GET /health is exempt (passes to handler)', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it('POST /health is NOT exempt — 401 before the parser runs', async () => {
    const before = parserHits;
    const res = await fetch(`${baseUrl}/health`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(parserHits).toBe(before); // parser never reached
  });

  it('POST /internal/tls-ask is NOT exempt — 401 before the parser', async () => {
    const before = parserHits;
    const res = await fetch(`${baseUrl}/internal/tls-ask`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(parserHits).toBe(before);
  });

  it('legacy string exemption stays any-method', async () => {
    expect((await fetch(`${baseUrl}/legacy-any`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/legacy-any`, { method: 'POST' })).status).toBe(200);
  });
});

// The gate and the pre-auth public body parser share this ONE predicate — a
// drift between the two mounts would re-open M-010 from either side.
describe('createPublicRequestMatcher', () => {
  const isPublic = createPublicRequestMatcher(
    [{ path: '/health', methods: ['GET'] }, '/legacy-any'],
    ['/assets/'],
  );

  it('is method-aware for object specs, any-method for legacy strings, prefix-matched for prefixes', () => {
    expect(isPublic({ path: '/health', method: 'GET' })).toBe(true);
    expect(isPublic({ path: '/health', method: 'POST' })).toBe(false);
    expect(isPublic({ path: '/legacy-any', method: 'POST' })).toBe(true);
    expect(isPublic({ path: '/assets/logo.png', method: 'GET' })).toBe(true);
    expect(isPublic({ path: '/api/definitions/agents/a1/file', method: 'PUT' })).toBe(false);
  });
});
