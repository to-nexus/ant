/**
 * Phase 2.2 regression — cross-process preview cleanup pub/sub.
 *
 * `ProjectService.deleteProject` cannot call PreviewService directly because
 * preview lives in a separate process (`ant-preview`). The publisher/ack
 * handshake here ensures:
 *   - publisher waits for an `ack` matching its requestId
 *   - mismatched requestId is ignored
 *   - subscriber error is propagated back to publisher
 *   - timeout rejects when no ack arrives (e.g. preview not running in dev)
 */

import { describe, it, expect } from 'vitest';
import { requestPreviewCleanup } from '../../src/periphery/adapters/http/services/ProjectService/previewCleanup';
import { REDIS_KEYS } from '../../src/core/constants/redis';
import type { StateStorePort } from '../../src/core/ports/stateStore';
import type { UserContext } from '../../src/core/types/user';

/** In-memory pub/sub stub honoring the StateStorePort.subscribe/publish surface. */
function makeStubStateStore(): {
  store: StateStorePort;
  subscribers: Map<string, Set<(msg: any) => void>>;
} {
  const subscribers = new Map<string, Set<(msg: any) => void>>();
  const store = {
    publish: async (channel: string, message: unknown) => {
      const subs = subscribers.get(channel);
      if (!subs) return;
      for (const cb of Array.from(subs)) {
        // schedule asynchronously to mirror real Redis pub/sub delivery
        setImmediate(() => cb(message));
      }
    },
    subscribe: async (channel: string, callback: (msg: any) => void) => {
      let set = subscribers.get(channel);
      if (!set) {
        set = new Set();
        subscribers.set(channel, set);
      }
      set.add(callback);
      return () => {
        set!.delete(callback);
      };
    },
  } as unknown as StateStorePort;
  return { store, subscribers };
}

const userContext: UserContext = { userId: 'user', organizationId: 'org', email: 'u@example.com' } as any;

describe('requestPreviewCleanup', () => {
  it('resolves when the matching ack arrives', async () => {
    const { store } = makeStubStateStore();

    // Subscriber side: ack any incoming request with success=true.
    await store.subscribe(REDIS_KEYS.LIFECYCLE.CLEANUP_REQUEST, (msg: any) => {
      void store.publish(REDIS_KEYS.LIFECYCLE.CLEANUP_ACK, {
        requestId: msg.requestId,
        source: 'preview',
        success: true,
      });
    });

    await expect(
      requestPreviewCleanup(store, 'project', userContext, 'proj1'),
    ).resolves.toBeUndefined();
  });

  it('rejects when the subscriber acks with success=false', async () => {
    const { store } = makeStubStateStore();
    await store.subscribe(REDIS_KEYS.LIFECYCLE.CLEANUP_REQUEST, (msg: any) => {
      void store.publish(REDIS_KEYS.LIFECYCLE.CLEANUP_ACK, {
        requestId: msg.requestId,
        source: 'preview',
        success: false,
        error: 'preview crashed mid-cleanup',
      });
    });

    await expect(
      requestPreviewCleanup(store, 'project', userContext, 'proj1'),
    ).rejects.toThrow(/preview crashed/);
  });

  it('rejects with a timeout when no subscriber acks (e.g. dev without ant-preview)', async () => {
    const { store } = makeStubStateStore();
    await expect(
      requestPreviewCleanup(store, 'project', userContext, 'proj1', undefined, 200),
    ).rejects.toThrow(/timeout/);
  });

  it('ignores ack messages with mismatched requestId', async () => {
    const { store } = makeStubStateStore();
    let receivedRequestId: string | undefined;
    await store.subscribe(REDIS_KEYS.LIFECYCLE.CLEANUP_REQUEST, (msg: any) => {
      receivedRequestId = msg.requestId;
      // First publish a foreign ack (should be ignored), then the real one.
      void store.publish(REDIS_KEYS.LIFECYCLE.CLEANUP_ACK, {
        requestId: 'unrelated-id',
        source: 'preview',
        success: true,
      });
      setTimeout(() => {
        void store.publish(REDIS_KEYS.LIFECYCLE.CLEANUP_ACK, {
          requestId: msg.requestId,
          source: 'preview',
          success: true,
        });
      }, 20);
    });

    await expect(
      requestPreviewCleanup(store, 'project', userContext, 'proj1', undefined, 1000),
    ).resolves.toBeUndefined();
    expect(receivedRequestId).toBeTruthy();
  });
});
