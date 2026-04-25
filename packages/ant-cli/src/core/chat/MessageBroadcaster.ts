/**
 * MessageBroadcaster - Publishes chat SSE events via Redis Pub/Sub.
 *
 * The chat SSOT is `chat.jsonl` (finalized events) + Redis TURN_BUFFER
 * (in-flight streaming). Every chat event broadcast happens through this
 * class, using the unified event union declared in
 * `@ant/shared/chat-events`.
 *
 * Cloud-safe: publishes to user-scoped channels; the Realtime server
 * relays to the client's SSE connection.
 */

import type {
  ChatLine,
  ChatSseEvent,
  PendingCardSnapshot,
  TurnBufferSnapshotMap,
} from '@ant/shared';
import type { StateStorePort } from '../ports/stateStore';
import type { UserContext } from '../types/user';
import { logger } from '../../utils/logger';
import { getRealtimeBroadcastChannel } from '../constants/redis';

/**
 * Envelope placed on the Redis Pub/Sub realtime channel. The Realtime
 * server decodes the envelope and forwards `data` to any SSE connection
 * whose `(projectId, featureName)` matches.
 */
export interface ChatBroadcastEnvelope {
  projectId: string;
  featureName: string;
  type: 'chat';
  data: ChatSseEvent;
  userContext: UserContext;
}

export class MessageBroadcaster {
  private pendingPublishes = new Set<Promise<void>>();

  constructor(private stateStore?: StateStorePort) {}

  // ═══════════════════════════════════════════════════════════════════════
  // Chat event publishers — ONE per SSE event type.
  // ═══════════════════════════════════════════════════════════════════════

  /** Append a finalized ChatLine to the client stream. */
  broadcastChatLine(
    projectId: string,
    featureName: string,
    event: ChatLine,
    userContext: UserContext | undefined,
    producedAt: string = new Date().toISOString(),
  ): void {
    this.publish(projectId, featureName, {
      type: 'chat_event_appended',
      event,
      producedAt,
      projectId,
      featureName,
    }, userContext);
  }

  /** Forward an in-flight streaming chunk (text / thinking / card_output). */
  broadcastStreamingDelta(
    projectId: string,
    featureName: string,
    payload: {
      turnId: string;
      workerScope?: string;
      kind: 'text' | 'thinking' | 'card_output';
      cardId?: string;
      chunk: string;
    },
    userContext: UserContext | undefined,
    producedAt: string = new Date().toISOString(),
  ): void {
    this.publish(projectId, featureName, {
      type: 'streaming_delta',
      ...payload,
      producedAt,
      projectId,
      featureName,
    }, userContext);
  }

  /**
   * Emit a single `(turnId, workerScope)` buffer snapshot. Used by the
   * worker in response to a sync_request so a reconnecting client can
   * recover the in-flight partial state.
   */
  broadcastStreamingBufferSnapshot(
    projectId: string,
    featureName: string,
    payload: {
      turnId: string;
      workerScope?: string;
      text?: string;
      thinking?: string;
      pendingCards?: Record<string, PendingCardSnapshot>;
    },
    userContext: UserContext | undefined,
    producedAt: string = new Date().toISOString(),
  ): void {
    this.publish(projectId, featureName, {
      type: 'streaming_buffer_snapshot',
      ...payload,
      producedAt,
      projectId,
      featureName,
    }, userContext);
  }

  /** Signal that a Chat Clear / Hard Reset just happened. */
  broadcastEventsCleared(
    projectId: string,
    featureName: string,
    scope: 'chat' | 'full',
    userContext: UserContext | undefined,
    serverTs: string = new Date().toISOString(),
  ): void {
    this.publish(projectId, featureName, {
      type: 'events_cleared',
      scope,
      serverTs,
      projectId,
      featureName,
    }, userContext);
  }

  /**
   * Emit the full `chat_initial_state` payload. Used by
   * `sse.routes.ts` on SSE open/reconnect so the client hydrates its
   * chatEvents + streamingBuffers in one hop.
   */
  broadcastInitialState(
    projectId: string,
    featureName: string,
    events: ChatLine[],
    turnBuffers: TurnBufferSnapshotMap,
    userContext: UserContext | undefined,
    serverTs: string = new Date().toISOString(),
  ): void {
    this.publish(projectId, featureName, {
      type: 'chat_initial_state',
      events,
      turnBuffers,
      serverTs,
      projectId,
      featureName,
    }, userContext);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  /** Wait for all pending publishes to complete (or timeout). */
  async drain(timeoutMs = 2000): Promise<void> {
    if (this.pendingPublishes.size === 0) return;
    await Promise.race([
      Promise.all(this.pendingPublishes),
      new Promise<void>(r => setTimeout(r, timeoutMs)),
    ]);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════════════════════════════════════

  private publish(
    projectId: string,
    featureName: string,
    data: ChatSseEvent,
    userContext: UserContext | undefined,
  ): void {
    if (!this.stateStore) {
      logger.warn('MessageBroadcaster: no stateStore configured — dropping broadcast', {
        component: 'MessageBroadcaster',
        projectId,
        featureName,
      });
      return;
    }
    if (!userContext?.organizationId || !userContext?.userId) {
      logger.warn('MessageBroadcaster: missing userContext — dropping broadcast', {
        component: 'MessageBroadcaster',
        projectId,
        featureName,
      });
      return;
    }
    const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
    const envelope = {
      projectId,
      featureName,
      type: 'chat' as const,
      data,
      userContext,
    };
    const p = this.stateStore.publish(channel, envelope)
      .catch((error) => {
        logger.error(`Failed to publish chat event to ${channel}`, {
          component: 'MessageBroadcaster',
          projectId,
          featureName,
        }, error);
      })
      .finally(() => { this.pendingPublishes.delete(p); });
    this.pendingPublishes.add(p);
  }
}

