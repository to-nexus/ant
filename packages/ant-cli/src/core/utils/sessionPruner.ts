/**
 * Session Pruner — Token-based sliding window compression for Context Continuity jobs.
 *
 * Replaces hardcoded pruning in Plan (PlanContextBuilder's count-based window)
 * and Visual (`.slice(-10)` truncation) with a unified, configurable utility.
 *
 * Algorithm:
 * 1. Walk entries from newest to oldest, accumulating estimated tokens
 * 2. Include entries until token budget is exhausted (minimum guarantee applied)
 * 3. Remaining older entries are compressed into a one-line-per-entry summary
 * 4. Summary itself is capped at a separate token limit
 */

// ─── Token Budget Constants (TBD: measure system prompts then finalize) ───

/** Budget for Plan's conversationHistory (raw LLM messages, Run-level pruning via compactAndPruneHistory) */
export const PLAN_CONVERSATION_HISTORY_BUDGET = 50_000;

/** Budget for Plan's conversation (ConversationEntry[], Job-level pruning via pruneSession) */
export const PLAN_CONVERSATION_BUDGET = 15_000;

/** Budget for Visual's conversation (ConversationEntry[], Job-level pruning via pruneSession) */
export const VISUAL_CONVERSATION_BUDGET = 8_000;

/** Summary cap for Plan's older conversation entries */
export const PLAN_SUMMARY_CAP = 5_000;

/** Summary cap for Visual's older conversation entries */
export const VISUAL_SUMMARY_CAP = 3_000;

const DEFAULT_MIN_PRESERVE = 2;
const DEFAULT_ENTRY_TRUNCATE = 150;
const CHARS_PER_TOKEN = 2.8;

// ─── Types ───

/** Minimum shape required for pruning. Both ConversationEntry and VisualConversationEntry satisfy this. */
export interface PrunableEntry {
  role: string;
  content: string;
  timestamp: string;
}

export interface PruneConfig {
  /** Token budget for recent entries (entries within window) */
  tokenBudget: number;
  /** Minimum number of recent entries to always preserve regardless of budget */
  minPreserve?: number;
  /** Max tokens for the compressed summary of older entries */
  summaryCap?: number;
  /** Max characters per entry in the summary line */
  entryTruncateLength?: number;
}

export interface PrunedResult<T extends PrunableEntry> {
  /** Recent entries kept in full (within token budget) */
  recentEntries: T[];
  /** Compressed summary of entries outside the window (undefined if none) */
  summary: string | undefined;
  /** Original entry count */
  totalEntries: number;
  /** How many entries are in the recent window */
  windowSize: number;
}

// ─── Core Function ───

/**
 * Prune a conversation entry array using a token-based sliding window.
 *
 * @param entries  Full conversation entries (caller should exclude the latest user message if it goes into the messages array separately)
 * @param config   Pruning configuration
 */
export function pruneSession<T extends PrunableEntry>(
  entries: T[],
  config: PruneConfig,
): PrunedResult<T> {
  const {
    tokenBudget,
    minPreserve = DEFAULT_MIN_PRESERVE,
    summaryCap = Math.floor(tokenBudget / 3),
    entryTruncateLength = DEFAULT_ENTRY_TRUNCATE,
  } = config;

  const total = entries.length;

  if (total === 0) {
    return { recentEntries: [], summary: undefined, totalEntries: 0, windowSize: 0 };
  }

  // Walk from newest to oldest, accumulating tokens
  let accumulatedTokens = 0;
  let windowStart = total; // exclusive index (entries[windowStart..total-1] = recent window)

  for (let i = total - 1; i >= 0; i--) {
    const entryTokens = estimateEntryTokens(entries[i]);
    const wouldExceed = accumulatedTokens + entryTokens > tokenBudget;
    const guaranteedSlot = total - i <= minPreserve;

    if (wouldExceed && !guaranteedSlot) {
      break;
    }

    accumulatedTokens += entryTokens;
    windowStart = i;
  }

  const recentEntries = entries.slice(windowStart);
  const olderEntries = entries.slice(0, windowStart);

  let summary: string | undefined;
  if (olderEntries.length > 0) {
    summary = buildSummary(olderEntries, summaryCap, entryTruncateLength);
  }

  return {
    recentEntries,
    summary,
    totalEntries: total,
    windowSize: recentEntries.length,
  };
}

// ─── Helpers ───

function estimateEntryTokens(entry: PrunableEntry): number {
  if (!entry.content) return 0;
  return Math.ceil(entry.content.length / CHARS_PER_TOKEN);
}

/**
 * Build a compact summary of older entries. Each entry becomes a single line.
 * Total summary is capped at `summaryCap` tokens.
 */
function buildSummary(
  entries: PrunableEntry[],
  summaryCap: number,
  entryTruncateLength: number,
): string {
  const lines: string[] = [];
  let summaryTokens = 0;
  const maxSummaryChars = Math.floor(summaryCap * CHARS_PER_TOKEN);

  for (const entry of entries) {
    const roleLabel = entry.role === 'user' ? 'User' : entry.role === 'assistant' ? 'Assistant' : 'System';
    const truncated = truncateText(entry.content, entryTruncateLength);
    const line = `- ${roleLabel}: ${truncated}`;
    const lineTokens = Math.ceil(line.length / CHARS_PER_TOKEN);

    if (summaryTokens + lineTokens > summaryCap) {
      lines.push(`- ... (${entries.length - lines.length} more earlier entries omitted)`);
      break;
    }

    lines.push(line);
    summaryTokens += lineTokens;
  }

  const result = lines.join('\n');
  if (result.length > maxSummaryChars) {
    return result.substring(0, maxSummaryChars) + '\n... (summary truncated)';
  }
  return result;
}

function truncateText(text: string, maxLength: number): string {
  const normalised = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalised.length <= maxLength) return normalised;
  return normalised.substring(0, maxLength) + '...';
}
