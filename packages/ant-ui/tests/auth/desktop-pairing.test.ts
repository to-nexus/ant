/**
 * Desktop pairing nonce — `application/auth/desktopPairing`.
 *
 * The nonce is what lets Ant Desktop distinguish "the user started this
 * connection here" from "a web page fired the `ant-desktop://connect` scheme".
 * Two contracts are load-bearing and tested here:
 *
 *  1. Capture is one-way delivery: the nonce moves from the URL into
 *     sessionStorage and the query flag is stripped, so a shared/bookmarked URL
 *     does not carry a redeemable nonce around.
 *  2. A missing nonce still produces a working deep link. Desktop falls back to
 *     an explicit approval prompt, so the pre-existing web-initiated flow (and
 *     Desktop builds that predate pairing) must not break.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  capturePairingStateFromUrl,
  readPairingState,
  buildDesktopDeepLink,
} from '@/application/auth/desktopPairing';

// The suite runs in vitest's `node` environment — no jsdom — so stand up the
// three window surfaces the module touches.
function stubWindow(href: string) {
  const store = new Map<string, string>();
  const replaceState = vi.fn((_s: unknown, _t: string, url: string) => {
    (globalThis as any).window.location.href = url;
  });
  (globalThis as any).window = {
    location: { href },
    history: { replaceState },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  return { replaceState, store };
}

describe('capturePairingStateFromUrl', () => {
  beforeEach(() => {
    delete (globalThis as any).window;
  });

  it('moves the nonce into session storage and strips the query flag', () => {
    const { replaceState } = stubWindow(
      'https://ant.crosstoken.io/app?desktop_pair=nonce-abc',
    );

    capturePairingStateFromUrl();

    expect(readPairingState()).toBe('nonce-abc');
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect((globalThis as any).window.location.href).not.toContain(
      'desktop_pair',
    );
  });

  it('preserves other query params while stripping the flag', () => {
    stubWindow(
      'https://ant.crosstoken.io/app?auth=success&desktop_pair=nonce-abc',
    );

    capturePairingStateFromUrl();

    const href = (globalThis as any).window.location.href;
    expect(href).toContain('auth=success');
    expect(href).not.toContain('desktop_pair');
  });

  it('is a no-op without the flag — it must not clobber a captured nonce', () => {
    const { replaceState, store } = stubWindow(
      'https://ant.crosstoken.io/app?desktop_pair=nonce-abc',
    );
    capturePairingStateFromUrl();
    replaceState.mockClear();

    (globalThis as any).window.location.href =
      'https://ant.crosstoken.io/app?auth=success';
    capturePairingStateFromUrl();

    expect(readPairingState()).toBe('nonce-abc');
    expect(replaceState).not.toHaveBeenCalled();
    expect(store.size).toBe(1);
  });

  it('survives storage being unavailable', () => {
    stubWindow('https://ant.crosstoken.io/app?desktop_pair=nonce-abc');
    (globalThis as any).window.sessionStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };

    expect(() => capturePairingStateFromUrl()).not.toThrow();
    expect(readPairingState()).toBeNull();
  });

  it('returns null off-window (SSR / no DOM)', () => {
    expect(readPairingState()).toBeNull();
    expect(() => capturePairingStateFromUrl()).not.toThrow();
  });
});

describe('buildDesktopDeepLink', () => {
  it('appends state only when a nonce is present', () => {
    const paired = buildDesktopDeepLink(
      'jwt-1',
      'https://ant.crosstoken.io',
      'nonce-abc',
    );
    expect(paired).toContain('state=nonce-abc');

    const unpaired = buildDesktopDeepLink(
      'jwt-1',
      'https://ant.crosstoken.io',
      null,
    );
    expect(unpaired).not.toContain('state=');
    expect(unpaired).toBe(
      'ant-desktop://connect?token=jwt-1&server=https%3A%2F%2Fant.crosstoken.io',
    );
  });

  it('encodes every value it interpolates', () => {
    const link = buildDesktopDeepLink(
      'jwt&injected=1',
      'http://127.0.0.1:4101',
      'nonce/with?chars',
    );
    expect(link).toContain('token=jwt%26injected%3D1');
    expect(link).toContain('server=http%3A%2F%2F127.0.0.1%3A4101');
    expect(link).toContain('state=nonce%2Fwith%3Fchars');
  });
});
