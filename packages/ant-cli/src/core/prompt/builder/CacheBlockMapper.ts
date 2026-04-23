/**
 * CacheBlockMapper — Maps PromptBuildResult → CacheableContent[] (standard 3-block layout).
 *
 * Block 1 (cached): guardrail + systemBase + profiles + rules + examples + policy
 * Block 2 (cached): injections + contextParts + taskInvariantParts (skipped if all empty)
 * [Media]         : optional image/multimodal blocks (no cache)
 * Block 3 (uncached): result.user + runtimeParts
 *
 * Classification axis — what decides Block 2 vs Block 3 is **task-boundary
 * invariance**, NOT "rendered at runtime". Content that is fixed for the
 * lifetime of a single task (plan JSON, Current Task header, file
 * manifests seeded at task start) belongs in Block 2 even though it is
 * assembled dynamically per task. Only content that mutates **within** a
 * task's execute recursion (violations per retry, other-worker-file
 * manifest re-collected each execute entry, on-disk contents of edited
 * files) belongs in Block 3.
 *
 * The earlier "runtime = uncached" shorthand conflated "assembled at
 * runtime" with "mutates per turn" and pushed task-invariant prompt
 * parts into Block 3, causing them to be billed on every recursion. The
 * new `taskInvariantParts` slot fixes that without widening the Block 1
 * cache surface (which must stay stable across tasks).
 */

import type { PromptBuildResult } from './PromptBuildConfig';
import type { CacheableContent } from '../../ports/llm';

export interface CacheBlockOptions {
  /** Additional content strings appended to Block 2 (context, cached). Subject to tokenPreflight drop. */
  contextParts?: string[];
  /**
   * Task-invariant content appended to Block 2 (cached) AFTER `contextParts`.
   *
   * Bypasses `tokenPreflight.truncateBlock2` drop — callers are responsible
   * for keeping the combined size bounded. The SSOT promise carried by
   * this slot: **content here MUST be identical across every LLM call
   * within a single task**. Anything that can change during a task's
   * execute recursion (edit-file results, retry violations, newly
   * completed parallel-worker files) MUST NOT go here — put those in
   * `runtimeParts` instead.
   */
  taskInvariantParts?: string[];
  /** Additional content strings appended to Block 3 (runtime, NOT cached). */
  runtimeParts?: string[];
  /** Image/multimodal blocks inserted between Block 2 and Block 3. */
  mediaBlocks?: CacheableContent[];
  /** Token preflight for Block 2 — truncate large parts if over budget. Applies only to `contextParts`, never to `taskInvariantParts`. */
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
  // Preflight-eligible parts (subject to drop when over budget).
  let block2Parts = [s.injections, ...(options?.contextParts ?? [])].filter(Boolean);

  if (options?.tokenPreflight && block2Parts.length > 0) {
    const { maxBlock2Tokens, estimateTokens } = options.tokenPreflight;
    block2Parts = truncateBlock2(block2Parts, maxBlock2Tokens, estimateTokens);
  }

  // Task-invariant parts append AFTER preflight so they are never dropped.
  // This is where plan JSON / Current Task / file manifests land — content
  // that the caller guarantees is stable within a task's lifetime. Dropping
  // them to save tokens would defeat the whole purpose of the cache move.
  const taskInvariantParts = (options?.taskInvariantParts ?? []).filter(Boolean);
  const combinedBlock2 = [...block2Parts, ...taskInvariantParts];

  if (combinedBlock2.length > 0) {
    blocks.push({
      type: 'text',
      text: combinedBlock2.join('\n\n'),
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
