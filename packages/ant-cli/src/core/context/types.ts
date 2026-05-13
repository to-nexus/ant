/**
 * Context Management — shared types and helpers.
 *
 * All context-related modules (compactTurns, pruneTurns, compactRun,
 * compactJob, retentionPolicy) import from this file.
 */

import type { MessageContentBlock } from '../ports/llm';

// ─── Core Types ───

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | MessageContentBlock[];
}

export interface HistoryPruneConfig {
  maxTokens: number;
  minTurnsToKeep: number;
  prioritizeErrors: boolean;
  prioritizeSetup: boolean;
}

export interface CompactionResult<T> {
  entries: T[];
  summary?: string;
  wasCompacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
  /** Token usage consumed by the LLM summarization call (undefined when not compacted) */
  tokenUsage?: import('@ant/shared').TaskTokenUsage;
}

export interface CompactionConfig {
  threshold: number;
  recentWindowSize: number;
  maxOutputTokens: number;
}

// ─── Shared Helpers ───

/**
 * Group a flat message array into turns. Each turn starts with an assistant
 * message and includes subsequent user messages (tool_result).
 */
export function groupMessagesIntoTurns(history: ConversationMessage[]): ConversationMessage[][] {
  const turns: ConversationMessage[][] = [];
  let currentTurn: ConversationMessage[] = [];

  for (const msg of history) {
    if (msg.role === 'assistant') {
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [msg];
    } else {
      currentTurn.push(msg);
    }
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }
  return turns;
}

/**
 * Detect error content in a tool_result string.
 */
export function isErrorContent(content: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return lower.startsWith('error:') ||
    lower.includes('❌ command failed') ||
    lower.includes('exit code: 1') ||
    lower.includes('exited with error') ||
    (lower.includes('error') && lower.includes('failed'));
}
