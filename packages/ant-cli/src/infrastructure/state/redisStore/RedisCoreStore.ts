/**
 * RedisCoreStore — connection plumbing, key building, pub/sub, lifecycle and
 * diagnostics. Root of the RedisStateStore inheritance chain: each domain
 * cluster is one layer (jobs → kv → deploy → preview → ide → turnBuffer →
 * sessionState), and `RedisStateStore` at the top adds the cross-domain
 * cleanup sweeps and declares the ports.
 *
 * Why an inheritance chain rather than extracted functions over a ctx:
 * policy tests instantiate the store with `Object.create(RedisStateStore.
 * prototype)` and inject `redis` directly — methods must stay prototype
 * methods that read `this.redis` at call time, with no constructor-built
 * indirection.
 */

import Redis from 'ioredis';
import { buildRedisTlsOptions } from '../../utils/redis';
import { APP_PREFIX, REDIS_KEYS } from '../redisConstants';
import { logger } from '../../../utils/logger';

export interface RedisStateStoreOptions {
  url: string;
  maxRetriesPerRequest?: number;
}

export class RedisCoreStore {
  private static readonly CONN_ERROR_LOG_INTERVAL_MS = 30_000;

  protected redis: Redis;
  private subscriber: Redis;
  private subscriptions = new Map<string, Set<(message: unknown) => void>>();
  /** Last log time per connection label — see {@link logConnectionFailure}. */
  private lastConnErrorLogAt = new Map<string, number>();

  constructor(options: RedisStateStoreOptions) {
    // Hostname-verification policy is owned by buildRedisTlsOptions
    // (ANT_REDIS_TLS_SERVERNAME / ANT_REDIS_TLS_SKIP_HOSTNAME_CHECK) — never
    // decided per call site.
    const tlsOptions = buildRedisTlsOptions(options.url);

    // Main connection for commands. Same never-give-up backoff every other Redis
    // client in this repo uses: returning null after N attempts permanently
    // killed the command channel for the process lifetime (every later command
    // threw `Connection is closed.`, and the dead client stopped emitting
    // `error`, so the logs went quiet about the cause), which turned a fixable
    // endpoint misconfiguration into an outage that survived fixing it.
    this.redis = new Redis(options.url, {
      ...tlsOptions,
      maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });

    // Separate connection for pub/sub (required by Redis)
    this.subscriber = new Redis(options.url, {
      ...tlsOptions,
      maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3
    });

    this.setupEventHandlers();
    this.setupSubscriber();
  }

  /**
   * Connection errors are logged first-occurrence-then-throttled, with only
   * `code` + `message`, never the error object.
   *
   * A deterministic connect failure repeats on every retry, and ioredis attaches
   * the whole peer certificate to a TLS error — one such incident printed 125
   * full X.509 dumps in 83 seconds, which pushed every other line out of the
   * log window and made the actual cause harder to find, not easier.
   */
  private logConnectionFailure(label: string, err: Error): void {
    const now = Date.now();
    const last = this.lastConnErrorLogAt.get(label) ?? 0;
    if (now - last < RedisCoreStore.CONN_ERROR_LOG_INTERVAL_MS) return;
    this.lastConnErrorLogAt.set(label, now);
    const code = (err as NodeJS.ErrnoException).code;
    logger.error(`${label}: ${code ? `${code} — ` : ''}${err.message}`, { component: 'RedisStateStore' });
  }

  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      this.lastConnErrorLogAt.delete('Redis error');
      logger.info('Redis connected', { component: 'RedisStateStore' });
    });

    this.redis.on('error', (err: Error) => {
      this.logConnectionFailure('Redis error', err);
    });

    this.redis.on('close', () => {
      logger.warn('Redis connection closed', { component: 'RedisStateStore' });
    });
  }

  private setupSubscriber(): void {
    this.subscriber.on('ready', () => {
      this.lastConnErrorLogAt.delete('Redis subscriber error');
      logger.info(`Redis subscriber ready (${this.subscriptions.size} channels)`, { component: 'RedisStateStore' });
    });
    this.subscriber.on('reconnecting', () => {
      logger.debug('Redis subscriber reconnecting', { component: 'RedisStateStore' });
    });
    this.subscriber.on('error', (err: Error) => {
      this.logConnectionFailure('Redis subscriber error', err);
    });
    this.subscriber.on('close', () => {
      logger.debug('Redis subscriber closed', { component: 'RedisStateStore' });
    });

    this.subscriber.on('message', (channel: string, message: string) => {
      const callbacks = this.subscriptions.get(channel);
      if (callbacks) {
        try {
          const parsed = JSON.parse(message);
          for (const callback of callbacks) {
            callback(parsed);
          }
        } catch (error) {
          logger.error(`Failed to parse pub/sub message for channel ${channel}`, { component: 'RedisStateStore' }, error);
        }
      }
    });
  }

  /** Build Redis key from central constant + parts (e.g., key(REDIS_KEYS.JOB.STATUS, jobId)) */
  protected key(prefix: string, ...parts: string[]): string {
    return `${prefix}${parts.join(':')}`;
  }


  // ============================================
  // Pub/Sub
  // ============================================

  async publish(channel: string, message: unknown): Promise<void> {
    await this.redis.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, callback: (message: unknown) => void): Promise<() => void> {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
      await this.subscriber.subscribe(channel);
    }

    this.subscriptions.get(channel)!.add(callback);

    // Return unsubscribe function
    return async () => {
      const callbacks = this.subscriptions.get(channel);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(channel);
          await this.subscriber.unsubscribe(channel);
        }
      }
    };
  }


  // ============================================
  // Lifecycle
  // ============================================

  /**
   * ioredis reports `'ready'` once the handshake completed and the connection
   * accepts commands. Every other status ('connecting', 'reconnecting',
   * 'close', 'end') means a command issued now rejects — which is exactly what
   * a caller about to commit an SSE 200 needs to know beforehand.
   */
  isTransportReady(): boolean {
    return this.redis.status === 'ready';
  }

  async close(): Promise<void> {
    logger.info('Closing Redis connections', { component: 'RedisStateStore' });
    
    await this.subscriber.quit();
    await this.redis.quit();
    
    this.subscriptions.clear();
  }

  async clear(): Promise<void> {
    // WARNING: This deletes all keys with the prefix
    const keys = await this.redis.keys(`${APP_PREFIX}:*`);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    
    logger.info('Cleared all state', { component: 'RedisStateStore' });
  }

  // ============================================
  // Health Check
  // ============================================

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Expose the underlying ioredis client for adapters that need direct
   * Redis access (e.g. `RedisOrganizationRepository`). Keeps the
   * connection count to one — separate adapters share the same client
   * rather than each opening a new socket.
   */
  getRedisClient(): Redis {
    return this.redis;
  }

  // ============================================
  // Stats (for debugging/monitoring)
  // ============================================

  async getStats(): Promise<{
    jobs: number;
    previews: number;
    ides: number;
    subscriptions: number;
  }> {
    const [jobKeys, previewMembers, ideMembers] = await Promise.all([
      this.redis.keys(`${REDIS_KEYS.JOB.STATUS}*`),
      this.redis.scard(REDIS_KEYS.INFRA.PREVIEW_LIST),
      this.redis.scard(REDIS_KEYS.INFRA.IDE_LIST)
    ]);

    return {
      jobs: jobKeys.length,
      previews: previewMembers,
      ides: ideMembers,
      subscriptions: this.subscriptions.size
    };
  }
}
