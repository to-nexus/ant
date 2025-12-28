/**
 * Token Usage Utility Functions
 * Format token counts in K/M/B/T notation
 */

import { TaskTokenUsage } from '@/domain/models/types';

export interface TokenUsageMetrics {
  rawInputTokens: number;          // non-cache "new" input tokens
  rawOutputTokens: number;
  rawTotalTokens: number;          // rawInput + rawOutput (non-cache total)
  cacheReadTokens: number;
  cacheCreationTokens: number;
  processedInputTokens: number;    // rawInput + cacheRead + cacheCreation
  billableInputTokens: number;     // rawInput + 1.25*cacheCreation + 0.1*cacheRead
  billableTotalTokens: number;     // billableInput + rawOutput
  cacheSavedTokens: number;        // approx saved vs non-cached input (= 0.9*cacheRead)
}

/**
 * Compute consistent metrics from our TaskTokenUsage schema.
 *
 * IMPORTANT:
 * - rawInputTokens excludes cache reads/creation (see ant-cli TokenTracking comment).
 * - cacheRead/cacheCreation are tracked separately (Anthropic prompt caching).
 * - rawTotalTokens should be rawInput + rawOutput (this matches task-level totals in sessions).
 * - billableInputTokens approximates cost-equivalent input tokens using Anthropic pricing:
 *   rawInput×1 + cache_creation×1.25 + cache_read×0.1
 */
export function getTokenUsageMetrics(tokenUsage?: TaskTokenUsage | null): TokenUsageMetrics {
  const rawInputTokens = tokenUsage?.inputTokens || 0;
  const rawOutputTokens = tokenUsage?.outputTokens || 0;
  const cacheReadTokens = tokenUsage?.cacheReadTokens || 0;
  const cacheCreationTokens = tokenUsage?.cacheCreationTokens || 0;

  const rawTotalTokens = rawInputTokens + rawOutputTokens;
  const processedInputTokens = rawInputTokens + cacheReadTokens + cacheCreationTokens;

  const billableInputTokens =
    rawInputTokens +
    Math.floor(cacheCreationTokens * 1.25) +
    Math.floor(cacheReadTokens * 0.1);

  const billableTotalTokens = billableInputTokens + rawOutputTokens;
  const cacheSavedTokens = Math.floor(cacheReadTokens * 0.9);

  return {
    rawInputTokens,
    rawOutputTokens,
    rawTotalTokens,
    cacheReadTokens,
    cacheCreationTokens,
    processedInputTokens,
    billableInputTokens,
    billableTotalTokens,
    cacheSavedTokens,
  };
}

/**
 * Safely sum multiple TaskTokenUsage objects.
 * Returns undefined if no usage data exists.
 */
export function sumTokenUsages(usages: Array<TaskTokenUsage | undefined | null>): TaskTokenUsage | undefined {
  let hasAny = false;
  const acc: TaskTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  for (const u of usages) {
    if (!u) continue;
    hasAny = true;
    acc.inputTokens += u.inputTokens || 0;
    acc.outputTokens += u.outputTokens || 0;
    acc.totalTokens += u.totalTokens || 0;
    acc.cacheReadTokens = (acc.cacheReadTokens || 0) + (u.cacheReadTokens || 0);
    acc.cacheCreationTokens = (acc.cacheCreationTokens || 0) + (u.cacheCreationTokens || 0);
  }

  if (!hasAny) return undefined;

  // Normalize optional fields: if both are 0, omit them for cleaner downstream checks
  const normalized: TaskTokenUsage = {
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    totalTokens: acc.totalTokens,
  };
  if ((acc.cacheReadTokens || 0) > 0) normalized.cacheReadTokens = acc.cacheReadTokens;
  if ((acc.cacheCreationTokens || 0) > 0) normalized.cacheCreationTokens = acc.cacheCreationTokens;
  return normalized;
}

/**
 * Format token count with K/M/B/T notation
 * 
 * @param tokens - Token count to format
 * @returns Formatted string (e.g., "1.2K", "3.5M", "1.2B")
 */
export function formatTokenCount(tokens: number): string {
  if (tokens === 0) return '0';
  
  const abs = Math.abs(tokens);
  
  if (abs >= 1_000_000_000_000) {
    // Trillion
    return `${(tokens / 1_000_000_000_000).toFixed(1)}T`;
  } else if (abs >= 1_000_000_000) {
    // Billion
    return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  } else if (abs >= 1_000_000) {
    // Million
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  } else if (abs >= 1_000) {
    // Thousand
    return `${(tokens / 1_000).toFixed(1)}K`;
  } else {
    // Less than 1000
    return tokens.toString();
  }
}

/**
 * Format detailed token usage (input + output)
 * 
 * @param tokenUsage - Token usage object with input/output
 * @returns Formatted string (e.g., "1.2K (0.5K in, 0.7K out)")
 */
export function formatTokenUsage(tokenUsage: TaskTokenUsage): string {
  const total = formatTokenCount(tokenUsage.totalTokens);
  const input = formatTokenCount(tokenUsage.inputTokens);
  const output = formatTokenCount(tokenUsage.outputTokens);
  
  return `${total} (${input} in, ${output} out)`;
}

/**
 * Format compact token usage (total only)
 * 
 * @param tokenUsage - Token usage object
 * @returns Formatted string (e.g., "1.2K")
 */
export function formatTokenUsageCompact(tokenUsage: TaskTokenUsage): string {
  return formatTokenCount(tokenUsage.totalTokens);
}

