/**
 * `isAuthDebugLoggingEnabled` — the gate for the `/auth/*` debug log lines.
 *
 * Those lines emit raw request headers (cookie presence, origin, host,
 * x-forwarded-*) and must NEVER fire in a production-like runtime, even when
 * `ANT_AUTH_DEBUG=1` is set by accident. The flag is a local-dev aid only.
 *
 * Production-like = NODE_ENV=production OR ANT_SERVER_MODE=cloud.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAuthDebugLoggingEnabled } from '../../src/periphery/adapters/http/routes/auth.routes';

describe('isAuthDebugLoggingEnabled', () => {
  const originalDebug = process.env.ANT_AUTH_DEBUG;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalMode = process.env.ANT_SERVER_MODE;

  beforeEach(() => {
    delete process.env.ANT_AUTH_DEBUG;
    delete process.env.NODE_ENV;
    delete process.env.ANT_SERVER_MODE;
  });

  afterEach(() => {
    const restore = (k: string, v: string | undefined) =>
      v === undefined ? delete (process.env as any)[k] : (process.env[k] = v);
    restore('ANT_AUTH_DEBUG', originalDebug);
    restore('NODE_ENV', originalNodeEnv);
    restore('ANT_SERVER_MODE', originalMode);
  });

  it('is off when the flag is unset (default)', () => {
    expect(isAuthDebugLoggingEnabled()).toBe(false);
  });

  it('is off when the flag is set to anything other than "1"', () => {
    process.env.ANT_AUTH_DEBUG = 'true';
    expect(isAuthDebugLoggingEnabled()).toBe(false);
  });

  it('is on in local dev when ANT_AUTH_DEBUG=1 and no prod-like signal', () => {
    process.env.ANT_AUTH_DEBUG = '1';
    expect(isAuthDebugLoggingEnabled()).toBe(true);
  });

  it('is force-disabled when NODE_ENV=production even with the flag set', () => {
    process.env.ANT_AUTH_DEBUG = '1';
    process.env.NODE_ENV = 'production';
    expect(isAuthDebugLoggingEnabled()).toBe(false);
  });

  it('is force-disabled when ANT_SERVER_MODE=cloud even with the flag set', () => {
    process.env.ANT_AUTH_DEBUG = '1';
    process.env.ANT_SERVER_MODE = 'cloud';
    expect(isAuthDebugLoggingEnabled()).toBe(false);
  });

  it('is force-disabled when both prod-like signals are present', () => {
    process.env.ANT_AUTH_DEBUG = '1';
    process.env.NODE_ENV = 'production';
    process.env.ANT_SERVER_MODE = 'cloud';
    expect(isAuthDebugLoggingEnabled()).toBe(false);
  });
});
