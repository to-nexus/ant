/**
 * `@ant/auth-client.runUnifiedLogout` — the 5-step procedure both ant-site
 * and ant-ui follow.
 *
 * Order is load-bearing:
 *   1. POST /auth/signout
 *   2. clearLocalState()       ← runs even when step 1 fails
 *   3. broadcaster.post(logout) ← other tabs react
 *   4. navigate(destination)   ← THE missing step in pre-fix ant-site (the bug)
 *   5. on signout failure: showSignoutFailureToast() before step 4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runUnifiedLogout } from '@ant/auth-client';

const API_BASE = 'http://example.test/api';

function makeBroadcaster() {
  const posts: any[] = [];
  return {
    posts,
    broadcaster: {
      post: vi.fn((msg: any) => posts.push(msg)),
      subscribe: vi.fn(() => () => undefined),
      close: vi.fn(),
    },
  };
}

describe('runUnifiedLogout — 5-step procedure', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('happy path: API → clearLocalState → broadcast logout → navigate', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toMatch(/\/auth\/signout$/);
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      calls.push('fetch');
      return new Response('{}', { status: 200 });
    }) as any;

    const { broadcaster, posts } = makeBroadcaster();
    const navigate = vi.fn();
    const clearLocalState = vi.fn(() => calls.push('clearLocalState'));
    const broadcasterSpy = (msg: any) => calls.push(`broadcast:${msg.type}`);
    broadcaster.post.mockImplementation((msg: any) => {
      broadcasterSpy(msg);
      posts.push(msg);
    });
    navigate.mockImplementation(() => calls.push('navigate'));

    await runUnifiedLogout({
      apiBase: API_BASE,
      destination: '/',
      broadcaster,
      clearLocalState,
      navigate,
    });

    expect(calls).toEqual([
      'fetch',
      'clearLocalState',
      'broadcast:logout',
      'navigate',
    ]);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(posts[0]).toMatchObject({ type: 'logout' });
  });

  it('signout API failure: still cleans up, broadcasts, toasts, and navigates', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as any;

    const { broadcaster } = makeBroadcaster();
    const navigate = vi.fn();
    const clearLocalState = vi.fn();
    const showSignoutFailureToast = vi.fn();

    await runUnifiedLogout({
      apiBase: API_BASE,
      destination: '/welcome',
      broadcaster,
      clearLocalState,
      showSignoutFailureToast,
      navigate,
    });

    expect(clearLocalState).toHaveBeenCalledTimes(1);
    expect(broadcaster.post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'logout' }),
    );
    expect(showSignoutFailureToast).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/welcome');
  });

  it('signout 4xx: also fires failure toast', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('forbidden', { status: 403 }),
    ) as any;

    const { broadcaster } = makeBroadcaster();
    const navigate = vi.fn();
    const showSignoutFailureToast = vi.fn();

    await runUnifiedLogout({
      apiBase: API_BASE,
      destination: '/',
      broadcaster,
      clearLocalState: () => undefined,
      showSignoutFailureToast,
      navigate,
    });

    expect(showSignoutFailureToast).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('clearLocalState throwing does NOT block broadcast or navigation', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as any;
    const { broadcaster } = makeBroadcaster();
    const navigate = vi.fn();

    await runUnifiedLogout({
      apiBase: API_BASE,
      destination: '/',
      broadcaster,
      clearLocalState: () => {
        throw new Error('boom');
      },
      navigate,
    });

    expect(broadcaster.post).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
