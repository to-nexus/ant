/**
 * Token Usage Utility Functions
 * Format token counts in K/M/B/T notation
 */

import { TaskTokenUsage } from '@/domain/models/types';

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
 * @returns Formatted string (e.g., "1.2K tokens")
 */
export function formatTokenUsageCompact(tokenUsage: TaskTokenUsage): string {
  const total = formatTokenCount(tokenUsage.totalTokens);
  return `${total} tokens`;
}

