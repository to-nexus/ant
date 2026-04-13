/**
 * CacheBlockMapper — Maps PromptBuildResult → CacheableContent[] (standard 3-block layout).
 *
 * Block 1 (cached): guardrail + systemBase + profiles + rules + examples + policy
 * Block 2 (cached): injections + contextParts (skipped if all empty)
 * [Media]         : optional image/multimodal blocks (no cache)
 * Block 3 (uncached): result.user + runtimeParts
 */

import type { PromptBuildResult } from './PromptBuildConfig';
import type { CacheableContent } from '../../ports/llm';

export interface CacheBlockOptions {
  /** Additional content strings appended to Block 2 (context, cached). */
  contextParts?: string[];
  /** Additional content strings appended to Block 3 (runtime, NOT cached). */
  runtimeParts?: string[];
  /** Image/multimodal blocks inserted between Block 2 and Block 3. */
  mediaBlocks?: CacheableContent[];
  /** Token preflight for Block 2 — truncate large parts if over budget. */
  tokenPreflight?: {
    maxBlock2Tokens: number;
    estimateTokens: (text: string) => number;
  };
}

/**
 * Build standard 3-block CacheableContent[] from PromptBuildResult.
 *
 * Block 1 uses guardrail/policy from `sections` so that cache-block callers
 * don't silently drop them (the original problem: sections lacked these fields).
 */
export function buildCacheableBlocks(
  result: PromptBuildResult,
  options?: CacheBlockOptions,
): CacheableContent[] {
  const blocks: CacheableContent[] = [];
  const s = result.sections;

  // ── Block 1: System prompt (cached, ephemeral) ──
  const block1Parts = [s.guardrail, s.systemBase, s.profiles, s.rules, s.examples, s.policy].filter(Boolean);
  if (block1Parts.length > 0) {
    blocks.push({
      type: 'text',
      text: block1Parts.join('\n\n'),
      cache_control: { type: 'ephemeral' },
    });
  }

  // ── Block 2: Context (cached, ephemeral) — skipped when empty ──
  let block2Parts = [s.injections, ...(options?.contextParts ?? [])].filter(Boolean);

  if (options?.tokenPreflight && block2Parts.length > 0) {
    const { maxBlock2Tokens, estimateTokens } = options.tokenPreflight;
    block2Parts = truncateBlock2(block2Parts, maxBlock2Tokens, estimateTokens);
  }

  if (block2Parts.length > 0) {
    blocks.push({
      type: 'text',
      text: block2Parts.join('\n\n'),
      cache_control: { type: 'ephemeral' },
    });
  }

  // ── Media blocks (optional, no cache) ──
  if (options?.mediaBlocks?.length) {
    blocks.push(...options.mediaBlocks);
  }

  // ── Block 3: Runtime (NOT cached) ──
  const block3Parts = [result.user, ...(options?.runtimeParts ?? [])].filter(Boolean);
  if (block3Parts.length > 0) {
    blocks.push({
      type: 'text',
      text: block3Parts.join('\n\n'),
    });
  }

  return blocks;
}

/**
 * Truncate Block 2 parts that exceed the token budget.
 * Drops the largest parts first until within budget.
 */
function truncateBlock2(
  parts: string[],
  maxTokens: number,
  estimateTokens: (text: string) => number,
): string[] {
  let totalTokens = parts.reduce((sum, p) => sum + estimateTokens(p), 0);
  if (totalTokens <= maxTokens) return parts;

  const indexed = parts.map((text, i) => ({ text, i, tokens: estimateTokens(text) }));
  indexed.sort((a, b) => b.tokens - a.tokens);

  const dropped = new Set<number>();
  for (const item of indexed) {
    if (totalTokens <= maxTokens) break;
    totalTokens -= item.tokens;
    dropped.add(item.i);
  }

  return parts.filter((_, i) => !dropped.has(i));
}
