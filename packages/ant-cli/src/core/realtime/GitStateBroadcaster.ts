/**
 * GitStateBroadcaster (→ GitStateBroadcaster at cutover)
 *
 * Single publish path for `gitState` SSE events. Replaces the raw
 * `stateStore.publish` call previously issued from GitWatcherService, so
 * every git realtime emission flows through this one class.
 *
 * Three publish methods (all emit the same `gitState` SSE event type with
 * distinct discriminated-union payloads keyed by `cause`):
 *
 *   1. {@link GitStateBroadcaster.notifyWorkingTreeChange}
 *        `cause='workingTreeChange'` — lightweight hint (project/feature/
 *        timestamp only). Fired by {@link FileTreeBroadcaster} co-emit and
 *        by `GitWatcherService` `.git/index` polling. FE reacts with a
 *        debounced light-weight refresh. Cost is identical to the legacy
 *        gitChange event (no snapshot computed).
 *
 *   2. {@link GitStateBroadcaster.notifyOperationComplete}
 *        `cause='operationComplete'` — full snapshot + operation FSM + PAT
 *        state. Fired by {@link GitOperation.onSuccess} for every
 *        user-initiated operation. Drives snapshot replacement and the
 *        success transition of the operation FSM.
 *
 *   3. {@link GitStateBroadcaster.notifyReconnectRefill}
 *        `cause='reconnectRefill'` — full snapshot + PAT state. Fired when
 *        a user SSE subscription (re)opens so a reloaded browser tab never
 *        sees a stale UI even before the first user action.
 *
 * The SSE event type count is unchanged (10) — the legacy `gitChange` type
 * was renamed to `gitState`.
 *
 * The broadcaster is transport-agnostic: it receives a `publish` callback
 * at construction time. Job-worker children pass a Redis-backed function;
 * HTTP/Realtime servers pass `stateStore.publish.bind(stateStore)`.
 *
 * Flow:
 *   Broadcaster → publish(channel, message) → Realtime Server → SSE → frontend
 */

import { Redis } from 'ioredis';
import type {
  GitSnapshot,
  GitOperationState,
  GitPatState,
  GitStateEventData,
} from '@ant/shared';
import type { UserContext } from '../types/user';
import {
  getRealtimeBroadcastChannel,
  BroadcasterOptions,
} from './types';
import { InflightTracker } from './InflightTracker';

/**
 * Minimal publisher contract — compatible with both `ioredis.Redis.publish`
 * (after JSON encode) and `StateStorePort.publish`.
 */
export type GitChangePublisher = (
  channel: string,
  payload: unknown
) => Promise<unknown>;

export interface GitStateBroadcasterOptions {
  publisher: GitChangePublisher;
  /** Captured userContext. Optional — can be overridden per-call. */
  userContext?: UserContext;
  /**
   * If provided, this Redis instance will be `.quit()`'ed on close.
   * Shared connections (e.g. StateStorePort-owned) must not set this.
   */
  ownedRedis?: Redis;
}

export class GitStateBroadcaster {
  private readonly publisher: GitChangePublisher;
  private readonly userContext?: UserContext;
  private readonly ownedRedis?: Redis;
  // Tracks in-flight publishes so close() can flush before quitting the
  // owned Redis. Important because parent broadcasters (e.g. FileTree)
  // run close() concurrently via Promise.all — without flush a co-emitted
  // gitState publish could be cut off mid-flight.
  private readonly inflight = new InflightTracker();

  constructor(options: GitStateBroadcasterOptions | BroadcasterOptions) {
    if ('publisher' in options) {
      this.publisher = options.publisher;
      this.userContext = options.userContext;
      this.ownedRedis = options.ownedRedis;
      return;
    }

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
      console.error(`❌ [GitStateBroadcaster] pubRedis error:`, err.message)
    );
    redis.on('ready', () =>
      console.log(`🟢 [GitStateBroadcaster] pubRedis ready`)
    );

    this.publisher = async (channel, payload) =>
      redis.publish(channel, JSON.stringify(payload));
    this.userContext = options.userContext;
    this.ownedRedis = redis;
  }

  /**
   * Publish a lightweight `gitState` event with cause='workingTreeChange'.
   *
   * Fired for working-tree/index mutations detected by file tree co-emit
   * or `.git/index` polling. No snapshot computed — payload is three
   * fields only. Cost matches the legacy `gitChange` event.
   */
  async notifyWorkingTreeChange(
    projectId: string,
    featureName: string,
    userContext?: UserContext
  ): Promise<void> {
    const payload: GitStateEventData = {
      cause: 'workingTreeChange',
      project: projectId,
      feature: featureName,
      timestamp: new Date().toISOString(),
    };
    await this.publishGitState(projectId, featureName, payload, userContext);
  }

  /**
   * Publish a full-snapshot `gitState` event with cause='operationComplete'.
   *
   * Called by {@link GitOperation.onSuccess} (template-method hook) for all
   * user-initiated operations symmetrically — no subclass overload required.
   */
  async notifyOperationComplete(
    projectId: string,
    featureName: string | undefined,
    snapshot: GitSnapshot,
    operation: GitOperationState,
    pat: GitPatState,
    userContext?: UserContext
  ): Promise<void> {
    const payload: GitStateEventData = {
      cause: 'operationComplete',
      project: projectId,
      feature: featureName,
      timestamp: new Date().toISOString(),
      snapshot,
      operation,
      pat,
    };
    await this.publishGitState(projectId, featureName ?? '', payload, userContext);
  }

  /**
   * Publish a full-snapshot `gitState` event with cause='reconnectRefill'.
   *
   * Called by the realtime server when a user channel subscription (re)opens,
   * guaranteeing the browser never shows stale UI on reload/network blip.
   */
  async notifyReconnectRefill(
    projectId: string,
    featureName: string | undefined,
    snapshot: GitSnapshot,
    pat: GitPatState,
    userContext?: UserContext
  ): Promise<void> {
    const payload: GitStateEventData = {
      cause: 'reconnectRefill',
      project: projectId,
      feature: featureName,
      timestamp: new Date().toISOString(),
      snapshot,
      pat,
    };
    await this.publishGitState(projectId, featureName ?? '', payload, userContext);
  }

  private async publishGitState(
    projectId: string,
    featureName: string,
    data: GitStateEventData,
    userContext?: UserContext
  ): Promise<void> {
    const ctx = userContext || this.userContext;
    if (!ctx?.organizationId || !ctx?.userId) {
      return;
    }

    const channel = getRealtimeBroadcastChannel(ctx.organizationId, ctx.userId);

    const message = {
      projectId,
      featureName,
      userContext: ctx,
      type: 'gitState' as const,
      data,
    };

    const exec = (async () => {
      try {
        await this.publisher(channel, message);
      } catch (error: any) {
        console.warn(
          `[GitStateBroadcaster] Failed to publish gitState (${data.cause}):`,
          error?.message ?? error
        );
      }
    })();
    this.inflight.track(exec);
    return exec;
  }

  /**
   * Close the owned Redis connection (if any). When a shared
   * publisher is used (StateStorePort-backed), this is a no-op —
   * the owner is responsible for lifecycle.
   *
   * Flushes in-flight publishes first so a co-emitted gitState event
   * (from FileTreeBroadcaster) finishes landing on Redis before the
   * connection is closed.
   */
  async close(): Promise<void> {
    await this.inflight.flush();
    if (this.ownedRedis) {
      try {
        await this.ownedRedis.quit();
      } catch {
        // ignore — already closed or never connected
      }
    }
  }
}
