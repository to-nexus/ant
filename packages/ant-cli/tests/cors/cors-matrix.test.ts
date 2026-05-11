/**
 * CORS persona matrix — locks the 9-cell support / reject grid from the
 * Local/Cloud Launch Mode plan (Shared Context § "FE × BE Cross-Product
 * Matrix"). Three primary supported personas (A / B / C same-origin)
 * resolve to env=0 via loopback + isSelfOrigin auto-allow; the two
 * advanced cells (C split-host, Local FE → Custom Cloud BE) require
 * explicit env; the remaining cells must reject.
 *
 * Also covers `logCorsConfigSummary()` — cloud mode with both
 * `FRONTEND_URL` and `ANT_CORS_ORIGINS` unset must surface a warning so
 * silent split-host fails don't reach prod.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request } from 'express';
import {
  isAllowedFrontendOrigin,
  logCorsConfigSummary,
  __testing,
} from '../../src/periphery/adapters/http/middleware/corsConfig';

const { isSelfOrigin } = __testing;

function mockReq(hostname: string): Request {
  return { hostname } as unknown as Request;
}

describe('CORS persona matrix', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    original.FRONTEND_URL = process.env.FRONTEND_URL;
    original.ANT_CORS_ORIGINS = process.env.ANT_CORS_ORIGINS;
    original.ANT_SERVER_MODE = process.env.ANT_SERVER_MODE;
    delete process.env.FRONTEND_URL;
    delete process.env.ANT_CORS_ORIGINS;
    delete process.env.ANT_SERVER_MODE;
  });

  afterEach(() => {
    for (const key of ['FRONTEND_URL', 'ANT_CORS_ORIGINS', 'ANT_SERVER_MODE'] as const) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('1. Persona A loopback (Local FE → Local BE) — auto-allow, env=0', () => {
    expect(isAllowedFrontendOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedFrontendOrigin('http://localhost:4200')).toBe(true);
    expect(isAllowedFrontendOrigin('http://127.0.0.1:5173')).toBe(true);
  });

  it('2. Persona B same-origin (Managed FE → Managed BE) — isSelfOrigin auto-allow, env=0', () => {
    // FE served from the BE host (`ant.crosstoken.io`). Module scripts
    // emit an Origin header even on same-origin requests, so the auto-
    // allow MUST fire from req.hostname == Origin.hostname, NOT from the
    // FRONTEND_URL allowlist (which is unset for Persona B same-origin).
    const req = mockReq('ant.crosstoken.io');
    expect(isSelfOrigin(req, 'https://ant.crosstoken.io')).toBe(true);
    expect(isAllowedFrontendOrigin('https://ant.crosstoken.io')).toBe(false); // requires self-origin path
  });

  it('3. Persona C same-origin self-host (cloud build, single host) — isSelfOrigin, env=0', () => {
    const req = mockReq('ant.mycompany.com');
    expect(isSelfOrigin(req, 'https://ant.mycompany.com')).toBe(true);
  });

  it('4. Persona C split-host with FRONTEND_URL=https://app.mycompany.com — allowed via FRONTEND_URL', () => {
    process.env.FRONTEND_URL = 'https://app.mycompany.com';
    expect(isAllowedFrontendOrigin('https://app.mycompany.com')).toBe(true);
    // BE host is different (api.mycompany.com); FE origin isn't self.
    const req = mockReq('api.mycompany.com');
    expect(isSelfOrigin(req, 'https://app.mycompany.com')).toBe(false);
  });

  it('5. Persona C split-host with env=0 — rejected (silent split-host fail guard)', () => {
    // FE at app.x, BE at api.x. No FRONTEND_URL, no ANT_CORS_ORIGINS.
    // Without explicit allowlist the request is rejected — the
    // startup warn (test 10) surfaces this misconfig at boot.
    expect(isAllowedFrontendOrigin('https://app.mycompany.com')).toBe(false);
    const req = mockReq('api.mycompany.com');
    expect(isSelfOrigin(req, 'https://app.mycompany.com')).toBe(false);
  });

  it('6. ⚠️ Local FE → Custom Cloud BE with ANT_CORS_ORIGINS=localhost:5173 — allowed via CSV', () => {
    process.env.FRONTEND_URL = 'https://ant.mycompany.com'; // cloud FE retained
    process.env.ANT_CORS_ORIGINS = 'http://localhost:5173';
    expect(isAllowedFrontendOrigin('http://localhost:5173')).toBe(true);
    // FRONTEND_URL allowlist still works in parallel.
    expect(isAllowedFrontendOrigin('https://ant.mycompany.com')).toBe(true);
  });

  it('7. ⚠️ Local FE → Custom Cloud BE with env=0 — loopback auto-allow still fires', () => {
    // Loopback origin is auto-allowed regardless of env — that's the
    // dev-cross-origin guard (see isLoopbackOrigin comment). The
    // silent-fail risk is for NON-loopback split-host (covered by test 5).
    expect(isAllowedFrontendOrigin('http://localhost:5173')).toBe(true);
  });

  it('8. Managed FE → Local BE — rejected (matrix unsupported)', () => {
    // Local BE running at localhost. Origin from `ant.crosstoken.io`.
    // No FRONTEND_URL / ANT_CORS_ORIGINS in local mode → reject.
    const req = mockReq('localhost');
    expect(isSelfOrigin(req, 'https://ant.crosstoken.io')).toBe(false);
    expect(isAllowedFrontendOrigin('https://ant.crosstoken.io')).toBe(false);
  });

  it('9. Any FE → Managed BE (non-matrix origin) — rejected', () => {
    // Managed BE allowlists its own host via FRONTEND_URL. Third-party
    // origin (random.com) must reject — open-redirect / cross-origin
    // theft guard.
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    const req = mockReq('ant.crosstoken.io');
    expect(isAllowedFrontendOrigin('https://random.com')).toBe(false);
    expect(isSelfOrigin(req, 'https://random.com')).toBe(false);
    // Host-suffix attack ("ant.crosstoken.io.attacker.com") must reject.
    expect(isAllowedFrontendOrigin('https://ant.crosstoken.io.attacker.com')).toBe(false);
  });
});

describe('logCorsConfigSummary', () => {
  const original: Record<string, string | undefined> = {};
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    original.FRONTEND_URL = process.env.FRONTEND_URL;
    original.ANT_CORS_ORIGINS = process.env.ANT_CORS_ORIGINS;
    original.ANT_SERVER_MODE = process.env.ANT_SERVER_MODE;
    delete process.env.FRONTEND_URL;
    delete process.env.ANT_CORS_ORIGINS;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    for (const key of ['FRONTEND_URL', 'ANT_CORS_ORIGINS', 'ANT_SERVER_MODE'] as const) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('local mode — silent (no warn, no log)', () => {
    process.env.ANT_SERVER_MODE = 'local';
    logCorsConfigSummary();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('cloud mode + both env unset — warns (silent split-host fail guard)', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    logCorsConfigSummary();
    expect(warnSpy).toHaveBeenCalledOnce();
    const message = warnSpy.mock.calls[0]![0] as string;
    expect(message).toContain('[CORS]');
    expect(message).toContain('FRONTEND_URL');
    expect(message).toContain('ANT_CORS_ORIGINS');
  });

  it('cloud mode + FRONTEND_URL set — info log, no warn', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    logCorsConfigSummary();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0]![0]).toContain('ant.crosstoken.io');
  });

  it('cloud mode + only ANT_CORS_ORIGINS — info log, no warn', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_CORS_ORIGINS = 'http://localhost:5173,https://staging.example.com';
    logCorsConfigSummary();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();
  });
});
