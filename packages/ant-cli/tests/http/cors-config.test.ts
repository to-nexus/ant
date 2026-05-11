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

const { isLoopbackOrigin, isSelfOrigin } = __testing;

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
 * `isSelfOrigin` — same-host gate that auto-allows requests whose Origin
 * header matches the request's Host header. Closes the iframe / module-script
 * CORS regression where openvscode-server's `<script type="module">` loads
 * always emit an Origin header (CORS spec) even on same-origin requests.
 */
describe('isSelfOrigin', () => {
  // Express's `req.hostname` is trust-proxy aware (reflects X-Forwarded-Host
  // chain). Mock the property the predicate reads directly.
  function mockReq(hostname: string | undefined): any {
    return { hostname };
  }

  it('allows when Origin hostname equals request hostname', () => {
    expect(isSelfOrigin(mockReq('ant-server.crosstoken.io'), 'https://ant-server.crosstoken.io')).toBe(true);
    // Origin with explicit port — hostname comparison ignores port.
    expect(isSelfOrigin(mockReq('ant-server.crosstoken.io'), 'https://ant-server.crosstoken.io:443')).toBe(true);
  });

  it('rejects when Origin hostname differs from request hostname (spoof attempt)', () => {
    expect(isSelfOrigin(mockReq('ant-server.crosstoken.io'), 'https://evil.com')).toBe(false);
    expect(isSelfOrigin(mockReq('other.host'), 'https://ant-server.crosstoken.io')).toBe(false);
  });

  it('rejects subdomain attacks that only LOOK like self', () => {
    expect(isSelfOrigin(mockReq('ant-server.crosstoken.io'), 'https://evil.ant-server.crosstoken.io')).toBe(false);
    expect(isSelfOrigin(mockReq('ant-server.crosstoken.io.attacker.com'), 'https://ant-server.crosstoken.io')).toBe(false);
  });

  it('rejects when request has no resolvable hostname', () => {
    expect(isSelfOrigin(mockReq(undefined), 'https://ant-server.crosstoken.io')).toBe(false);
    expect(isSelfOrigin(mockReq(''), 'https://ant-server.crosstoken.io')).toBe(false);
  });

  it('rejects malformed Origin gracefully', () => {
    expect(isSelfOrigin(mockReq('ant-server.crosstoken.io'), 'not a url')).toBe(false);
    expect(isSelfOrigin(mockReq('ant-server.crosstoken.io'), '')).toBe(false);
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
    // Mirror production: ServerConfigurator sets trust proxy=1 so
    // `req.get('host')` reads X-Forwarded-Host as set by ALB / ingress.
    app.set('trust proxy', 1);
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

  /**
   * Production regression: openvscode-server's iframe emits module scripts
   * whose loads ALWAYS carry an Origin header (CORS spec) even when
   * same-origin. Before self-origin auto-allow, `https://ant-server.crosstoken.io`
   * (the BE host) was rejected unless an operator registered it in
   * ANT_CORS_ORIGINS — registering oneself in one's own allowlist is the
   * kind of asymmetry the self-origin gate eliminates.
   */
  it('allows self-host origin via X-Forwarded-Host (ALB / ingress scenario)', async () => {
    const app = await startApp({
      NODE_ENV: 'production',
      ANT_CORS_ORIGINS: 'https://ant.crosstoken.io', // self-host intentionally NOT here
    });
    try {
      const res = await fetch(`${app.url}/probe`, {
        headers: {
          Origin: 'https://ant-server.crosstoken.io',
          'X-Forwarded-Host': 'ant-server.crosstoken.io',
          'X-Forwarded-Proto': 'https',
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://ant-server.crosstoken.io');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('rejects Origin spoof that does NOT match X-Forwarded-Host', async () => {
    const app = await startApp({
      NODE_ENV: 'production',
      ANT_CORS_ORIGINS: 'https://ant.crosstoken.io',
    });
    try {
      const res = await fetch(`${app.url}/probe`, {
        headers: {
          Origin: 'https://evil.example.com',
          'X-Forwarded-Host': 'ant-server.crosstoken.io',
          'X-Forwarded-Proto': 'https',
        },
      });
      // CORS gate fails -> server still serves, but without
      // Access-Control-Allow-Origin so the browser blocks.
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await app.close();
    }
  });
});
