/**
 * Process-wide TraceAppender registry.
 *
 * The worker child process runs a single LangGraph invocation per job, so a
 * singleton TraceAppender fits the lifecycle cleanly.
 *
 * Wiring:
 * - Orchestrator initialises the appender once per job after `recordUserTurn`
 *   returns (turnId is known then).
 * - LLMEventHandler / CommandExecutionHandler / LLMResponseService pull the
 *   current appender via `getTraceAppender()` at emit time. No explicit
 *   dependency injection is needed — each handler only touches trace.jsonl
 *   as a side-effect on top of its primary responsibility.
 *
 * The registry holds `null` outside of a job invocation (e.g. during server
 * startup or tests), so every read is guarded.
 */

import type { TraceAppender } from './TraceAppender';

let currentAppender: TraceAppender | null = null;

export function setTraceAppender(appender: TraceAppender | null): void {
  currentAppender = appender;
}

export function getTraceAppender(): TraceAppender | null {
  return currentAppender;
}

export function clearTraceAppender(): void {
  currentAppender = null;
}
