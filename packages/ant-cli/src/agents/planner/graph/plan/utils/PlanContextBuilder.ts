/**
 * PlanContextBuilder
 *
 * Sliding-window compression for Plan conversation history.
 * Analogous to SessionContextBuilder (architect) but operates on
 * ConversationEntry[] instead of SessionTurn[].
 *
 * - Entries within the window are kept verbatim (recent context).
 * - Entries outside the window are individually truncated into a summary string.
 * - No LLM call — purely rule-based truncation.
 */

import { ConversationEntry } from '../../../../../core/types/session';

const DEFAULT_WINDOW_SIZE = 6;
const SUMMARY_TRUNCATE_LENGTH = 150;

export interface CompressedConversation {
  /** Entries within the window — passed to the prompt as-is */
  recentEntries: ConversationEntry[];
  /** Truncated summary of entries before the window (undefined when no compression needed) */
  summary?: string;
  /** Original conversation length */
  totalEntries: number;
  /** Effective window size used */
  windowSize: number;
}

/**
 * Compress a plan conversation using a sliding window.
 *
 * @param conversation  Full conversation entries (typically conversation.slice(0, -1) — last user msg excluded)
 * @param windowSize    Number of recent entries to keep in detail (default 6)
 */
export function buildPlanContext(
  conversation: ConversationEntry[],
  windowSize: number = DEFAULT_WINDOW_SIZE,
): CompressedConversation {
  const total = conversation.length;

  if (total <= windowSize) {
    return {
      recentEntries: conversation,
      totalEntries: total,
      windowSize,
    };
  }

  const recentEntries = conversation.slice(-windowSize);
  const earlierEntries = conversation.slice(0, -windowSize);
  const summary = summarizeEntries(earlierEntries);

  return {
    recentEntries,
    summary: summary || undefined,
    totalEntries: total,
    windowSize,
  };
}

/**
 * Summarize conversation entries into a compact text block.
 * Each entry becomes one line; empty content is skipped.
 */
function summarizeEntries(entries: ConversationEntry[]): string {
  return entries
    .filter(e => e.content)
    .map(e => `- ${e.role === 'user' ? 'User' : 'Assistant'}: ${truncate(e.content, SUMMARY_TRUNCATE_LENGTH)}`)
    .join('\n');
}

function truncate(text: string, maxLength: number): string {
  // Normalise whitespace for summary compactness
  const normalised = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalised.length <= maxLength) return normalised;
  return normalised.substring(0, maxLength) + '...';
}
