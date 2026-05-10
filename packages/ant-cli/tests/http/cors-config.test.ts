/**
 * `createCorsMiddleware` — unified CORS gate for ant-api / ant-realtime /
 * ant-preview. Loopback origins (`http://localhost:*` /
 * `http://127.0.0.1:*`) are allowed in any mode so `pnpm dev:ui` against
 * production API works without per-developer `ANT_CORS_ORIGINS` overrides.
 * Loopback Origin headers cannot be forged remotely (the browser only
 * emits them when the request actually originates from the user's own
 * machine), so this is safe in production too.
 */

import { describe, it, expect } from 'vitest';
import { __testing } from '../../src/periphery/adapters/http/middleware/corsConfig';

const { isLoopbackOrigin } = __testing;

describe('isLoopbackOrigin', () => {
  it('matches http://localhost with any port', () => {
    expect(isLoopbackOrigin('http://localhost')).toBe(true);
    expect(isLoopbackOrigin('http://localhost:4200')).toBe(true);
    expect(isLoopbackOrigin('http://localhost:5173')).toBe(true);
  });

  it('matches http://127.0.0.1 with any port', () => {
    expect(isLoopbackOrigin('http://127.0.0.1')).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:4200')).toBe(true);
  });

  it('rejects spoofed hosts that contain "localhost" as a substring', () => {
    expect(isLoopbackOrigin('https://localhost.attacker.com')).toBe(false);
    expect(isLoopbackOrigin('http://evil.com/?host=localhost')).toBe(false);
    expect(isLoopbackOrigin('http://localhost.example.com')).toBe(false);
  });

  it('rejects https:// loopback (browsers don\'t emit https for localhost dev)', () => {
    // Tightened predicate: only http:// loopback. https loopback would
    // require a self-signed cert and isn't part of any documented dev flow.
    expect(isLoopbackOrigin('https://localhost:4200')).toBe(false);
    expect(isLoopbackOrigin('https://127.0.0.1:4200')).toBe(false);
  });

  it('rejects non-loopback origins', () => {
    expect(isLoopbackOrigin('https://ant.crosstoken.io')).toBe(false);
    expect(isLoopbackOrigin('https://ant-server.crosstoken.io')).toBe(false);
    expect(isLoopbackOrigin('https://example.com')).toBe(false);
  });
});

/**
 * End-to-end: spin a tiny Express app with the real middleware and assert
 * the CORS preflight / actual-request behavior.
 */
describe('createCorsMiddleware integration', () => {
  async function startApp(envOverrides: Record<string, string | undefined>) {
    const http = await import('node:http');
    const express = (await import('express')).default;
    const { createCorsMiddleware } = await import(
      '../../src/periphery/adapters/http/middleware/corsConfig'
    );
    const original: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(envOverrides)) {
      original[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const app = express();
    app.use(createCorsMiddleware());
    app.get('/probe', (_req, res) => res.json({ ok: true }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('bind failed');
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: async () => {
        await new Promise((resolve) => server.close(() => resolve(undefined)));
        for (const [k, v] of Object.entries(original)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      },
    };
  }

  it('allows http://localhost:4200 in production mode (the bug we fixed)', async () => {
    const app = await startApp({
      NODE_ENV: 'production',
      ANT_CORS_ORIGINS: 'https://ant.crosstoken.io',
    });
    try {
      const res = await fetch(`${app.url}/probe`, {
        headers: { Origin: 'http://localhost:4200' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4200');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('allows configured origins from ANT_CORS_ORIGINS', async () => {
    const app = await startApp({
      NODE_ENV: 'production',
      ANT_CORS_ORIGINS: 'https://ant.crosstoken.io',
    });
    try {
      const res = await fetch(`${app.url}/probe`, {
        headers: { Origin: 'https://ant.crosstoken.io' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://ant.crosstoken.io');
    } finally {
      await app.close();
    }
  });

  it('rejects unconfigured non-loopback origins in production', async () => {
    const app = await startApp({
      NODE_ENV: 'production',
      ANT_CORS_ORIGINS: 'https://ant.crosstoken.io',
    });
    try {
      const res = await fetch(`${app.url}/probe`, {
        headers: { Origin: 'https://attacker.example.com' },
      });
      // The request still completes (CORS is enforced by the browser, not
      // the server) but the response carries no Access-Control-Allow-Origin
      // header, so a browser would block it.
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('still allows missing Origin (same-origin / health checks) in production', async () => {
    const app = await startApp({
      NODE_ENV: 'production',
      ANT_CORS_ORIGINS: 'https://ant.crosstoken.io',
    });
    try {
      const res = await fetch(`${app.url}/probe`);
      expect(res.status).toBe(200);
    } finally {
      await app.close();
    }
  });
});
