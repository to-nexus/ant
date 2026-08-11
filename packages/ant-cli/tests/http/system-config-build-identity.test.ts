/**
 * `GET /system/config` reports the running build's identity as `buildSha`.
 *
 * Why this is a contract and not a nicety: the cloud FE ships to S3 on merge
 * while the BE image only reaches ECR, so the two halves can diverge. When they
 * do, a route the FE calls is simply absent from the running server and answers
 * 404 — with no way to tell which BE build a pod is on. `buildSha` makes that
 * skew observable in one unauthenticated request (the endpoint is in the JWT
 * `publicPaths` allowlist).
 *
 * Read at REQUEST time, not module load, so a test can set it without
 * re-importing — and so a pod picks it up from its own env.
 *
 * No supertest: real Express app + node:http on port 0 (mirrors
 * tests/http/files-routes-feature-slug.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import express from 'express';

import { createHealthRoutes } from '../../src/periphery/adapters/http/routes/health.routes';

describe('GET /system/config — build identity', () => {
  let server: http.Server;
  let base: string;
  const saved = process.env.ANT_BUILD_SHA;

  const restore = () => {
    if (saved === undefined) delete process.env.ANT_BUILD_SHA;
    else process.env.ANT_BUILD_SHA = saved;
  };

  beforeAll(async () => {
    const app = express();
    app.use('/api', createHealthRoutes());
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(restore);

  const getConfig = async () => {
    const res = await fetch(`${base}/api/system/config`);
    expect(res.status).toBe(200);
    return res.json() as Promise<Record<string, unknown>>;
  };

  it('reports ANT_BUILD_SHA when the image was built with it', async () => {
    process.env.ANT_BUILD_SHA = 'a93f40ab02288e42c93aa61099ed49f6d85168ba';
    expect(await getConfig()).toMatchObject({
      buildSha: 'a93f40ab02288e42c93aa61099ed49f6d85168ba',
    });
  });

  it('reports null — never undefined or "" — when unset', async () => {
    delete process.env.ANT_BUILD_SHA;
    const cfg = await getConfig();
    // `buildSha` must be PRESENT and null: a missing key is indistinguishable
    // from an old server that predates the field, which is the exact ambiguity
    // this endpoint exists to remove.
    expect(Object.keys(cfg)).toContain('buildSha');
    expect(cfg.buildSha).toBeNull();
  });

  it('coerces an empty build arg to null (unset arg reaches the image as "")', async () => {
    process.env.ANT_BUILD_SHA = '';
    expect((await getConfig()).buildSha).toBeNull();
  });

  it('is read per request, so it cannot be baked in at module load', async () => {
    process.env.ANT_BUILD_SHA = 'first';
    expect((await getConfig()).buildSha).toBe('first');
    process.env.ANT_BUILD_SHA = 'second';
    expect((await getConfig()).buildSha).toBe('second');
  });

  it('keeps the pre-existing payload keys intact', async () => {
    const cfg = await getConfig();
    expect(Object.keys(cfg)).toEqual(
      expect.arrayContaining(['recursionLimit', 'authMode', 'ideRuntime', 'capabilities']),
    );
  });
});
