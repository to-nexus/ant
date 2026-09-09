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

/**
 * What the mint knows about the request that died. The consumer's verdict must
 * not outrun this: `hasBody === false` rules out a content-based refusal
 * outright, because there was no content to inspect.
 */
export interface TransportFailureInfo {
  method: string;
  hasBody: boolean;
}

type TransportFailureHandler = (url: string, info: TransportFailureInfo) => void;

let onTransportFailure: TransportFailureHandler | null = null;

export function setOnTransportFailure(cb: TransportFailureHandler | null): void {
  onTransportFailure = cb;
}

export function notifyTransportFailure(url: string, info: TransportFailureInfo): void {
  try {
    onTransportFailure?.(url, info);
  } catch (err) {
    console.error('[Transport] failure notification threw', err);
  }
}
