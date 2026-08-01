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
 * TLS options for a Redis URL — single owner of the hostname-check decision.
 * Returns `{}` for plaintext `redis://`; `{ tls: … }` for `rediss://`.
 */
export function buildRedisTlsOptions(url: string): { tls?: RedisTlsOptions } {
  if (!url.startsWith('rediss://')) {
    return {};
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
