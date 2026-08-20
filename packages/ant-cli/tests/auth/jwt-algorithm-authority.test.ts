/**
 * Session-authority axis — one row per case.
 *
 * C-001: ant-preview verifies sessions and also spawns user-authored install and
 * dev commands under its own UID, so its environment is readable from user code
 * through `/proc`. With HS256 that environment carries the *signing* key, and
 * verification authority and minting authority are the same thing — user code
 * that reads it can forge any tenant's session.
 *
 * Two contracts are locked here:
 *   1. ES256 splits the authority (private key mints, public key only verifies),
 *      and the header `alg` is pinned so the two modes cannot be confused.
 *   2. A verifier-only process refuses to boot while it still holds signing
 *      authority, unless an operator records the exception explicitly.
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

const SECRET = 'x'.repeat(32);
const PAYLOAD = { sub: 'a@b.com', email: 'a@b.com', org: 'individual' };

describe('JwtService — algorithm and authority', () => {
  it('HS256 signs and verifies (single-host fallback)', () => {
    const svc = new JwtService({ secret: SECRET });
    expect(svc.alg).toBe('HS256');
    expect(svc.canSign).toBe(true);
    expect(svc.verify(svc.sign(PAYLOAD)).sub).toBe('a@b.com');
  });

  it('ES256 signs with the private key and verifies with the public key', () => {
    const { publicKey, privateKey } = keyPair();
    const signer = new JwtService({ publicKey, privateKey });
    const verifier = new JwtService({ publicKey });

    expect(signer.alg).toBe('ES256');
    expect(verifier.verify(signer.sign(PAYLOAD)).org).toBe('individual');
  });

  it('an ES256 verifier cannot mint a session', () => {
    const { publicKey } = keyPair();
    const verifier = new JwtService({ publicKey });
    expect(verifier.canSign).toBe(false);
    expect(() => verifier.sign(PAYLOAD)).toThrow(/cannot mint sessions/i);
  });

  it('refuses a private key configured without its public half', () => {
    const { privateKey } = keyPair();
    expect(() => new JwtService({ privateKey })).toThrow(/ANT_JWT_PUBLIC_KEY is required/);
  });

  it('rejects a token whose alg is not the configured one', () => {
    const { publicKey, privateKey } = keyPair();
    const hs = new JwtService({ secret: SECRET });
    const es = new JwtService({ publicKey, privateKey });

    expect(() => es.verify(hs.sign(PAYLOAD))).toThrow(/Unexpected token algorithm/);
    expect(() => hs.verify(es.sign(PAYLOAD))).toThrow(/Unexpected token algorithm/);
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
  const KEYS = ['ANT_SERVER_MODE', 'ANT_JWT_SECRET', 'ANT_JWT_PUBLIC_KEY', 'ANT_JWT_PRIVATE_KEY', 'ANT_JWT_ALLOW_SYMMETRIC'] as const;
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
    process.env.ANT_JWT_SECRET = SECRET;
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
    expect(() => assertJwtAuthorityScope('verify')).toThrow(/signing authority/);
  });

  it('cloud verifier holding the symmetric secret is refused', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_SECRET = SECRET;
    expect(() => assertJwtAuthorityScope('verify')).toThrow(/symmetric/);
  });

  it('the symmetric refusal is opt-out-able, explicitly (verify / non-user-code only)', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_SECRET = SECRET;
    process.env.ANT_JWT_ALLOW_SYMMETRIC = 'true';
    expect(() => assertJwtAuthorityScope('verify')).not.toThrow();
  });

  // C-001 (recheck): a dual-key verifier (public key AND a stray secret) used to
  // boot silently because the predicate only checked `!publicKey && secret`.
  it('cloud verifier holding BOTH a public key and a secret is refused (dual-key)', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = keyPair().publicKey;
    process.env.ANT_JWT_SECRET = SECRET;
    expect(() => assertJwtAuthorityScope('verify')).toThrow(/signing authority/);
  });

  it('dual-key verifier is refused even with ANT_JWT_ALLOW_SYMMETRIC=true when it spawns user code', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = keyPair().publicKey;
    process.env.ANT_JWT_SECRET = SECRET;
    process.env.ANT_JWT_ALLOW_SYMMETRIC = 'true';
    expect(() => assertJwtAuthorityScope('verify-usercode')).toThrow(/signing material/);
  });

  // M-NEW-013: ant-preview ('verify-usercode') is public-key-only, no opt-out.
  it('preview verifier with public key only passes', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = keyPair().publicKey;
    expect(() => assertJwtAuthorityScope('verify-usercode')).not.toThrow();
  });

  it('preview verifier with a secret is refused even under ALLOW_SYMMETRIC', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = keyPair().publicKey;
    process.env.ANT_JWT_SECRET = SECRET;
    process.env.ANT_JWT_ALLOW_SYMMETRIC = 'true';
    expect(() => assertJwtAuthorityScope('verify-usercode')).toThrow(/signing material/);
  });

  it('preview verifier with no public key is refused (symmetric-only is not accepted)', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_SECRET = SECRET;
    process.env.ANT_JWT_ALLOW_SYMMETRIC = 'true';
    expect(() => assertJwtAuthorityScope('verify-usercode')).toThrow();
  });

  // M-NEW-016: the job worker ('none') must carry no JWT key material.
  it('job worker holding a secret is refused', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_SECRET = SECRET;
    expect(() => assertJwtAuthorityScope('none')).toThrow(/neither signs nor verifies/);
  });

  it('job worker holding a private key is refused', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PRIVATE_KEY = keyPair().privateKey;
    expect(() => assertJwtAuthorityScope('none')).toThrow(/neither signs nor verifies/);
  });

  it('job worker with no JWT material passes', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    expect(() => assertJwtAuthorityScope('none')).not.toThrow();
  });

  it('cloud signer with a public key but no private key is refused', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = keyPair().publicKey;
    expect(() => assertJwtAuthorityScope('sign')).toThrow(/ANT_JWT_PRIVATE_KEY is required/);
  });

  it('cloud signer with no key material at all is refused', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    expect(() => assertJwtAuthorityScope('sign')).toThrow(/No JWT key material/);
  });

  it('createJwtServiceFromEnv picks ES256 when a public key is present', () => {
    const { publicKey, privateKey } = keyPair();
    process.env.ANT_SERVER_MODE = 'cloud';
    process.env.ANT_JWT_PUBLIC_KEY = publicKey;
    process.env.ANT_JWT_PRIVATE_KEY = privateKey;
    process.env.ANT_JWT_SECRET = SECRET; // present but not selected
    expect(createJwtServiceFromEnv()?.alg).toBe('ES256');
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
