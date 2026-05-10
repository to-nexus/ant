/**
 * Origin-aware OAuth callback redirect — the predicate `isAllowedFrontendOrigin`
 * + the post-state resolver `resolveFrontendOrigin` + the start-handler
 * helper `extractStartOrigin` jointly land the user back on whichever FE
 * origin initiated the OAuth flow, even when the OAuth flow itself ran
 * through a different BE host (e.g. localhost:4200 FE → cloud BE).
 *
 * Open-redirect invariant: a malicious `Origin` header MUST NOT widen the
 * redirect target. Any origin that fails the allowlist falls back to
 * `process.env.FRONTEND_URL` so an attacker-supplied Origin can never
 * make the BE redirect to attacker.com.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isAllowedFrontendOrigin,
  resolveFrontendOrigin,
} from '../../src/periphery/adapters/http/middleware/corsConfig';
import { extractStartOrigin } from '../../src/periphery/adapters/http/middleware/originHelper';

describe('isAllowedFrontendOrigin', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    original.FRONTEND_URL = process.env.FRONTEND_URL;
    original.ANT_CORS_ORIGINS = process.env.ANT_CORS_ORIGINS;
  });

  afterEach(() => {
    if (original.FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = original.FRONTEND_URL;
    if (original.ANT_CORS_ORIGINS === undefined) delete process.env.ANT_CORS_ORIGINS;
    else process.env.ANT_CORS_ORIGINS = original.ANT_CORS_ORIGINS;
  });

  it('allows loopback origins regardless of FRONTEND_URL config', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    delete process.env.ANT_CORS_ORIGINS;
    expect(isAllowedFrontendOrigin('http://localhost:4200')).toBe(true);
    expect(isAllowedFrontendOrigin('http://localhost:4300')).toBe(true);
    expect(isAllowedFrontendOrigin('http://127.0.0.1:4200')).toBe(true);
  });

  it('allows the FRONTEND_URL origin (split-host SSOT)', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    delete process.env.ANT_CORS_ORIGINS;
    expect(isAllowedFrontendOrigin('https://ant.crosstoken.io')).toBe(true);
  });

  it('allows ANT_CORS_ORIGINS members', () => {
    delete process.env.FRONTEND_URL;
    process.env.ANT_CORS_ORIGINS = 'https://staging.example.com,https://qa.example.com';
    expect(isAllowedFrontendOrigin('https://staging.example.com')).toBe(true);
    expect(isAllowedFrontendOrigin('https://qa.example.com')).toBe(true);
  });

  it('rejects unknown origins (open redirect protection)', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    process.env.ANT_CORS_ORIGINS = 'https://staging.example.com';
    expect(isAllowedFrontendOrigin('https://attacker.com')).toBe(false);
    expect(isAllowedFrontendOrigin('https://ant.crosstoken.io.attacker.com')).toBe(false);
    expect(isAllowedFrontendOrigin('https://localhost.attacker.com')).toBe(false);
  });

  it('rejects undefined / empty origin', () => {
    expect(isAllowedFrontendOrigin(undefined)).toBe(false);
    expect(isAllowedFrontendOrigin('')).toBe(false);
  });

  it('does NOT recognise the CORS allow-all "*" wildcard for redirect purposes', () => {
    // CORS 의 allow-all 정책은 createCorsMiddleware 만의 책임. redirect 대상으로 '*'
    // 을 허용하면 open redirect 가 됨.
    process.env.ANT_CORS_ORIGINS = '*';
    delete process.env.FRONTEND_URL;
    expect(isAllowedFrontendOrigin('https://attacker.com')).toBe(false);
    // localhost 은 별도 분기 (loopback) 로 통과
    expect(isAllowedFrontendOrigin('http://localhost:4200')).toBe(true);
  });

  it('handles malformed FRONTEND_URL gracefully', () => {
    process.env.FRONTEND_URL = 'not-a-url';
    delete process.env.ANT_CORS_ORIGINS;
    // No throw, just doesn't match. Loopback still works.
    expect(isAllowedFrontendOrigin('https://ant.crosstoken.io')).toBe(false);
    expect(isAllowedFrontendOrigin('http://localhost:4200')).toBe(true);
  });
});

describe('resolveFrontendOrigin', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    original.FRONTEND_URL = process.env.FRONTEND_URL;
    original.ANT_CORS_ORIGINS = process.env.ANT_CORS_ORIGINS;
  });

  afterEach(() => {
    if (original.FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = original.FRONTEND_URL;
    if (original.ANT_CORS_ORIGINS === undefined) delete process.env.ANT_CORS_ORIGINS;
    else process.env.ANT_CORS_ORIGINS = original.ANT_CORS_ORIGINS;
  });

  it('returns the start origin when it is on the allowlist (localhost:4200)', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    expect(resolveFrontendOrigin('http://localhost:4200', process.env.FRONTEND_URL))
      .toBe('http://localhost:4200');
  });

  it('returns the start origin when it is on the allowlist (localhost:4300)', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    expect(resolveFrontendOrigin('http://localhost:4300', process.env.FRONTEND_URL))
      .toBe('http://localhost:4300');
  });

  it('returns the start origin when it matches FRONTEND_URL (production)', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    expect(resolveFrontendOrigin('https://ant.crosstoken.io', process.env.FRONTEND_URL))
      .toBe('https://ant.crosstoken.io');
  });

  it('falls back to FRONTEND_URL when start origin is disallowed (open redirect protection)', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    expect(resolveFrontendOrigin('https://attacker.com', process.env.FRONTEND_URL))
      .toBe('https://ant.crosstoken.io');
  });

  it('falls back to FRONTEND_URL when start origin is missing (no Origin / Referer)', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    expect(resolveFrontendOrigin(undefined, process.env.FRONTEND_URL))
      .toBe('https://ant.crosstoken.io');
  });

  it('returns empty string when both start origin and FRONTEND_URL are unset', () => {
    delete process.env.FRONTEND_URL;
    expect(resolveFrontendOrigin(undefined, undefined)).toBe('');
  });
});

describe('extractStartOrigin', () => {
  it('returns the Origin header when present', () => {
    expect(extractStartOrigin('http://localhost:4200', undefined))
      .toBe('http://localhost:4200');
    expect(extractStartOrigin('https://ant.crosstoken.io', 'https://other.example.com/page'))
      .toBe('https://ant.crosstoken.io'); // Origin wins over Referer
  });

  it('falls back to Referer origin when Origin is missing', () => {
    expect(extractStartOrigin(undefined, 'http://localhost:4200/some/path?q=1'))
      .toBe('http://localhost:4200');
    expect(extractStartOrigin(undefined, 'https://ant.crosstoken.io/'))
      .toBe('https://ant.crosstoken.io');
  });

  it('returns undefined when neither header is present', () => {
    expect(extractStartOrigin(undefined, undefined)).toBe(undefined);
  });

  it('returns undefined when Referer is malformed', () => {
    expect(extractStartOrigin(undefined, 'not-a-url')).toBe(undefined);
  });

  it('handles array-valued headers (Node http takes the first)', () => {
    expect(extractStartOrigin(['http://localhost:4200', 'http://second.example.com'], undefined))
      .toBe('http://localhost:4200');
  });

  it('returns undefined when Origin is empty string and no Referer', () => {
    expect(extractStartOrigin('', undefined)).toBe(undefined);
  });
});

describe('callback redirect resolution scenarios (integration-shaped)', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    original.FRONTEND_URL = process.env.FRONTEND_URL;
    original.ANT_CORS_ORIGINS = process.env.ANT_CORS_ORIGINS;
  });

  afterEach(() => {
    if (original.FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = original.FRONTEND_URL;
    if (original.ANT_CORS_ORIGINS === undefined) delete process.env.ANT_CORS_ORIGINS;
    else process.env.ANT_CORS_ORIGINS = original.ANT_CORS_ORIGINS;
  });

  it('Scenario 1 — localhost:4200 → localhost:4200 (loopback start)', () => {
    process.env.FRONTEND_URL = 'http://localhost:4200';
    const startOrigin = extractStartOrigin('http://localhost:4200', undefined);
    const frontendUrl = resolveFrontendOrigin(startOrigin, process.env.FRONTEND_URL);
    expect(`${frontendUrl}/app/?auth=success`).toBe('http://localhost:4200/app/?auth=success');
  });

  it('Scenario 2 — localhost:4200 calling production BE (split mode)', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    const startOrigin = extractStartOrigin('http://localhost:4200', undefined);
    const frontendUrl = resolveFrontendOrigin(startOrigin, process.env.FRONTEND_URL);
    expect(`${frontendUrl}/app/?auth=success`).toBe('http://localhost:4200/app/?auth=success');
  });

  it('Scenario 3 — production frontend preserves production redirect', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    const startOrigin = extractStartOrigin('https://ant.crosstoken.io', undefined);
    const frontendUrl = resolveFrontendOrigin(startOrigin, process.env.FRONTEND_URL);
    expect(`${frontendUrl}/app/?auth=success`).toBe('https://ant.crosstoken.io/app/?auth=success');
  });

  it('Scenario 4 — attacker origin falls back to FRONTEND_URL (open redirect blocked)', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    const startOrigin = extractStartOrigin('https://attacker.com', undefined);
    const frontendUrl = resolveFrontendOrigin(startOrigin, process.env.FRONTEND_URL);
    expect(frontendUrl).toBe('https://ant.crosstoken.io');
    expect(frontendUrl.startsWith('https://attacker.com')).toBe(false);
  });

  it('Scenario 5 — no Origin / Referer falls back to FRONTEND_URL', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    const startOrigin = extractStartOrigin(undefined, undefined);
    const frontendUrl = resolveFrontendOrigin(startOrigin, process.env.FRONTEND_URL);
    expect(frontendUrl).toBe('https://ant.crosstoken.io');
  });

  it('Scenario 6 — ant-site (localhost:4300) lands back on localhost:4300', () => {
    process.env.FRONTEND_URL = 'https://ant.crosstoken.io';
    const startOrigin = extractStartOrigin('http://localhost:4300', undefined);
    const frontendUrl = resolveFrontendOrigin(startOrigin, process.env.FRONTEND_URL);
    expect(`${frontendUrl}/`).toBe('http://localhost:4300/');
  });
});
