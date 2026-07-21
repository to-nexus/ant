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

/** Hard cap on LLM call duration (ms). Beyond this we fall back. */
export const COMMIT_MESSAGE_TIMEOUT_MS = 8000;
/** Cap on output tokens — commit messages are short. */
export const COMMIT_MESSAGE_MAX_OUTPUT_TOKENS = 512;

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

function timestampFallback(files: string[]): CommitGroup[] {
  return [{ message: `Update: ${new Date().toISOString()}`, files }];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`commit message timeout after ${ms}ms`)), ms);
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
    return timestampFallback(allFiles);
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
    return timestampFallback(allFiles);
  }

  try {
    // System content MUST ride the messages array (adapters read the system
    // role from messages, not options.system) — see breadcrumbSummary note.
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Write the commit message(s).' },
    ];
    const text = await withTimeout(
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
      COMMIT_MESSAGE_TIMEOUT_MS,
    );

    const cleaned = (text ?? '').trim();
    if (!cleaned) {
      console.warn('⚠️  [CommitMsg] LLM returned empty content, using fallback');
      return timestampFallback(allFiles);
    }

    if (allowMultiple) {
      const groups = parseGroups(cleaned, allFiles);
      if (groups) return groups;
      console.warn('⚠️  [CommitMsg] multi-commit parse failed, using single commit');
      // Non-fatal: still salvage a single commit from the raw text if it looks
      // like a subject line, else fall back to timestamp.
      const firstLine = cleaned.split('\n')[0].trim();
      return firstLine ? [{ message: firstLine, files: allFiles }] : timestampFallback(allFiles);
    }

    const subject = cleaned.split('\n')[0].trim();
    return [{ message: subject, files: allFiles }];
  } catch (err) {
    console.warn('⚠️  [CommitMsg] LLM call failed, using fallback:', err);
    return timestampFallback(allFiles);
  }
}
