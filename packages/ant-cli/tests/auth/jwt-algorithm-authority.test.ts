/**
 * Session-authority axis — one row per case.
 *
 * C-001: ant-preview verifies sessions and also spawns user-authored install and
 * dev commands under its own UID, so its environment is readable from user code
 * through `/proc`. Sessions are therefore ES256 only: the private key mints, the
 * public key only verifies, and reading a public key out of `/proc` buys nothing.
 *
 * Two contracts are locked here:
 *   1. The header `alg` is pinned to ES256 — a token declaring anything else
 *      (or `none`) is refused.
 *   2. Only the signing process (ant-api) may hold ANT_JWT_PRIVATE_KEY; every
 *      other role refuses to boot with it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';

import {
  JwtService,
  assertJwtAuthorityScope,
  createJwtServiceFromEnv,
} from '../../src/infrastructure/auth/JwtService';

function keyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

const PAYLOAD = { sub: 'a@b.com', email: 'a@b.com', org: 'individual' };

describe('JwtService — algorithm and authority', () => {
  it('ES256 signs with the private key and verifies with the public key', () => {
    const { publicKey, privateKey } = keyPair();
    const signer = new JwtService({ publicKey, privateKey });
    const verifier = new JwtService({ publicKey });

    expect(signer.alg).toBe('ES256');
    expect(verifier.verify(signer.sign(PAYLOAD)).org).toBe('individual');
  });

  it('a verifier cannot mint a session', () => {
    const { publicKey } = keyPair();
    const verifier = new JwtService({ publicKey });
    expect(verifier.canSign).toBe(false);
    expect(() => verifier.sign(PAYLOAD)).toThrow(/cannot mint sessions/i);
  });

  it('refuses a private key configured without its public half', () => {
    const { privateKey } = keyPair();
    // @ts-expect-error — publicKey is required by the type; the runtime guard is the row under test
    expect(() => new JwtService({ privateKey })).toThrow(/ANT_JWT_PUBLIC_KEY is required/);
  });

  it('rejects a token declaring a symmetric algorithm', () => {
    const svc = new JwtService({ ...keyPair() });
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const body = b64({ ...PAYLOAD, iat: now, exp: now + 60 });
    const header = b64({ alg: 'HS256', typ: 'JWT' });
    const sig = crypto.createHmac('sha256', 'x'.repeat(32)).update(`${header}.${body}`).digest('base64url');
    expect(() => svc.verify(`${header}.${body}.${sig}`)).toThrow(/Unexpected token algorithm/);
  });

  it('rejects an alg:none token', () => {
    const es = new JwtService({ ...keyPair() });
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...PAYLOAD, iat: now, exp: now + 60 })}.`;
    expect(() => es.verify(forged)).toThrow(/Unexpected token algorithm/);
  });

  it('rejects an ES256 token signed by a different key pair', () => {
    const a = new JwtService({ ...keyPair() });
    const b = new JwtService({ publicKey: keyPair().publicKey });
    expect(() => b.verify(a.sign(PAYLOAD))).toThrow(/Invalid token signature/);
  });

  it('rejects an expired token', () => {
    const svc = new JwtService({ ...keyPair() });
    expect(() => svc.verify(svc.sign(PAYLOAD, -1))).toThrow(/expired/i);
  });
});

describe('assertJwtAuthorityScope — boot gate (C-001)', () => {
  const KEYS = ['ANT_SERVER_MODE', 'ANT_JWT_PUBLIC_KEY', 'ANT_JWT_PRIVATE_KEY'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  it('local mode is never gated (no session cookie exists)', () => {
    process.env.ANT_JWT_PRIVATE_KEY = keyPair().privateKey;
    expect(() => assertJwtAuthorityScope('verify')).not.toThrow();
  });

  it('cloud verifier holding only a public key passes', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = keyPair().publicKey;
    expect(() => assertJwtAuthorityScope('verify')).not.toThrow();
  });

  it('cloud verifier holding a private key is refused', () => {
    const { publicKey, privateKey } = keyPair();
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = publicKey;
    process.env.ANT_JWT_PRIVATE_KEY = privateKey;
    expect(() => assertJwtAuthorityScope('verify')).toThrow(/ANT_JWT_PRIVATE_KEY/);
  });

  // M-NEW-013: ant-preview ('verify-usercode') is public-key-only.
  it('preview verifier with public key only passes', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = keyPair().publicKey;
    expect(() => assertJwtAuthorityScope('verify-usercode')).not.toThrow();
  });

  it('preview verifier holding a private key is refused', () => {
    const { publicKey, privateKey } = keyPair();
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = publicKey;
    process.env.ANT_JWT_PRIVATE_KEY = privateKey;
    expect(() => assertJwtAuthorityScope('verify-usercode')).toThrow(/ANT_JWT_PRIVATE_KEY/);
  });

  it('preview verifier with no public key is refused', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    expect(() => assertJwtAuthorityScope('verify-usercode')).toThrow(/ANT_JWT_PUBLIC_KEY/);
  });

  // M-NEW-016: the job worker ('none') must carry no signing material.
  it('job worker holding a private key is refused', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PRIVATE_KEY = keyPair().privateKey;
    expect(() => assertJwtAuthorityScope('none')).toThrow(/neither signs nor verifies/);
  });

  it('job worker with no JWT material passes', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    expect(() => assertJwtAuthorityScope('none')).not.toThrow();
  });

  it('a stray public key on the job worker is tolerated (it carries no authority)', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = keyPair().publicKey;
    expect(() => assertJwtAuthorityScope('none')).not.toThrow();
  });

  it('cloud signer with a public key but no private key is refused', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = keyPair().publicKey;
    expect(() => assertJwtAuthorityScope('sign')).toThrow(/key pair/);
  });

  it('cloud signer with no key material at all is refused', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    expect(() => assertJwtAuthorityScope('sign')).toThrow(/key pair/);
  });

  it('cloud signer with the full key pair passes', () => {
    const { publicKey, privateKey } = keyPair();
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = publicKey;
    process.env.ANT_JWT_PRIVATE_KEY = privateKey;
    expect(() => assertJwtAuthorityScope('sign')).not.toThrow();
  });

  it('createJwtServiceFromEnv accepts a \\n-escaped PEM (container env form)', () => {
    const { publicKey } = keyPair();
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = publicKey.replace(/\n/g, '\\n');
    const svc = createJwtServiceFromEnv();
    expect(svc?.alg).toBe('ES256');
    expect(svc?.canSign).toBe(false);
  });
});
