/**
 * Commit message helper — an LLM-authored git commit plan for the ant-commit
 * path (git-op HTTP route, NOT a job/graph). Mirrors the one-shot pattern of
 * `breadcrumbSummary.ts`: injected `llm` + `promptPort`, a timeout, and a
 * deterministic fallback so a commit never fails on an LLM hiccup.
 *
 * The metered variant (`invokeAndMeterAuxiliary`) captures usage and bills it
 * as an auxiliary (non-job) debit when a billing context + ledger are supplied.
 *
 * Returns one or more `CommitGroup`s. `allowMultiple` lets the model split
 * unrelated concerns into separate commits (E6-4); a single logical change is
 * always one group covering all its files.
 */

import {
  invokeAndMeterAuxiliary,
  type AuxiliaryBillingContext,
} from '../billing/auxiliaryUsage';
import type { CreditLedgerPort } from '../ports/creditLedger';
import type { LLMClient } from '../ports/llm';
import { LLM_TEMPERATURE } from '../ports/llmSampling';
import type { PromptPort } from '../ports/prompt';
import { withRetry, isRetryableError } from '../utils/retry';

/**
 * Per-attempt cap on a single LLM round-trip (ms). A commit issued *while a job
 * runs* competes with that job on the shared provider account and gets 429'd —
 * the fix is to RETRY across the provider's rate window (see MAX_ATTEMPTS), NOT
 * to guillotine the first attempt (the old 20s hard cut defeated the adapter's
 * own retry/backoff). This bounds one attempt; the retry budget spans many.
 *
 * TIMING INVARIANT: worst-case total (attempts × timeout + backoff sleeps)
 * MUST stay under the commit Redis lock TTL (60s) which itself must not
 * outlive the FE Promise.race window (60s). 3×15s + (2s+4s) ≈ 51s. Exceeding
 * the FE window makes a SUCCESSFUL commit look failed and blocks the retry
 * behind the still-held lock (409) — worse than a fallback commit subject.
 */
export const COMMIT_MESSAGE_ATTEMPT_TIMEOUT_MS = 15000;
/**
 * Retry budget for the commit aux call. Lets a transient rate-limit (429) /
 * overload clear as the concurrent job's provider usage ebbs. The single
 * resilience owner (`withRetry`) already fast-fails a true balance depletion, so
 * this never hangs on a real outage. Bounded by the timing invariant above.
 */
export const COMMIT_MESSAGE_MAX_ATTEMPTS = 3;
/**
 * Cap on output tokens. Must comfortably fit a multi-commit JSON array that
 * lists every changed file path — too small and the JSON truncates mid-array,
 * the parse fails, and we degrade to a fallback message.
 */
export const COMMIT_MESSAGE_MAX_OUTPUT_TOKENS = 2048;

export interface CommitGroup {
  message: string;
  files: string[];
}

export interface BuildCommitPlanInput {
  /** `git status --short` style summary. */
  status: string;
  /** Working-tree diff (already truncated by the caller). */
  diff: string;
  /** Recent `git log` subjects for convention matching. */
  recentLog: string;
  /** All staged/changed repo-relative files — used for fallback + single-commit grouping. */
  allFiles: string[];
  /** Allow splitting into multiple commits (E6-4). */
  allowMultiple: boolean;
  llm?: LLMClient;
  promptPort?: PromptPort;
  billing?: AuxiliaryBillingContext;
  ledger?: CreditLedgerPort;
}

/** Deepest directory prefix shared by every path (scope anchor), or '' if none. */
function commonDirPrefix(files: string[]): string {
  if (files.length === 0) return '';
  const perFileDirs = files.map((f) => f.split('/').slice(0, -1));
  let common = perFileDirs[0];
  for (const dirs of perFileDirs.slice(1)) {
    let i = 0;
    while (i < common.length && i < dirs.length && common[i] === dirs[i]) i++;
    common = common.slice(0, i);
  }
  return common.join('/');
}

/**
 * Last-resort commit subject when the LLM is genuinely unavailable — derived
 * from the changed files so it is always MEANINGFUL (scope + names), never a
 * bare timestamp. This is the safety net, not the happy path.
 */
export function deriveFallbackCommitMessage(files: string[]): string {
  if (files.length === 0) return 'Update workspace files';
  if (files.length === 1) return `Update ${files[0]}`.slice(0, 72);
  const scope = commonDirPrefix(files);
  const names = files.map((f) => f.split('/').pop() as string);
  const shown = names.slice(0, 3).join(', ');
  const extra = files.length > 3 ? ` (+${files.length - 3} more)` : '';
  const full = `Update ${scope ? `${scope}: ` : ''}${shown}${extra}`;
  if (full.length <= 72) return full;
  return `Update ${scope || 'workspace'} (${files.length} files)`;
}

function fallbackPlan(files: string[]): CommitGroup[] {
  return [{ message: deriveFallbackCommitMessage(files), files }];
}

/**
 * A salvaged subject is only usable if it reads like a real commit subject —
 * NOT a leftover JSON/markdown fence marker from a truncated or malformed
 * response (e.g. ```` ```json ````, `[`, `{`). Returns the trimmed subject or
 * null when it should be discarded in favour of the deterministic fallback.
 */
function usableSubject(line: string): string | null {
  const s = line.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!s) return null;
  if (/^(```|~~~|\[|\{|json\b)/i.test(s)) return null;
  return s;
}

/** A per-attempt commit-message timeout is a transient provider stall → retryable. */
function isCommitTimeout(e: unknown): boolean {
  return !!(e as { _isCommitTimeout?: boolean } | null)?._isCommitTimeout;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`commit message timeout after ${ms}ms`), {
            _isCommitTimeout: true,
          }),
        ),
      ms,
    );
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

/** Extract the first fenced ```json block, else the first top-level `[...]`. */
function extractJsonArray(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

function parseGroups(text: string, allFiles: string[]): CommitGroup[] | null {
  const json = extractJsonArray(text);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const allowed = new Set(allFiles);
  const groups: CommitGroup[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') return null;
    const message = (entry as { message?: unknown }).message;
    const files = (entry as { files?: unknown }).files;
    if (typeof message !== 'string' || !message.trim()) return null;
    if (!Array.isArray(files)) return null;
    // Keep only files the model was actually given — drop hallucinated paths.
    const validFiles = files.filter((f): f is string => typeof f === 'string' && allowed.has(f));
    if (validFiles.length === 0) return null;
    groups.push({ message: message.trim(), files: validFiles });
  }

  // Every changed file must land in exactly one group; if the model dropped
  // some, append them to the last group so nothing is silently left unstaged.
  const covered = new Set(groups.flatMap((g) => g.files));
  const missing = allFiles.filter((f) => !covered.has(f));
  if (missing.length > 0) groups[groups.length - 1].files.push(...missing);

  return groups;
}

/**
 * Produce the commit plan. Always returns at least one usable group — falls
 * back to a single `Update: <ISO>` commit over all files on any failure path.
 */
export async function buildCommitPlan(input: BuildCommitPlanInput): Promise<CommitGroup[]> {
  const { llm, promptPort, allFiles, allowMultiple } = input;
  if (!llm || !promptPort || allFiles.length === 0) {
    return fallbackPlan(allFiles);
  }

  let systemPrompt: string;
  try {
    systemPrompt = await promptPort.render('infra/commit-message/system', {
      status: input.status || '(no status)',
      diff: input.diff || '(no diff)',
      recentLog: input.recentLog || '(no recent history)',
      multi: allowMultiple,
    });
  } catch (err) {
    console.warn('⚠️  [CommitMsg] template render failed, using fallback:', err);
    return fallbackPlan(allFiles);
  }

  try {
    // System content MUST ride the messages array (adapters read the system
    // role from messages, not options.system) — see breadcrumbSummary note.
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Write the commit message(s).' },
    ];
    // Ride the provider's rate-limit backoff instead of guillotining the first
    // attempt: a commit issued while a job runs shares the provider account and
    // gets 429'd; retrying across the rate window is what lets it still receive
    // an LLM-authored message. `isRetryableError` fast-fails a true balance
    // depletion, so this never hangs on a real outage.
    const text = await withRetry(
      () =>
        withTimeout(
          invokeAndMeterAuxiliary({
            llm,
            messages,
            options: {
              maxTokens: COMMIT_MESSAGE_MAX_OUTPUT_TOKENS,
              enableThinking: false,
              temperature: LLM_TEMPERATURE.SUMMARIZE,
            },
            kind: 'commit',
            billing: input.billing,
            ledger: input.ledger,
          }),
          COMMIT_MESSAGE_ATTEMPT_TIMEOUT_MS,
        ),
      {
        maxAttempts: COMMIT_MESSAGE_MAX_ATTEMPTS,
        initialDelayMs: 2000,
        maxDelayMs: 4000,
        backoffMultiplier: 2,
        shouldRetry: (e) =>
          isCommitTimeout(e) || isRetryableError(e, ['overloaded_error', 'api_error']),
      },
    );

    const cleaned = (text ?? '').trim();
    if (!cleaned) {
      console.warn('⚠️  [CommitMsg] LLM returned empty content, using fallback');
      return fallbackPlan(allFiles);
    }

    if (allowMultiple) {
      const groups = parseGroups(cleaned, allFiles);
      if (groups) return groups;
      // Non-fatal: salvage a single commit from the first line ONLY if it reads
      // like a real subject — never commit a fence marker (```json) or a raw
      // JSON bracket from a truncated response.
      const salvaged = usableSubject(cleaned.split('\n')[0]);
      console.warn(
        `⚠️  [CommitMsg] multi-commit JSON parse failed; ${salvaged ? 'salvaged single subject' : 'no usable subject, using content-derived fallback'}`,
      );
      return salvaged ? [{ message: salvaged, files: allFiles }] : fallbackPlan(allFiles);
    }

    const subject = usableSubject(cleaned.split('\n')[0]);
    if (!subject) {
      console.warn('⚠️  [CommitMsg] no usable single-line subject, using content-derived fallback');
      return fallbackPlan(allFiles);
    }
    return [{ message: subject, files: allFiles }];
  } catch (err) {
    console.warn('⚠️  [CommitMsg] LLM call failed, using fallback:', err);
    return fallbackPlan(allFiles);
  }
}
