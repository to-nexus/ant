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

export interface JwtPayload {
  sub: string;        // userId
  email: string;      // full email
  org: string;        // organizationId
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

  /** Generate a signed JWT token */
  sign(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JwtPayload = {
      ...payload,
      iat: now,
      exp: now + this.expiresInSeconds,
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

  /** Get cookie options for Set-Cookie */
  getCookieOptions(isProduction: boolean): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    domain?: string;
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      ...(isProduction ? { domain: '.crosstoken.io' } : {}),
      path: '/',
      maxAge: this.expiresInSeconds * 1000, // ms for Express
    };
  }

  /** Get cookie clear options */
  getClearCookieOptions(isProduction: boolean): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    domain?: string;
    path: string;
  } {
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      ...(isProduction ? { domain: '.crosstoken.io' } : {}),
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
