/**
 * Distributed locks (SETNX + value-aware DEL), generic key-value operations
 * and the bounded slot set (atomic admission).
 *
 * One layer of the RedisStateStore inheritance chain (see RedisCoreStore.ts —
 * the chain exists because tests instantiate via Object.create(prototype), so
 * methods must live on the prototype chain, not behind a ctx object).
 */

import { logger } from '../../../utils/logger';
import { RedisJobStore } from './RedisJobStore';

export class RedisKvStore extends RedisJobStore {
  // ============================================
  // Distributed Lock — SETNX + value-aware DEL
  // ============================================

  async tryAcquireLock(key: string, value: string, ttlSec: number): Promise<boolean> {
    const result = await this.redis.set(key, value, 'EX', ttlSec, 'NX');
    return result === 'OK';
  }

  async releaseLockIfOwner(key: string, value: string): Promise<void> {
    // Compare-and-delete: only DEL when the current value still matches.
    // Protects against the TTL-expire-then-reacquire race.
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.redis.eval(script, 1, key, value);
    } catch (err) {
      logger.warn(
        `[StateStore] releaseLockIfOwner eval failed (lock will TTL-expire)`,
        { component: 'RedisStateStore' },
        { key, err: err instanceof Error ? err.message : String(err) },
      );
    }
  }


  // ============================================
  // Generic Key-Value Operations
  // ============================================

  async setKeyWithTTL(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.setex(key, ttlSeconds, value);
  }

  async getKey(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async deleteKey(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incrementKey(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async decrementKey(key: string): Promise<number> {
    return this.redis.decr(key);
  }

  async expireKey(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  async countKeysByPrefix(prefix: string): Promise<number> {
    let count = 0;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = nextCursor;
      count += keys.length;
    } while (cursor !== '0');
    return count;
  }

  // ============================================
  // Bounded Slot Set (atomic admission)
  // ============================================

  /**
   * ZSET of holders scored by expiry (epoch ms). Prune-count-add in ONE Lua body,
   * so the count a caller acts on cannot be stale by the time it reserves — the
   * `SCAN`-then-`SETEX` shape it replaces admitted N concurrent callers past an
   * N-1 limit (M-005).
   *
   * Re-reserving the same member is idempotent (it refreshes rather than
   * double-counting), so a retry cannot consume two slots. The key carries a TTL
   * a little beyond the last expiry so an idle set disappears on its own.
   */
  private static readonly RESERVE_SLOT_LUA = `
    local key    = KEYS[1]
    local member = ARGV[1]
    local limit  = tonumber(ARGV[2])
    local now    = tonumber(ARGV[3])
    local expiry = tonumber(ARGV[4])

    redis.call('ZREMRANGEBYSCORE', key, '-inf', now)

    if redis.call('ZSCORE', key, member) == false then
      if redis.call('ZCARD', key) >= limit then
        return 0
      end
    end

    redis.call('ZADD', key, expiry, member)
    redis.call('PEXPIRE', key, math.ceil(expiry - now) + 60000)
    return 1
  `;

  async reserveSlot(setKey: string, member: string, limit: number, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const result = await this.redis.eval(
      RedisKvStore.RESERVE_SLOT_LUA,
      1,
      setKey,
      member,
      String(limit),
      String(now),
      String(now + ttlSeconds * 1000),
    );
    return Number(result) === 1;
  }

  async refreshSlot(setKey: string, member: string, ttlSeconds: number): Promise<boolean> {
    // Only refreshes an EXISTING member (`XX`): a holder whose slot already expired
    // and was pruned must go back through `reserveSlot` and be counted again. `CH`
    // makes zadd report the changed count, so a caller can tell "still mine, TTL
    // extended" (1) from "already gone" (0) and stop rather than run on past a
    // budget it no longer counts against (M-NEW-027). The expiry always advances,
    // so an existing member always counts as changed.
    const expiry = Date.now() + ttlSeconds * 1000;
    const changed = await this.redis.zadd(setKey, 'XX', 'CH', String(expiry), member);
    await this.redis.pexpire(setKey, ttlSeconds * 1000 + 60000);
    return Number(changed) === 1;
  }

  async releaseSlot(setKey: string, member: string): Promise<void> {
    await this.redis.zrem(setKey, member);
  }

  async countSlots(setKey: string): Promise<number> {
    await this.redis.zremrangebyscore(setKey, '-inf', Date.now());
    return this.redis.zcard(setKey);
  }

  // ============================================
  // Distributed Locking
  // ============================================

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) === 1;
  }

}
