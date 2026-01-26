/**
 * Redis Utility Functions
 * 
 * Common utilities for Redis/ElastiCache connections.
 * Handles TLS configuration for AWS ElastiCache Serverless with custom CNAME.
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
  tls?: {
    rejectUnauthorized?: boolean;
    checkServerIdentity?: () => undefined;
  };
}

/**
 * Parse Redis URL and return connection options for BullMQ/ioredis
 * 
 * ## TLS Hostname Verification
 * 
 * When using AWS ElastiCache Serverless with a **custom CNAME** (e.g., `redis.mycompany.com`),
 * the TLS certificate is issued for `*.serverless.*.cache.amazonaws.com`, not the custom domain.
 * This causes hostname verification to fail.
 * 
 * ### Security Considerations
 * 
 * ⚠️ **WARNING**: Skipping hostname verification (`checkServerIdentity: () => undefined`)
 * reduces TLS security. This is acceptable when:
 * 
 * 1. **Network is trusted** (VPC, private subnet, security groups)
 * 2. **DNS is trusted** (Route53, no risk of DNS spoofing)
 * 3. **Connection is encrypted** (TLS still encrypts data in transit)
 * 
 * ### Alternatives (for higher security requirements):
 * 
 * 1. Use the original ElastiCache endpoint (*.cache.amazonaws.com)
 * 2. Use AWS PrivateLink with VPC endpoints
 * 3. Implement custom certificate validation logic
 * 
 * @param url - Redis URL (redis:// or rediss:// for TLS)
 * @returns Connection options compatible with BullMQ and ioredis
 * 
 * @example
 * ```typescript
 * // Standard Redis
 * parseRedisUrl('redis://localhost:6379')
 * // => { host: 'localhost', port: 6379 }
 * 
 * // Redis with password
 * parseRedisUrl('redis://:mypassword@redis.example.com:6379')
 * // => { host: 'redis.example.com', port: 6379, password: 'mypassword' }
 * 
 * // ElastiCache with TLS (custom CNAME)
 * parseRedisUrl('rediss://:token@redis.mycompany.com:6379')
 * // => { host: 'redis.mycompany.com', port: 6379, password: 'token', tls: { checkServerIdentity: () => undefined } }
 * ```
 */
export function parseRedisUrl(url: string): RedisConnectionOptions {
  const parsed = new URL(url);
  const isTLS = url.startsWith('rediss://');
  
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port) || 6379,
    password: parsed.password || undefined,
    // TLS options for ElastiCache with custom CNAME
    // See JSDoc above for security considerations
    ...(isTLS && {
      tls: {
        // Skip hostname verification for custom CNAME
        // The certificate is valid but issued for *.serverless.*.cache.amazonaws.com
        checkServerIdentity: () => undefined
      }
    })
  };
}

/**
 * Create TLS options for ioredis when using ElastiCache with custom CNAME
 * 
 * @param url - Redis URL to check for TLS
 * @returns TLS options object or empty object
 */
export function createTLSOptions(url: string): { tls?: { checkServerIdentity: () => undefined } } {
  const isTLS = url.startsWith('rediss://');
  
  if (!isTLS) {
    return {};
  }
  
  return {
    tls: {
      checkServerIdentity: () => undefined
    }
  };
}
