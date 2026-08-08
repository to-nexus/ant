/**
 * Desktop Pairing Nonce SSOT
 *
 * Ant Desktop cannot tell, from an `ant-desktop://connect` link alone, whether
 * the user started the connection or some page did — the custom scheme is open
 * to any origin. So Desktop mints a one-shot nonce, opens this web app with it
 * as `?desktop_pair=<nonce>`, and we echo it back on the deep link. Desktop
 * applies a link that redeems a live nonce without prompting, and falls back to
 * an explicit approval prompt for a link that carries none.
 *
 * The nonce is stored in `sessionStorage`, so it belongs to the tab Desktop
 * opened. Connecting from a different tab simply has no nonce and lands on the
 * approval prompt — a degradation, not a failure.
 *
 * Mirrors the read-then-strip shape of `onboardingRouter.ts`: the URL flag is a
 * one-time delivery channel, not state, so it is removed after capture.
 */

const PAIRING_QUERY_KEY = 'desktop_pair';
const PAIRING_STORAGE_KEY = 'ant:desktopPairingNonce';

/**
 * Read `?desktop_pair=...` if Desktop opened this page, persist it for the tab,
 * and strip it from the URL. Safe to call on every mount — a page without the
 * flag leaves any previously captured nonce alone.
 */
export function capturePairingStateFromUrl(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  const nonce = url.searchParams.get(PAIRING_QUERY_KEY);
  if (!nonce) return;

  try {
    window.sessionStorage.setItem(PAIRING_STORAGE_KEY, nonce);
  } catch {
    // Private-mode / disabled storage — the deep link just takes the prompt path.
  }

  url.searchParams.delete(PAIRING_QUERY_KEY);
  window.history.replaceState({}, '', url.toString());
}

/** The nonce for this tab, or `null` when Desktop did not start the flow. */
export function readPairingState(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(PAIRING_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Build the `ant-desktop://connect` URI.
 *
 * `state` is appended only when a nonce exists: with one, Desktop knows the
 * user began this flow there and connects without prompting; without one the
 * link still works and is approved explicitly. That is what keeps the
 * pre-existing web-initiated flow (and older Desktop builds) working.
 */
export function buildDesktopDeepLink(
  token: string,
  serverUrl: string,
  pairingState: string | null,
): string {
  const params = [
    `token=${encodeURIComponent(token)}`,
    `server=${encodeURIComponent(serverUrl)}`,
  ];
  if (pairingState) {
    params.push(`state=${encodeURIComponent(pairingState)}`);
  }
  return `ant-desktop://connect?${params.join('&')}`;
}
