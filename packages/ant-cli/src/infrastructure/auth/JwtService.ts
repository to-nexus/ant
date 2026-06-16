/**
 * JWT Service
 * 
 * Handles JWT token generation and verification for authentication.
 * Used by all three publicly exposed servers (ant-api, ant-realtime, ant-preview)
 * to verify httpOnly cookie-based authentication.
 * 
 * Environment: ANT_JWT_SECRET (required in cloud mode)
 */

import * as crypto from 'crypto';
import type { OrganizationKind } from '@ant/shared';

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

export interface JwtServiceConfig {
  secret: string;
  expiresInSeconds?: number;  // default: 7 days
}

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
  private readonly secret: string;
  private readonly expiresInSeconds: number;

  constructor(config: JwtServiceConfig) {
    if (!config.secret || config.secret.length < 32) {
      throw new Error('ANT_JWT_SECRET must be at least 32 characters');
    }
    this.secret = config.secret;
    this.expiresInSeconds = config.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
  }

  /** Generate a signed JWT token. Optional expiresInSeconds overrides instance default. */
  sign(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresInSeconds?: number): string {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JwtPayload = {
      ...payload,
      iat: now,
      exp: now + (expiresInSeconds ?? this.expiresInSeconds),
    };

    const header = this.base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = this.base64url(JSON.stringify(fullPayload));
    const signature = this.hmac(`${header}.${body}`);

    return `${header}.${body}.${signature}`;
  }

  /** Verify and decode a JWT token. Throws on invalid/expired tokens. */
  verify(token: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [header, body, signature] = parts;
    const expectedSig = this.hmac(`${header}.${body}`);

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
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

  private hmac(data: string): string {
    return crypto
      .createHmac('sha256', this.secret)
      .update(data)
      .digest('base64url');
  }
}

/**
 * Create JwtService from environment variables.
 * Returns undefined if ANT_JWT_SECRET is not set (local mode).
 */
export function createJwtServiceFromEnv(): JwtService | undefined {
  const secret = process.env.ANT_JWT_SECRET;
  if (!secret) {
    return undefined;
  }
  return new JwtService({ secret });
}
