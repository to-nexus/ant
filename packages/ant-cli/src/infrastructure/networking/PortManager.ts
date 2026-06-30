/**
 * PortManager — Redis-authoritative dynamic port allocator.
 *
 * Port ranges are separated by service type:
 * - Preview (dev-server): 30000-39999 (10,000 ports)
 * - IDE:                   40000-49999 (10,000 ports)
 * - Deploy:                50000-54999 (5,000 ports)
 *
 * Allocation is a global atomic claim in Redis (`SET key NX EX ttl`), so a
 * port number is GLOBALLY UNIQUE across every ant-preview pod. The previous
 * pod-local in-memory `usedPorts` set + bind-test let two pods hand out the
 * same number (project A on pod-1 and project B on pod-2 both got 30000),
 * which is what let cross-pod cleanup kill the wrong project. There is no
 * in-memory mirror and no bind-test race anymore — Redis is the SSOT.
 *
 * If Redis is unavailable, `allocate` throws loudly (Unified Distributed
 * System Principle — no in-memory fallback).
 */

import * as os from 'os';
import type { StateStorePort } from '../../core/ports/stateStore';
import { REDIS_KEYS, REDIS_TTL } from '../../core/constants/redis';

export type PortType = 'dev-server' | 'ide' | 'deploy';

export interface PortRangeConfig {
  min: number;
  max: number;
}

export const PORT_RANGES: Record<PortType, PortRangeConfig> = {
  'dev-server': { min: 30000, max: 39999 },  // 10,000 ports
  'ide': { min: 40000, max: 49999 },          // 10,000 ports
  'deploy': { min: 50000, max: 54999 },       // 5,000 ports
};

/** Owner stamped into a port claim for diagnostics + reconciliation. */
export interface PortOwner {
  podId?: string;
  serverKey?: string;
  pid?: number;
}

/** The subset of StateStorePort the allocator needs (NX claim + cursor + TTL). */
type PortStore = Pick<
  StateStorePort,
  'tryAcquireLock' | 'deleteKey' | 'incrementKey' | 'expireKey'
>;

export class PortManager {
  /**
   * Keys this pod currently holds → range type. NOT a mirror of Redis SSOT
   * state (the claim itself lives in Redis); this is pod-local bookkeeping of
   * "which claims I must keep warm" for the TTL refresh loop, in the same
   * spirit as `previewServers` holding non-serializable process handles.
   */
  private readonly held = new Map<string, PortType>();
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly stateStore?: PortStore) {
    if (stateStore) this.startTtlRefresh();
  }

  /**
   * Allocate a globally-unique available port for a service type.
   *
   * Uses an INCR cursor so we don't rescan from `range.min` every call, and
   * an NX claim so two pods can never settle on the same number. Throws when
   * the range is exhausted or Redis is unavailable.
   */
  async allocate(type: PortType = 'dev-server', owner?: PortOwner): Promise<number> {
    if (!this.stateStore) {
      throw new Error(
        '[PortManager] Redis-backed StateStore is required for port allocation ' +
        '(no in-memory fallback — see Unified Distributed System Principle).',
      );
    }

    const range = PORT_RANGES[type];
    const span = range.max - range.min + 1;
    const value = JSON.stringify({
      podId: owner?.podId ?? os.hostname(),
      serverKey: owner?.serverKey,
      pid: owner?.pid,
    });

    for (let i = 0; i < span; i++) {
      const cursor = await this.stateStore.incrementKey(REDIS_KEYS.INFRA.PORT_CURSOR(type));
      const offset = ((cursor - 1) % span + span) % span;
      const port = range.min + offset;
      const key = REDIS_KEYS.INFRA.PORT_CLAIM(type, port);
      const acquired = await this.stateStore.tryAcquireLock(key, value, REDIS_TTL.INFRA.PORT_CLAIM);
      if (acquired) {
        this.held.set(key, type);
        console.log(`[PortManager] Allocated ${type} port: ${port}`);
        return port;
      }
    }
    throw new Error(`No available ports in ${type} range ${range.min}-${range.max}`);
  }

  /**
   * Release a port back to the pool. Derives the type from the port range so
   * the (void, no-await) call sites stay unchanged. Fire-and-forget DEL of the
   * Redis claim — a released port becomes immediately reclaimable by any pod.
   */
  release(port: number): void {
    const type = this.typeOf(port);
    if (!type) return;
    const key = REDIS_KEYS.INFRA.PORT_CLAIM(type, port);
    this.held.delete(key);
    this.stateStore?.deleteKey(key).catch(() => { /* best-effort */ });
    console.log(`[PortManager] Released port: ${port}`);
  }

  /** Map a port number back to its range type (ranges are disjoint). */
  private typeOf(port: number): PortType | undefined {
    for (const [type, range] of Object.entries(PORT_RANGES) as [PortType, PortRangeConfig][]) {
      if (port >= range.min && port <= range.max) return type;
    }
    return undefined;
  }

  /**
   * Periodically refresh the TTL of every claim this pod still holds so a
   * live port never lapses mid-use. A dead pod stops refreshing, so its
   * claims expire after `PORT_CLAIM` seconds and return to the pool. Interval
   * is TTL/3 to survive a couple of missed ticks. The timer is `unref`'d so
   * it never keeps the process alive.
   */
  private startTtlRefresh(): void {
    const intervalMs = (REDIS_TTL.INFRA.PORT_CLAIM * 1000) / 3;
    this.refreshTimer = setInterval(() => { void this.refreshHeld(); }, intervalMs);
    this.refreshTimer.unref?.();
  }

  private async refreshHeld(): Promise<void> {
    if (!this.stateStore) return;
    for (const key of this.held.keys()) {
      try {
        await this.stateStore.expireKey(key, REDIS_TTL.INFRA.PORT_CLAIM);
      } catch { /* best-effort — a missed refresh just shortens the claim's life */ }
    }
  }

  /** Stop the TTL refresh loop. Called on server shutdown. */
  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Diagnostic-only usage stats, derived from this pod's held set (overall or
   * by type). NOT an authoritative cross-pod count — the SSOT is the set of
   * Redis claim keys.
   */
  getStats(type?: PortType): { total: number; used: number; available: number } {
    if (type) {
      const range = PORT_RANGES[type];
      const total = range.max - range.min + 1;
      const used = Array.from(this.held.values()).filter(t => t === type).length;
      return { total, used, available: total - used };
    }
    const total = Object.values(PORT_RANGES).reduce((acc, r) => acc + (r.max - r.min + 1), 0);
    const used = this.held.size;
    return { total, used, available: total - used };
  }

  /** Stats for all port types (diagnostic). */
  getStatsByType(): Record<PortType, { total: number; used: number; available: number }> {
    return {
      'dev-server': this.getStats('dev-server'),
      'ide': this.getStats('ide'),
      'deploy': this.getStats('deploy'),
    };
  }
}
