/**
 * JWT Service
 *
 * Handles JWT token generation and verification for authentication.
 * Used by all three publicly exposed servers (ant-api, ant-realtime, ant-preview)
 * to verify httpOnly cookie-based authentication.
 *
 * ## ES256 only
 * Sessions are ES256 exclusively: ant-api holds the private key and mints; every
 * verifier holds only the public key, which carries no minting authority even
 * when read out of `/proc` by user-authored code (C-001). A symmetric algorithm
 * would collapse verify and mint into one capability, so none is supported.
 * The header `alg` is pinned — a token declaring anything else (or `none`) is
 * refused.
 *
 * Environment (cloud mode):
 *   - `ANT_JWT_PUBLIC_KEY`  — PEM SPKI P-256. Every process that verifies.
 *   - `ANT_JWT_PRIVATE_KEY` — PEM PKCS8 P-256. ant-api only.
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

export type JwtAlgorithm = 'ES256';

export interface JwtServiceConfig {
  /** ES256 verification key (PEM SPKI). Required. */
  publicKey: string;
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
 * Lightweight ES256 JWT implementation using Node.js crypto.
 * No external dependency required (jsonwebtoken package not needed).
 */
export class JwtService {
  private readonly algorithm: JwtAlgorithm = 'ES256';
  private readonly publicKey: string;
  private readonly privateKey?: string;
  private readonly expiresInSeconds: number;

  constructor(config: JwtServiceConfig) {
    if (!config.publicKey) {
      throw new Error('ANT_JWT_PUBLIC_KEY is required');
    }
    this.publicKey = config.publicKey;
    this.privateKey = config.privateKey;
    this.expiresInSeconds = config.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
  }

  /** Which algorithm this instance signs and verifies with. */
  get alg(): JwtAlgorithm {
    return this.algorithm;
  }

  /** Whether this instance can mint tokens (verifier-only instances cannot). */
  get canSign(): boolean {
    return this.privateKey !== undefined;
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

    // Pin the algorithm BEFORE touching the signature. Accepting whatever the
    // token declares is the classic confusion bug: a symmetric token signed
    // with the public key, or `alg: none`, would otherwise verify.
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
    return crypto
      .sign('sha256', Buffer.from(data), {
        key: this.privateKey!,
        dsaEncoding: ES256_DSA_ENCODING,
      })
      .toString('base64url');
  }

  private verifySignature(data: string, signature: string): boolean {
    try {
      return crypto.verify(
        'sha256',
        Buffer.from(data),
        { key: this.publicKey, dsaEncoding: ES256_DSA_ENCODING },
        Buffer.from(signature, 'base64url'),
      );
    } catch {
      return false;
    }
  }
}

/**
 * Create JwtService from environment variables.
 *
 * Cloud mode only: JWT session auth exists solely for cloud multi-tenant
 * surfaces. In local mode (single `local:local` tenant, no login flow) this
 * ALWAYS returns undefined — even when key material happens to be set in
 * .env (e.g. leftover from cloud testing). Key presence is NOT a mode
 * signal; `ANT_SERVER_MODE` is. Keying on key material used to activate the
 * preview/deploy proxy owner gates in local mode, where no session cookie
 * can ever exist → every preview 403'd "belongs to another account".
 */
export function createJwtServiceFromEnv(): JwtService | undefined {
  const publicKey = readPem(process.env.ANT_JWT_PUBLIC_KEY);
  const privateKey = readPem(process.env.ANT_JWT_PRIVATE_KEY);

  if (process.env.ANT_SERVER_MODE !== 'cloud') {
    if (publicKey || privateKey) {
      logger.warn(
        '[JwtService] JWT key material is set but ANT_SERVER_MODE is not "cloud" — JWT auth disabled (local single-tenant)',
        { component: 'JwtService' },
      );
    }
    return undefined;
  }

  if (!publicKey) return undefined;
  return new JwtService({ publicKey, privateKey });
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

/**
 * Which side of the session contract a process is on.
 *   - `sign`            — ant-api. Mints sessions; holds the key pair.
 *   - `verify`          — ant-realtime. Verifies only; must hold no private key.
 *   - `verify-usercode` — ant-preview. Verifies AND spawns user-authored code
 *                         under its own UID, so its env is `/proc`-readable.
 *                         Public key required, no private key.
 *   - `none`            — ant-job. Neither signs nor verifies; must hold no
 *                         signing material at all.
 */
export type JwtAuthorityRole = 'sign' | 'verify' | 'verify-usercode' | 'none';

/**
 * Boot-time assertion that a process holds no more session authority than its
 * role needs: only ant-api may carry ANT_JWT_PRIVATE_KEY (C-001, M-NEW-013,
 * M-NEW-016). The public key carries no minting authority and is safe
 * everywhere, but `verify-usercode` requires it because that process cannot
 * work without verification. Local mode has no session cookie and is never
 * gated.
 */
export function assertJwtAuthorityScope(role: JwtAuthorityRole): void {
  if (process.env.ANT_SERVER_MODE !== 'cloud') return;

  const publicKey = readPem(process.env.ANT_JWT_PUBLIC_KEY);
  const privateKey = readPem(process.env.ANT_JWT_PRIVATE_KEY);

  if (role === 'sign') {
    if (!publicKey || !privateKey) {
      throw new Error(
        'This process mints sessions and needs the full ES256 key pair: set ' +
        'ANT_JWT_PUBLIC_KEY and ANT_JWT_PRIVATE_KEY.',
      );
    }
    return;
  }

  if (privateKey !== undefined) {
    throw new Error(
      role === 'none'
        ? 'The job worker holds ANT_JWT_PRIVATE_KEY but neither signs nor verifies ' +
          'sessions. It spawns user-authored commands that share its UID, so remove ' +
          'it from the ant-job environment.'
        : 'This process only VERIFIES sessions, but the environment carries ' +
          'ANT_JWT_PRIVATE_KEY. Keep the private key on the API process only.',
    );
  }

  if (role === 'verify-usercode' && !publicKey) {
    throw new Error(
      'The preview verifier has no ANT_JWT_PUBLIC_KEY. It must verify sessions ' +
      'with the ES256 public key.',
    );
  }
}
