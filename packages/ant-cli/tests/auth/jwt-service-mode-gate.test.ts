/**
 * Regression: `createJwtServiceFromEnv` must key on ANT_SERVER_MODE, never on
 * ANT_JWT_SECRET presence.
 *
 * Root incident: a local-mode .env carrying a leftover ANT_JWT_SECRET (from
 * cloud testing) activated the preview/deploy proxy owner gates — local mode
 * has no login flow, so no session cookie can ever exist, and every preview
 * request 403'd `Forbidden: preview belongs to another account`. The
 * proxyOwnership contract ("jwtService === undefined → local mode: always
 * authorized") only holds if the factory itself refuses to produce a verifier
 * outside cloud mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createJwtServiceFromEnv, JwtService } from '../../src/infrastructure/auth/JwtService';

const ENV_KEYS = ['ANT_SERVER_MODE', 'ANT_JWT_SECRET'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('createJwtServiceFromEnv — ANT_SERVER_MODE gate', () => {
  it('returns undefined in local mode even when ANT_JWT_SECRET is set (the 403 regression)', () => {
    process.env.ANT_SERVER_MODE = 'local';
    process.env.ANT_JWT_SECRET = 'leftover-from-cloud-testing';
    expect(createJwtServiceFromEnv()).toBeUndefined();
  });

  it('returns undefined when ANT_SERVER_MODE is unset, regardless of the secret', () => {
    delete process.env.ANT_SERVER_MODE;
    process.env.ANT_JWT_SECRET = 'some-secret';
    expect(createJwtServiceFromEnv()).toBeUndefined();
  });

  it('returns a JwtService in cloud mode with a secret', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_SECRET = 'cloud-secret-at-least-32-characters-long';
    expect(createJwtServiceFromEnv()).toBeInstanceOf(JwtService);
  });

  it('returns undefined in cloud mode without a secret (callers fail loud where required)', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    delete process.env.ANT_JWT_SECRET;
    expect(createJwtServiceFromEnv()).toBeUndefined();
  });
});
