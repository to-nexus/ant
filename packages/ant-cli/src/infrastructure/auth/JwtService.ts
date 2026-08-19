/**
 * JWT Service
 *
 * Handles JWT token generation and verification for authentication.
 * Used by all three publicly exposed servers (ant-api, ant-realtime, ant-preview)
 * to verify httpOnly cookie-based authentication.
 *
 * ## Why two algorithms
 * HS256 is symmetric: a process that can VERIFY a session can also MINT one. Only
 * ant-api ever needs to mint, but ant-realtime and ant-preview need to verify —
 * and ant-preview spawns user-authored install and dev commands that share its
 * UID and process namespace, so anything in its environment is readable from user
 * code through `/proc` (C-001). Handing it a symmetric key therefore hands user
 * code the authority to forge any tenant's session.
 *
 * ES256 splits that: ant-api holds the private key, every verifier holds only the
 * public key. Reading a public key out of `/proc` buys nothing.
 *
 * Mode is decided by which keys are configured, and the header `alg` is then
 * pinned to it — a token declaring the other algorithm (or `none`) is refused, so
 * there is no algorithm-confusion path between the two modes.
 *
 * Environment (cloud mode):
 *   - `ANT_JWT_PUBLIC_KEY`  — PEM SPKI P-256. Present ⇒ ES256 for every process.
 *   - `ANT_JWT_PRIVATE_KEY` — PEM PKCS8 P-256. ant-api only.
 *   - `ANT_JWT_SECRET`      — HS256 fallback for single-host self-hosting.
 *   - `ANT_JWT_ALLOW_SYMMETRIC` — explicit acknowledgement that a verifier-only
 *     process may hold signing authority. See {@link assertJwtAuthorityScope}.
 */

import * as crypto from 'crypto';
import type { OrganizationKind } from '@ant/shared';
import { logger } from '../../utils/logger';

export interface JwtPayload {
  sub: string;        // userId (full lowercased email in cloud; 'local' in local mode)
  email: string;      // full email
  org: string;        // organizationId (active org)
  kind?: OrganizationKind; // active org kind — optional for BC with pre-kind tokens
  name?: string;      // display name
  picture?: string;   // profile picture URL
  iat: number;        // issued at (epoch seconds)
  exp: number;        // expiration (epoch seconds)
}

export type JwtAlgorithm = 'HS256' | 'ES256';

export interface JwtServiceConfig {
  /** HS256 shared secret. Mutually exclusive with the ES256 key pair. */
  secret?: string;
  /** ES256 verification key (PEM SPKI). Its presence selects ES256. */
  publicKey?: string;
  /** ES256 signing key (PEM PKCS8). Only the minting process should hold one. */
  privateKey?: string;
  expiresInSeconds?: number;  // default: 7 days
}

/**
 * ECDSA signatures come out of OpenSSL DER-encoded; JWS wants the raw r||s pair.
 * `ieee-p1363` is Node's name for that raw form, so no manual re-encoding.
 */
const ES256_DSA_ENCODING = 'ieee-p1363' as const;

const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
const COOKIE_NAME = 'ant_session';

/**
 * Production split-host deployment 에서 cross-subdomain 으로 쿠키를 공유해야
 * 하는 known base domains. 한 쿠키가 ant-server / ant-preview / ant 모든
 * 서브도메인으로 자동 전송되도록 한다. 새 도메인 운영을 시작하면 여기에
 * 한 줄 추가하거나 `COOKIE_DOMAIN` env 를 명시한다.
 */
const KNOWN_BASE_DOMAINS = ['crosstoken.io', 'cross.nexus'] as const;

/**
 * 쿠키 `Domain` 속성을 추론한다.
 * - explicit `COOKIE_DOMAIN` env 가 있으면 그것이 우선 (escape hatch).
 * - localhost / IP / dev 는 host-only (Domain 미설정 → single-origin OK).
 * - `*.crosstoken.io` 같은 known base 는 `.crosstoken.io` 로 묶어 전 서브도메인 전송.
 * - 그 외 알 수 없는 production host 는 host-only fallback (안전).
 */
function deriveCookieDomain(
  hostname: string | undefined,
  isProduction: boolean,
): string | undefined {
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN;
  if (!isProduction || !hostname) return undefined;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return undefined;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return undefined;

  for (const base of KNOWN_BASE_DOMAINS) {
    if (hostname === base || hostname.endsWith('.' + base)) {
      return '.' + base;
    }
  }
  return undefined;
}

export const __testing = { deriveCookieDomain, KNOWN_BASE_DOMAINS };

/**
 * Lightweight JWT implementation using Node.js crypto (HS256).
 * No external dependency required (jsonwebtoken package not needed).
 */
export class JwtService {
  private readonly algorithm: JwtAlgorithm;
  private readonly secret?: string;
  private readonly publicKey?: string;
  private readonly privateKey?: string;
  private readonly expiresInSeconds: number;

  constructor(config: JwtServiceConfig) {
    if (config.publicKey || config.privateKey) {
      // A private key without its public half would leave this instance able to
      // mint tokens it cannot verify — refuse rather than half-configure.
      if (!config.publicKey) {
        throw new Error('ANT_JWT_PUBLIC_KEY is required whenever ANT_JWT_PRIVATE_KEY is set');
      }
      this.algorithm = 'ES256';
      this.publicKey = config.publicKey;
      this.privateKey = config.privateKey;
    } else {
      if (!config.secret || config.secret.length < 32) {
        throw new Error('ANT_JWT_SECRET must be at least 32 characters');
      }
      this.algorithm = 'HS256';
      this.secret = config.secret;
    }
    this.expiresInSeconds = config.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
  }

  /** Which algorithm this instance signs and verifies with. */
  get alg(): JwtAlgorithm {
    return this.algorithm;
  }

  /** Whether this instance can mint tokens (ES256 verifier-only instances cannot). */
  get canSign(): boolean {
    return this.algorithm === 'HS256' || this.privateKey !== undefined;
  }

  /** Generate a signed JWT token. Optional expiresInSeconds overrides instance default. */
  sign(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresInSeconds?: number): string {
    if (!this.canSign) {
      throw new Error(
        'This process holds only a JWT verification key and cannot mint sessions. ' +
        'Signing belongs to the API process (set ANT_JWT_PRIVATE_KEY there only).',
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JwtPayload = {
      ...payload,
      iat: now,
      exp: now + (expiresInSeconds ?? this.expiresInSeconds),
    };

    const header = this.base64url(JSON.stringify({ alg: this.algorithm, typ: 'JWT' }));
    const body = this.base64url(JSON.stringify(fullPayload));
    const signature = this.signPayload(`${header}.${body}`);

    return `${header}.${body}.${signature}`;
  }

  /** Verify and decode a JWT token. Throws on invalid/expired tokens. */
  verify(token: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [header, body, signature] = parts;

    // Pin the algorithm to the configured one BEFORE touching the signature.
    // Accepting whatever the token declares is the classic confusion bug: an
    // ES256 deployment would otherwise verify an HS256 token signed with the
    // public key, and `alg: none` would verify nothing at all.
    let declaredAlg: unknown;
    try {
      declaredAlg = JSON.parse(Buffer.from(header, 'base64url').toString('utf-8'))?.alg;
    } catch {
      throw new Error('Invalid token header');
    }
    if (declaredAlg !== this.algorithm) {
      throw new Error(`Unexpected token algorithm: ${String(declaredAlg)}`);
    }

    if (!this.verifySignature(`${header}.${body}`, signature)) {
      throw new Error('Invalid token signature');
    }

    const payload: JwtPayload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf-8')
    );

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp == null || payload.exp < now) {
      throw new Error('Token expired');
    }

    return payload;
  }

  /** Get cookie name constant */
  static get cookieName(): string {
    return COOKIE_NAME;
  }

  /**
   * Get cookie options for Set-Cookie.
   *
   * The `Domain` attribute is resolved by `deriveCookieDomain` from (1) the
   * `COOKIE_DOMAIN` env var (escape hatch — wins when set) and (2) the
   * request `hostname` matched against `KNOWN_BASE_DOMAINS`. Leaving both
   * paths unsatisfied yields a host-only cookie (Domain attribute omitted),
   * which is correct for localhost / single-origin dev.
   *
   * `getCookieOptions` and `getClearCookieOptions` MUST return identical
   * `domain` / `path` / `sameSite` / `secure` values — RFC 6265bis requires
   * the same attribute set for `clearCookie` to match the live cookie.
   * Pass the same `hostname` to both calls.
   */
  getCookieOptions(isProduction: boolean, hostname?: string): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    domain?: string;
    path: string;
    maxAge: number;
  } {
    const cookieDomain = deriveCookieDomain(hostname, isProduction);
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
      path: '/',
      maxAge: this.expiresInSeconds * 1000, // ms for Express
    };
  }

  /** Get cookie clear options. See `getCookieOptions` JSDoc for the SSOT contract. */
  getClearCookieOptions(isProduction: boolean, hostname?: string): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    domain?: string;
    path: string;
  } {
    const cookieDomain = deriveCookieDomain(hostname, isProduction);
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
      path: '/',
    };
  }

  // ========================================
  // Private Methods
  // ========================================

  private base64url(str: string): string {
    return Buffer.from(str).toString('base64url');
  }

  private signPayload(data: string): string {
    if (this.algorithm === 'HS256') return this.hmac(data);
    return crypto
      .sign('sha256', Buffer.from(data), {
        key: this.privateKey!,
        dsaEncoding: ES256_DSA_ENCODING,
      })
      .toString('base64url');
  }

  private verifySignature(data: string, signature: string): boolean {
    if (this.algorithm === 'HS256') {
      const expected = Buffer.from(this.hmac(data));
      const actual = Buffer.from(signature);
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    }
    try {
      return crypto.verify(
        'sha256',
        Buffer.from(data),
        { key: this.publicKey!, dsaEncoding: ES256_DSA_ENCODING },
        Buffer.from(signature, 'base64url'),
      );
    } catch {
      return false;
    }
  }

  private hmac(data: string): string {
    return crypto
      .createHmac('sha256', this.secret!)
      .update(data)
      .digest('base64url');
  }
}

/**
 * Create JwtService from environment variables.
 *
 * Cloud mode only: JWT session auth exists solely for cloud multi-tenant
 * surfaces. In local mode (single `local:local` tenant, no login flow) this
 * ALWAYS returns undefined — even when ANT_JWT_SECRET happens to be set in
 * .env (e.g. leftover from cloud testing). Secret presence is NOT a mode
 * signal; `ANT_SERVER_MODE` is. Keying on the secret used to activate the
 * preview/deploy proxy owner gates in local mode, where no session cookie
 * can ever exist → every preview 403'd "belongs to another account".
 */
export function createJwtServiceFromEnv(): JwtService | undefined {
  const secret = process.env.ANT_JWT_SECRET;
  const publicKey = readPem(process.env.ANT_JWT_PUBLIC_KEY);
  const privateKey = readPem(process.env.ANT_JWT_PRIVATE_KEY);

  if (process.env.ANT_SERVER_MODE !== 'cloud') {
    if (secret || publicKey || privateKey) {
      logger.warn(
        '[JwtService] JWT key material is set but ANT_SERVER_MODE is not "cloud" — JWT auth disabled (local single-tenant)',
        { component: 'JwtService' },
      );
    }
    return undefined;
  }

  if (publicKey) return new JwtService({ publicKey, privateKey });
  if (!secret) return undefined;
  return new JwtService({ secret });
}

/**
 * PEM from the environment, tolerating the `\n`-escaped form a container
 * orchestrator or `.env` file produces (a real newline cannot survive either).
 */
function readPem(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  return pem.trim() ? pem : undefined;
}

/** Which side of the session contract a process is on. */
export type JwtAuthorityRole = 'sign' | 'verify';

/**
 * Boot-time assertion that a process holds no more session authority than its
 * role needs.
 *
 * `verify` processes are ant-realtime and ant-preview. ant-preview runs
 * user-authored install and dev commands under its own UID and process
 * namespace, so its environment is readable from user code via `/proc`; a
 * symmetric secret or a private key there is platform-wide session forgery
 * (C-001). Refusing at boot is what makes the compose-level scoping a
 * guarantee rather than a convention — an operator who re-adds the key gets a
 * failed start, not a silent regression.
 *
 * `ANT_JWT_ALLOW_SYMMETRIC=true` is the documented opt-out for a single-host
 * self-hosted deployment that accepts the risk and cannot yet run a key pair.
 * Local mode has no session cookie at all and is never gated.
 */
export function assertJwtAuthorityScope(role: JwtAuthorityRole): void {
  if (process.env.ANT_SERVER_MODE !== 'cloud') return;

  const publicKey = readPem(process.env.ANT_JWT_PUBLIC_KEY);
  const privateKey = readPem(process.env.ANT_JWT_PRIVATE_KEY);
  const secret = process.env.ANT_JWT_SECRET;

  if (role === 'sign') {
    if (publicKey && !privateKey) {
      throw new Error(
        'ANT_JWT_PRIVATE_KEY is required in this process: it mints sessions but only ' +
        'a verification key is configured.',
      );
    }
    if (!publicKey && !secret) {
      throw new Error(
        'No JWT key material configured. Set ANT_JWT_PUBLIC_KEY + ANT_JWT_PRIVATE_KEY ' +
        '(recommended) or ANT_JWT_SECRET.',
      );
    }
    return;
  }

  const holdsSigningAuthority = privateKey !== undefined || (!publicKey && secret !== undefined);
  if (!holdsSigningAuthority) return;

  if (process.env.ANT_JWT_ALLOW_SYMMETRIC === 'true') {
    logger.warn(
      '[JwtService] This process only needs to VERIFY sessions but holds signing ' +
      'authority (ANT_JWT_ALLOW_SYMMETRIC=true). User-authored child processes share ' +
      'this UID and can read it from /proc. Move to ANT_JWT_PUBLIC_KEY / ' +
      'ANT_JWT_PRIVATE_KEY to close it.',
      { component: 'JwtService' },
    );
    return;
  }

  throw new Error(
    'This process only needs to VERIFY sessions, but the environment carries JWT ' +
    'signing authority (' +
    (privateKey ? 'ANT_JWT_PRIVATE_KEY' : 'ANT_JWT_SECRET, which is symmetric') +
    '). It spawns user-authored processes that share its UID, so that key is reachable ' +
    'from user code. Configure ANT_JWT_PUBLIC_KEY here and keep ANT_JWT_PRIVATE_KEY on ' +
    'the API process only, or set ANT_JWT_ALLOW_SYMMETRIC=true to accept the risk.',
  );
}
