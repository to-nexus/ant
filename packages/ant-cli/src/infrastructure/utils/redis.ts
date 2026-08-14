/**
 * Redis Utility Functions
 *
 * Common utilities for Redis/ElastiCache connections.
 *
 * @module infrastructure/utils/redis
 */

/**
 * Redis connection options for BullMQ/ioredis
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  tls?: RedisTlsOptions;
}

export interface RedisTlsOptions {
  rejectUnauthorized?: boolean;
  checkServerIdentity?: () => undefined;
  /** SNI + certificate-identity hostname, when it differs from the URL host. */
  servername?: string;
}

/**
 * Whether to skip TLS hostname verification on `rediss://` connections.
 *
 * Opt-in ONLY. AWS ElastiCache Serverless behind a **custom CNAME** serves a
 * certificate issued for `*.serverless.*.cache.amazonaws.com`, so hostname
 * verification fails against the CNAME. Setting
 * `ANT_REDIS_TLS_SKIP_HOSTNAME_CHECK=true` accepts that mismatch — the channel
 * stays encrypted, but a MITM able to redirect DNS is no longer detected.
 *
 * Default (unset) keeps full verification, so a self-hosted deployment never
 * silently inherits the weaker posture. Prefer the native ElastiCache endpoint
 * or a PrivateLink VPC endpoint over enabling this.
 */
export function shouldSkipRedisTlsHostnameCheck(): boolean {
  return process.env.ANT_REDIS_TLS_SKIP_HOSTNAME_CHECK === 'true';
}

/**
 * Hostname to verify the certificate against, when the URL host is a CNAME in
 * front of the real endpoint. Keeps FULL verification (SNI and the identity
 * check both use this name) instead of turning hostname checking off, so it is
 * strictly preferable to {@link shouldSkipRedisTlsHostnameCheck} whenever the
 * native endpoint name is known.
 */
export function redisTlsServername(): string | undefined {
  const servername = process.env.ANT_REDIS_TLS_SERVERNAME?.trim();
  return servername || undefined;
}

/**
 * TLS options for a Redis URL — single owner of the hostname-check decision.
 * Returns `{}` for plaintext `redis://`; `{ tls: … }` for `rediss://`.
 *
 * `servername` and the skip flag are not mutually exclusive by construction,
 * but the skip flag makes `servername` moot — an authored servername wins so a
 * leftover skip flag cannot silently keep the weaker posture.
 */
export function buildRedisTlsOptions(url: string): { tls?: RedisTlsOptions } {
  if (!url.startsWith('rediss://')) {
    return {};
  }
  const servername = redisTlsServername();
  if (servername) {
    return { tls: { servername } };
  }
  return {
    tls: shouldSkipRedisTlsHostnameCheck() ? { checkServerIdentity: () => undefined } : {},
  };
}

/**
 * Parse Redis URL into connection options for BullMQ/ioredis.
 *
 * @example
 * parseRedisUrl('redis://localhost:16379')
 * // => { host: 'localhost', port: 16379 }
 * parseRedisUrl('redis://:pw@redis.example.com:6379')
 * // => { host: 'redis.example.com', port: 6379, password: 'pw' }
 * parseRedisUrl('rediss://:token@redis.example.com:6379')
 * // => { …, tls: {} }  (or tls.checkServerIdentity when the skip env is set)
 */
export function parseRedisUrl(url: string): RedisConnectionOptions {
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parseInt(parsed.port) || 6379,
    password: parsed.password || undefined,
    ...buildRedisTlsOptions(url),
  };
}
