/**
 * Process-wide ChatLogAppender registry.
 *
 * The worker child process runs a single LangGraph invocation per job, so
 * a singleton ChatLogAppender fits the lifecycle cleanly.
 *
 * Wiring:
 * - Orchestrator initialises the appender once per job after `recordUserTurn`
 *   returns (turnId is known then).
 * - LLMEventHandler / CommandExecutionHandler / LLMResponseService /
 *   ChatStatusHandler pull the current appender via
 *   `getChatLogAppender()` at emit time. No explicit dependency injection
 *   is needed — each handler only touches chat.jsonl as a side-effect on
 *   top of its primary responsibility.
 *
 * The registry holds `null` outside of a job invocation (e.g. during
 * server startup or tests), so every read is guarded.
 */

import type { ChatLogAppender } from './ChatLogAppender';

let currentAppender: ChatLogAppender | null = null;

export function setChatLogAppender(appender: ChatLogAppender | null): void {
  currentAppender = appender;
}

export function getChatLogAppender(): ChatLogAppender | null {
  return currentAppender;
}

export function clearChatLogAppender(): void {
  currentAppender = null;
}
