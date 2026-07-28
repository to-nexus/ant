/**
 * Shared undici dispatcher for LLM SDK clients — transport-level liveness SSOT.
 *
 * Liveness is decided at the BYTE layer, not the parsed-event layer: both SDKs
 * swallow provider keepalives before consumers can see them (Anthropic `ping`
 * events are `continue`d in the SDK's SSE parser; OpenAI-compat `:` comment
 * lines return null), so undici's bodyTimeout is the ONLY timer that provider
 * keepalives reset. A stream that keeps bytes flowing (pings, comments, deltas)
 * is a working provider and is waited on indefinitely at this layer; a stream
 * with a genuine byte gap is a dead transport and errors out
 * (UND_ERR_BODY_TIMEOUT / UND_ERR_HEADERS_TIMEOUT → retryable, see
 * retry.ts isRetryableError cause-chain walk).
 *
 * Watchdog hierarchy (sandy-loading-coral 2nd RCA):
 *   transport (headers 180s / body 300s, bytes)
 *     < parsed-event backstop (600s, semantic — resolveStreamIdleMs)
 *     < orchestrator stall watchdog (15m warn / 50m sever, usage heartbeat).
 *
 * Single shared Agent — per-client agents would defeat connection pooling.
 */

import { Agent } from 'undici';

let agent: Agent | null = null;

export function getLLMDispatcher(): Agent {
  if (!agent) {
    agent = new Agent({
      // TCP keepalive probes detect a dead peer (Mac sleep / network
      // partition — the class the parsed-event watchdog was originally
      // built for) at the OS layer.
      connect: { keepAlive: true, keepAliveInitialDelay: 30_000 },
      // No response headers for 3min = gateway is gone (SSE endpoints send
      // headers immediately on accept).
      headersTimeout: 180_000,
      // Max gap between BODY BYTES. Provider keepalives reset this — a
      // silently-working model behind keepalives waits forever here.
      bodyTimeout: 300_000,
    });
  }
  return agent;
}
