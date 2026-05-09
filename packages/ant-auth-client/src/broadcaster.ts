import { AUTH_BROADCAST_CHANNEL, type AuthBroadcastMessage } from './types';

export interface AuthBroadcaster {
  /** Post a message to other tabs. Self-tab does NOT receive its own post. */
  post(message: AuthBroadcastMessage): void;
  /** Subscribe to messages from other tabs. Returns unsubscribe fn. */
  subscribe(handler: (message: AuthBroadcastMessage) => void): () => void;
  /** Tear down channel + listeners. */
  close(): void;
}

const STORAGE_FALLBACK_KEY = 'ant:auth:broadcast';

function isAuthMessage(value: unknown): value is AuthBroadcastMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<AuthBroadcastMessage>;
  return (
    (v.type === 'logout' || v.type === 'session-expired') &&
    typeof v.at === 'number'
  );
}

/**
 * Cross-tab auth bus. Uses BroadcastChannel where available; falls back to
 * localStorage `storage` events for Safari ITP / older runtimes.
 *
 * Self-tab does not receive its own posts (matches BroadcastChannel semantics
 * and avoids broadcast loops in the unified logout procedure — the dispatching
 * tab already runs cleanup directly).
 */
export function createAuthBroadcaster(): AuthBroadcaster {
  if (typeof window === 'undefined') {
    return {
      post: () => undefined,
      subscribe: () => () => undefined,
      close: () => undefined,
    };
  }

  const handlers = new Set<(message: AuthBroadcastMessage) => void>();

  const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
  let channel: BroadcastChannel | null = null;

  const onChannelMessage = (event: MessageEvent) => {
    if (isAuthMessage(event.data)) {
      handlers.forEach((h) => {
        try {
          h(event.data);
        } catch (err) {
          console.error('[Auth] broadcaster handler threw', err);
        }
      });
    }
  };

  const onStorageEvent = (event: StorageEvent) => {
    if (event.key !== STORAGE_FALLBACK_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue);
      if (isAuthMessage(parsed)) {
        handlers.forEach((h) => {
          try {
            h(parsed);
          } catch (err) {
            console.error('[Auth] broadcaster handler threw', err);
          }
        });
      }
    } catch {
      // ignore malformed JSON
    }
  };

  if (hasBroadcastChannel) {
    channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    channel.addEventListener('message', onChannelMessage);
  } else {
    window.addEventListener('storage', onStorageEvent);
  }

  return {
    post(message) {
      if (channel) {
        try {
          channel.postMessage(message);
        } catch (err) {
          console.error('[Auth] broadcast post failed', err);
        }
        return;
      }
      try {
        const payload = JSON.stringify(message);
        // write-then-remove pattern so the same value re-fires for repeats
        window.localStorage.setItem(STORAGE_FALLBACK_KEY, payload);
        window.localStorage.removeItem(STORAGE_FALLBACK_KEY);
      } catch (err) {
        console.error('[Auth] broadcast storage-fallback failed', err);
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      handlers.clear();
      if (channel) {
        channel.removeEventListener('message', onChannelMessage);
        try {
          channel.close();
        } catch {
          /* ignore */
        }
        channel = null;
      } else {
        window.removeEventListener('storage', onStorageEvent);
      }
    },
  };
}
