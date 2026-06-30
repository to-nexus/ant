/**
 * Proxy ownership gate — SSOT shared by IDE / Preview / Deploy proxies.
 *
 * Owner is the urlKey's first two segments `(tenantId, userId)`. A valid JWT
 * authorizes only when its `(org, sub)` match. Local mode (no jwtService) is
 * always authorized. These properties are what each proxy surface relies on.
 */

import { describe, it, expect } from 'vitest';
import {
  assertProxyOwnership,
  authorizeProxyToken,
  type ProxyJwtVerifier,
} from '../../src/periphery/adapters/http/middleware/proxyOwnership';

// Stub verifier: token `org|sub`; the literal 'bad' throws (invalid token).
const jwt: ProxyJwtVerifier = {
  verify(token: string) {
    if (token === 'bad') throw new Error('invalid');
    const [org, sub] = token.split('|');
    return { org, sub };
  },
};

const OWNER = { tenantId: 'individual', userId: 'a@x.com' };

describe('assertProxyOwnership', () => {
  it('matching org + sub → true', () => {
    expect(assertProxyOwnership({ org: 'individual', sub: 'a@x.com' }, OWNER)).toBe(true);
  });

  it('org mismatch → false', () => {
    expect(assertProxyOwnership({ org: 'team-x', sub: 'a@x.com' }, OWNER)).toBe(false);
  });

  it('user mismatch → false', () => {
    expect(assertProxyOwnership({ org: 'individual', sub: 'b@x.com' }, OWNER)).toBe(false);
  });
});

describe('authorizeProxyToken', () => {
  it('local mode (no jwtService) → always authorized regardless of token', () => {
    expect(authorizeProxyToken(undefined, undefined, OWNER)).toBe(true);
    expect(authorizeProxyToken('anything', undefined, OWNER)).toBe(true);
  });

  it('cloud mode + no token → denied', () => {
    expect(authorizeProxyToken(undefined, jwt, OWNER)).toBe(false);
  });

  it('cloud mode + malformed token → denied (verify throws)', () => {
    expect(authorizeProxyToken('bad', jwt, OWNER)).toBe(false);
  });

  it('cloud mode + other tenant token → denied', () => {
    expect(authorizeProxyToken('team-x|a@x.com', jwt, OWNER)).toBe(false);
  });

  it('cloud mode + other user token → denied', () => {
    expect(authorizeProxyToken('individual|b@x.com', jwt, OWNER)).toBe(false);
  });

  it('cloud mode + owner token → authorized', () => {
    expect(authorizeProxyToken('individual|a@x.com', jwt, OWNER)).toBe(true);
  });
});
