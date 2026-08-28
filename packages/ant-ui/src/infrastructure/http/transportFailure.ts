/**
 * Transport-failure channel.
 *
 * A request that dies before a readable response exists (server down, DNS,
 * TLS reset, or an edge — WAF / ALB — answering without CORS headers) reaches
 * the browser only as `TypeError: Failed to fetch`. The FE already owns that
 * condition in `useServerDownDetector`, but its only entry points were the SSE
 * error callback and `connectionStatus`, so a failed user REQUEST never got
 * there and the call site printed the raw browser string instead.
 *
 * This is the request-side entry point. Same shape as
 * `sseManager.setOnErrorCallback`; a separate module so `client.ts` does not
 * import the hook (cycle).
 */

let onTransportFailure: ((url: string) => void) | null = null;

export function setOnTransportFailure(cb: ((url: string) => void) | null): void {
  onTransportFailure = cb;
}

export function notifyTransportFailure(url: string): void {
  try {
    onTransportFailure?.(url);
  } catch (err) {
    console.error('[Transport] failure notification threw', err);
  }
}
