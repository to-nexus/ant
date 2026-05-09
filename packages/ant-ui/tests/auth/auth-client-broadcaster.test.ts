/**
 * `@ant/auth-client.createAuthBroadcaster` — cross-tab logout / session-expired.
 *
 * The browser does NOT deliver self-tab broadcasts (BroadcastChannel
 * semantics) — this is intentional, so the dispatching tab's clearUser
 * cascade doesn't double-fire via its own subscriber.
 *
 * Note: we don't unit-test cross-instance delivery here because Node's
 * BroadcastChannel only crosses Worker boundaries, not in-context instances
 * the way real browsers do. Cross-tab delivery is verified by the manual
 * scenarios in the plan (open two browser tabs, log out in one).
 */

import { describe, it, expect } from 'vitest';
import { createAuthBroadcaster } from '@ant/auth-client';

describe('createAuthBroadcaster', () => {
  it('self-tab subscriber does NOT receive its own posts', async () => {
    const broadcaster = createAuthBroadcaster();
    const messages: any[] = [];
    broadcaster.subscribe((m) => messages.push(m));

    broadcaster.post({ type: 'session-expired', at: 456 });
    await new Promise((r) => setTimeout(r, 0));

    expect(messages).toEqual([]);
    broadcaster.close();
  });

  it('post() does not throw and is safe to call multiple times', () => {
    const broadcaster = createAuthBroadcaster();
    expect(() => {
      broadcaster.post({ type: 'logout', at: 1 });
      broadcaster.post({ type: 'session-expired', at: 2 });
    }).not.toThrow();
    broadcaster.close();
  });

  it('subscribe returns an unsubscribe function (referentially distinct per call)', () => {
    const broadcaster = createAuthBroadcaster();
    const u1 = broadcaster.subscribe(() => undefined);
    const u2 = broadcaster.subscribe(() => undefined);
    expect(typeof u1).toBe('function');
    expect(typeof u2).toBe('function');
    expect(u1).not.toBe(u2);
    u1();
    u2();
    broadcaster.close();
  });

  it('close() is idempotent', () => {
    const broadcaster = createAuthBroadcaster();
    expect(() => {
      broadcaster.close();
      broadcaster.close();
    }).not.toThrow();
  });
});
