/**
 * Job-level compaction: LLM-based conversation summary.
 *
 * LLM-based conversation compaction for Context Continuity jobs (Plan, Visual).
 * Operates on CompactableEntry[] (any object with role + content).
 *
 * Design:
 *  - CompactionResult.summary is a separate string (not injected into entries[])
 *  - Caller decides how to render the summary in their prompt format
 *  - On failure, throws — caller should handle gracefully
 */

import type { CompactionResult, CompactionConfig } from './types';
import { COMPACTION_MAX_OUTPUT_TOKENS } from './constants';
import type { LLMClient } from '../ports/llm';
import type { PromptPort } from '../ports/prompt';

const CHARS_PER_TOKEN = 2.8;

export interface CompactableEntry {
  role: string;
  content: string;
  timestamp?: string;
}

function estimateTokens(input: string | CompactableEntry[]): number {
  if (typeof input === 'string') {
    return Math.ceil(input.length / CHARS_PER_TOKEN);
  }
  return input.reduce((sum, e) => sum + Math.ceil((e.content || '').length / CHARS_PER_TOKEN), 0);
}

function formatEntriesForPrompt(entries: CompactableEntry[]): string {
  return entries
    .map(e => {
      const label = e.role === 'user' ? 'User'
        : e.role === 'assistant' ? 'Assistant'
        : e.role === 'system' ? 'Context Summary'
        : e.role;
      return `[${label}] ${e.content}`;
    })
    .join('\n\n');
}

/**
 * Compact a conversation using LLM summarization.
 *
 * @returns CompactionResult with summary as a separate string.
 * @throws on LLM failure — caller should handle gracefully.
 */
export async function compactJob<T extends CompactableEntry>(
  entries: T[],
  llmClient: LLMClient,
  promptPort: PromptPort,
  config: CompactionConfig,
): Promise<CompactionResult<T>> {
  const totalTokens = estimateTokens(entries);

  if (totalTokens <= config.threshold) {
    return {
      entries,
      wasCompacted: false,
      tokensBefore: totalTokens,
      tokensAfter: totalTokens,
    };
  }

  const recentEntries = entries.slice(-config.recentWindowSize);
  const oldEntries = entries.slice(0, -config.recentWindowSize);

  if (oldEntries.length === 0) {
    return {
      entries,
      wasCompacted: false,
      tokensBefore: totalTokens,
      tokensAfter: totalTokens,
    };
  }

  const systemPrompt = await promptPort.render('common/compaction/system', {
    conversation: formatEntriesForPrompt(oldEntries),
  });

  console.log(
    `\n🗜️  [CompactJob] Compacting ${oldEntries.length} old entries (${estimateTokens(oldEntries).toLocaleString()} tokens) via LLM...`,
  );

  const invokeMessages = [{ role: 'user', content: 'Summarize the conversation above.' }];
  const invokeOpts = {
    system: systemPrompt,
    maxTokens: config.maxOutputTokens || COMPACTION_MAX_OUTPUT_TOKENS,
  };

  const { summaryText, tokenUsage } = llmClient.invokeWithUsage
    ? await (async () => {
        const r = await llmClient.invokeWithUsage!(invokeMessages, invokeOpts);
        return { summaryText: r.content, tokenUsage: r.usage };
      })()
    : { summaryText: await llmClient.invoke(invokeMessages, invokeOpts), tokenUsage: undefined };

  const recentTokens = estimateTokens(recentEntries);
  const summaryTokens = estimateTokens(summaryText);

  console.log(
    `🗜️  [CompactJob] Done: ${totalTokens.toLocaleString()} → ${(recentTokens + summaryTokens).toLocaleString()} tokens ` +
    `(summary: ${summaryTokens.toLocaleString()}, recent ${recentEntries.length} entries: ${recentTokens.toLocaleString()})` +
    (tokenUsage ? ` [LLM: ${tokenUsage.inputTokens} in / ${tokenUsage.outputTokens} out]` : ''),
  );

  return {
    entries: recentEntries,
    summary: summaryText,
    wasCompacted: true,
    tokensBefore: totalTokens,
    tokensAfter: recentTokens + summaryTokens,
    tokenUsage,
  };
}

// ─── Persist Pruning ───

export interface ConversationCompaction {
  summary: string;
  /** Number of entries from the front of conversation[] that were summarized */
  summarizedCount: number;
}

/**
 * Apply compactJob results to the conversation array before session persistence.
 * Replaces the first `summarizedCount` entries with a single summary entry.
 *
 * @param createSummaryEntry - Factory to create a summary entry in the caller's type.
 */
export function applyCompactionToConversation<T extends { role: string; content: string; timestamp?: string }>(
  conversation: T[],
  compaction: ConversationCompaction | undefined,
  createSummaryEntry: (summary: string) => T,
): T[] {
  if (!compaction || !compaction.summary || compaction.summarizedCount <= 0) {
    return conversation;
  }
  if (compaction.summarizedCount >= conversation.length) {
    return [createSummaryEntry(compaction.summary)];
  }
  return [createSummaryEntry(compaction.summary), ...conversation.slice(compaction.summarizedCount)];
}
