/**
 * GitChangeBroadcaster
 *
 * Single publish path for `gitChange` SSE events. Symmetric counterpart
 * to FileTreeBroadcaster — replaces the raw `stateStore.publish` call
 * previously issued from GitWatcherService, so every `gitChange` emission
 * now flows through this one class.
 *
 * Two emission paths (both reach this class):
 *   1. FileTreeBroadcaster co-emit — fires whenever the file tree changes
 *      during a job (covers "job creates files without `git add`" case that
 *      `.git/index` polling misses).
 *   2. GitWatcherService — `.git/index` mtime polling, covers external
 *      terminal operations (git add, commit, checkout, ...).
 *
 * The broadcaster is transport-agnostic: it receives a `publish` callback
 * at construction time. Job-worker children pass a Redis-backed function;
 * HTTP/Realtime servers pass `stateStore.publish.bind(stateStore)`.
 *
 * Flow:
 *   Broadcaster → publish(channel, message) → Realtime Server → SSE → frontend
 */

import { Redis } from 'ioredis';
import type { UserContext } from '../types/user';
import {
  getRealtimeBroadcastChannel,
  BroadcasterOptions,
} from './types';

/**
 * Minimal publisher contract — compatible with both `ioredis.Redis.publish`
 * (after JSON encode) and `StateStorePort.publish`.
 */
export type GitChangePublisher = (
  channel: string,
  payload: unknown
) => Promise<unknown>;

export interface GitChangeBroadcasterOptions {
  publisher: GitChangePublisher;
  /** Captured userContext. Optional — can be overridden per-call. */
  userContext?: UserContext;
  /**
   * If provided, this Redis instance will be `.quit()`'ed on close.
   * Shared connections (e.g. StateStorePort-owned) must not set this.
   */
  ownedRedis?: Redis;
}

export class GitChangeBroadcaster {
  private readonly publisher: GitChangePublisher;
  private readonly userContext?: UserContext;
  private readonly ownedRedis?: Redis;

  constructor(options: GitChangeBroadcasterOptions | BroadcasterOptions) {
    // Overload dispatch: BroadcasterOptions has `redisUrl`, the explicit
    // options variant has `publisher`.
    if ('publisher' in options) {
      this.publisher = options.publisher;
      this.userContext = options.userContext;
      this.ownedRedis = options.ownedRedis;
      return;
    }

    // BroadcasterOptions path — create our own ioredis connection for
    // job-worker child processes. Mirrors KanbanBroadcaster/FileTreeBroadcaster.
    const isTLS = options.redisUrl.startsWith('rediss://');
    const tlsOptions = isTLS
      ? { tls: { checkServerIdentity: () => undefined as undefined } }
      : {};
    const redis = new Redis(options.redisUrl, {
      ...tlsOptions,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });
    redis.on('error', (err) =>
      console.error(`❌ [GitChangeBroadcaster] pubRedis error:`, err.message)
    );
    redis.on('ready', () =>
      console.log(`🟢 [GitChangeBroadcaster] pubRedis ready`)
    );

    this.publisher = async (channel, payload) =>
      redis.publish(channel, JSON.stringify(payload));
    this.userContext = options.userContext;
    this.ownedRedis = redis;
  }

  /**
   * Publish a `gitChange` event for the given project/feature.
   *
   * `userContext` can override the one captured at construction time
   * (required for request-scoped callers like GitWatcherService which
   * serves many users with one shared broadcaster instance).
   *
   * Silently no-ops when userContext is missing — the caller has no
   * recourse and the event simply can't be routed to a user channel.
   */
  async notifyGitChange(
    projectId: string,
    featureName: string,
    userContext?: UserContext
  ): Promise<void> {
    const ctx = userContext || this.userContext;
    if (!ctx?.organizationId || !ctx?.userId) {
      return;
    }

    const channel = getRealtimeBroadcastChannel(
      ctx.organizationId,
      ctx.userId
    );

    const message = {
      projectId,
      featureName,
      userContext: ctx,
      type: 'gitChange' as const,
      data: {
        timestamp: new Date().toISOString(),
        project: projectId,
        feature: featureName,
      },
    };

    try {
      await this.publisher(channel, message);
    } catch (error: any) {
      console.warn(
        `[GitChangeBroadcaster] Failed to publish gitChange:`,
        error?.message ?? error
      );
    }
  }

  /**
   * Close the owned Redis connection (if any). When a shared
   * publisher is used (StateStorePort-backed), this is a no-op —
   * the owner is responsible for lifecycle.
   */
  async close(): Promise<void> {
    if (this.ownedRedis) {
      try {
        await this.ownedRedis.quit();
      } catch {
        // ignore — already closed or never connected
      }
    }
  }
}
