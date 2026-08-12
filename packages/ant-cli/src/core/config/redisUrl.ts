/**
 * Redis-URL SSOT for server-process boot.
 *
 * Local mode defaults to the `pnpm dev:infra:redis` port so a fresh clone
 * boots with zero env; cloud mode keeps the fail-fast throw — a silent
 * localhost fallback in a cloud pod would turn a missing-env misconfiguration
 * into an opaque connection error. Redis itself stays mandatory on a single
 * code path in both modes (AGENTS.md "Unified Distributed System Principle").
 *
 * Only long-lived process boots (api / realtime / preview / job-worker /
 * ChoiceService) may call this. Job-runner children receive ANT_REDIS_URL
 * explicitly via JobWorker env injection, and the orchestrator plane keeps
 * treating an *unset* env as "realtime disabled" (verification-runner
 * contract) — never default through `process.env.ANT_REDIS_URL ??= ...`.
 */

import { isLocalServerMode } from './serverMode';

/** Matches the host port published by the cache-memory docker-compose (16379:6379). */
export const DEFAULT_LOCAL_REDIS_URL = 'redis://localhost:16379';

export function resolveRedisUrl(): string {
  const url = process.env.ANT_REDIS_URL?.trim();
  if (url) return url;
  if (isLocalServerMode()) return DEFAULT_LOCAL_REDIS_URL;
  throw new Error(
    'ANT_REDIS_URL is required in cloud mode (no localhost fallback). Example: ANT_REDIS_URL=redis://redis:6379'
  );
}
