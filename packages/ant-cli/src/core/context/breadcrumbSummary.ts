/**
 * Breadcrumb summary — LLM-generated noun-form one-liner that captures the
 * substance of a completed code-change task.
 *
 * Replaces the legacy `buildBreadcrumbSummary` directive-paraphrase fallback
 * for the primary path; the paraphrase remains the safe fallback when:
 *   - LLM port / PromptPort are not wired (test harness, ask flow)
 *   - LLM call fails or times out (5s cap)
 *   - LLM returns empty / whitespace-only content
 *
 * job-context-bridge T4. Inputs are kept small (directive + touched-file
 * lists) so the prompt stays well under 4K tokens — chat.jsonl trace is
 * NOT injected here to avoid token blow-up.
 */

import type { LLMClient } from '../ports/llm';
import type { PromptPort } from '../ports/prompt';
import { buildBreadcrumbSummary } from './breadcrumb';

/** Hard cap on LLM call duration (ms). Beyond this we fall back. */
export const BREADCRUMB_SUMMARY_TIMEOUT_MS = 5000;
/** Cap on output tokens — summary is meant to be one or two sentences. */
export const BREADCRUMB_SUMMARY_MAX_OUTPUT_TOKENS = 256;
/** Maximum input file count per category (defensive truncation). */
const MAX_FILES_PER_CATEGORY = 50;

export interface BuildLlmBreadcrumbSummaryInput {
  directive: string;
  mode?: 'explain' | 'generate' | 'refactor' | string;
  created: string[];
  modified: string[];
  deleted: string[];
  touchedCount: number;
  llm?: LLMClient;
  promptPort?: PromptPort;
}

function truncate(list: string[], cap: number): string[] {
  if (list.length <= cap) return list;
  return list.slice(0, cap);
}

function fallback(input: BuildLlmBreadcrumbSummaryInput): string {
  return buildBreadcrumbSummary({
    directive: input.directive,
    touchedCount: input.touchedCount,
    mode: input.mode,
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`breadcrumb summary timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/**
 * Produce a noun-form summary for the breadcrumb line. Always returns a
 * usable string — falls back to `buildBreadcrumbSummary` (directive
 * paraphrase) on any failure path so BC emission is never blocked.
 */
export async function buildLlmBreadcrumbSummary(
  input: BuildLlmBreadcrumbSummaryInput,
): Promise<string> {
  const { llm, promptPort } = input;
  if (!llm || !promptPort) {
    return fallback(input);
  }

  let systemPrompt: string;
  try {
    systemPrompt = await promptPort.render('infra/breadcrumb-summary/system', {
      directive: input.directive || '(no directive)',
      mode: input.mode ?? 'unknown',
      created: truncate(input.created, MAX_FILES_PER_CATEGORY),
      modified: truncate(input.modified, MAX_FILES_PER_CATEGORY),
      deleted: truncate(input.deleted, MAX_FILES_PER_CATEGORY),
    });
  } catch (err) {
    console.warn('⚠️  [BCSummary] template render failed, using fallback:', err);
    return fallback(input);
  }

  try {
    // System prompt MUST go through the `messages` array as a `system`
    // role entry — every adapter (Anthropic / OpenAI / Gemini) extracts
    // system content from `messages.find(m => m.role === 'system')` and
    // ignores any `options.system` field. Passing it via options drops
    // the entire context and the LLM responds with a generic "what would
    // you like me to summarize?" message that gets persisted as the BC
    // summary verbatim.
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Produce the breadcrumb summary.' },
    ];
    const text = await withTimeout(
      llm.invoke(messages, { maxTokens: BREADCRUMB_SUMMARY_MAX_OUTPUT_TOKENS }),
      BREADCRUMB_SUMMARY_TIMEOUT_MS,
    );
    const cleaned = (text ?? '').trim();
    if (!cleaned) {
      console.warn('⚠️  [BCSummary] LLM returned empty content, using fallback');
      return fallback(input);
    }
    return cleaned;
  } catch (err) {
    console.warn('⚠️  [BCSummary] LLM call failed, using fallback:', err);
    return fallback(input);
  }
}
