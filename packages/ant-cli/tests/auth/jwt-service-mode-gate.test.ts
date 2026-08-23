/**
 * Regression: `createJwtServiceFromEnv` must key on ANT_SERVER_MODE, never on
 * key-material presence.
 *
 * Root incident: a local-mode .env carrying leftover JWT key material (from
 * cloud testing) activated the preview/deploy proxy owner gates — local mode
 * has no login flow, so no session cookie can ever exist, and every preview
 * request 403'd `Forbidden: preview belongs to another account`. The
 * proxyOwnership contract ("jwtService === undefined → local mode: always
 * authorized") only holds if the factory itself refuses to produce a verifier
 * outside cloud mode.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { createJwtServiceFromEnv, JwtService } from '../../src/infrastructure/auth/JwtService';

const ENV_KEYS = ['ANT_SERVER_MODE', 'ANT_JWT_PUBLIC_KEY', 'ANT_JWT_PRIVATE_KEY'] as const;
let saved: Record<string, string | undefined>;

function publicKeyPem(): string {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('createJwtServiceFromEnv — ANT_SERVER_MODE gate', () => {
  it('returns undefined in local mode even when a public key is set (the 403 regression)', () => {
    process.env.ANT_SERVER_MODE = 'local';
    process.env.ANT_JWT_PUBLIC_KEY = publicKeyPem();
    expect(createJwtServiceFromEnv()).toBeUndefined();
  });

  it('returns undefined when ANT_SERVER_MODE is unset, regardless of key material', () => {
    process.env.ANT_JWT_PUBLIC_KEY = publicKeyPem();
    expect(createJwtServiceFromEnv()).toBeUndefined();
  });

  it('returns a JwtService in cloud mode with a public key', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = publicKeyPem();
    expect(createJwtServiceFromEnv()).toBeInstanceOf(JwtService);
  });

  it('returns undefined in cloud mode without a public key (callers fail loud where required)', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    expect(createJwtServiceFromEnv()).toBeUndefined();
  });
});
