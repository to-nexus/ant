/**
 * Universal stop hooks — the deterministic turn-completion contract.
 *
 * An intent may declare `hooks.stop` entries (artifact glob | action tool
 * name, all must hold — AND). The turn's ONLY stop point (the agent node
 * emitting zero tool calls) becomes a deterministic gate: unmet hooks bounce
 * the agent a bounded number of times; once the budget is spent the turn
 * ends as a resumable pause (`universal_stop_hook_unmet`).
 *
 * Verdicts come from runtime-observed evidence ONLY — real file writes
 * (`_turnToolWrites`, tool side-effects) and successful tool calls
 * (`_turnToolActions`) — never from LLM claims (completion-signal =
 * actual-write). Same predicate family as design's `isNoOutputCompletion`
 * and plan's `isUnrealizedBrief`; the checklist (LLM self-narration) neither
 * feeds nor is touched by this gate.
 *
 * Pure module: no graph state, no fs (disk re-verification takes a
 * `fileExists` capability from the caller). Node responsibilities:
 * agent = gate + bounce, tool = evidence collection, respond = terminal
 * recomputation for the manifest/paused seal, router = pure flag read.
 */

import type { CustomIntentDef, IntentStopHook } from '@ant/shared';
import { GENERAL_INTENT, API_ACTION_NARROWED_PATTERN, matchesNarrowedApiAction } from '@ant/shared';

/** Forced agent re-entries per turn before the gate concedes to a pause. */
export const UNIVERSAL_STOP_HOOK_BOUNCE_BUDGET = 2;

/** One declared hook flattened with its owning intent. */
export interface ActiveStopHook {
  intentId: string;
  hook: IntentStopHook;
}

/** One hook's verdict at a stop point. */
export interface StopHookCheck {
  intentId: string;
  hook: IntentStopHook;
  /** Artifact hooks: this turn's real writes matching the glob. */
  matchedWrites: string[];
  met: boolean;
  /** Met by the restored ledger (a prior paused turn) — exempt from disk re-verification. */
  viaLedger?: boolean;
}

/**
 * Hooks already met on a previous turn of a paused sequence — rides ONLY the
 * paused seal (`hookLedger`, same self-clear convention as
 * `clarifyTurnContext`) so a resumed turn re-demands only the remaining
 * hooks. A normal (non-paused) seal omits it: the next request is a fresh
 * contract, and disk leftovers alone never satisfy it.
 */
export type StopHookLedger = Record<string, { metAtTurn: true }>;

/**
 * Flatten the active intents' declared stop hooks. `general` is reserved and
 * can never declare hooks, so an unpinned/general turn yields `[]`.
 */
export function activeStopHooksOf(
  catalog: readonly CustomIntentDef[],
  activeIntents: readonly string[],
): ActiveStopHook[] {
  const active = new Set(activeIntents.filter((i) => i !== GENERAL_INTENT));
  const result: ActiveStopHook[] = [];
  for (const intent of catalog) {
    if (!active.has(intent.id)) continue;
    for (const hook of intent.hooks?.stop ?? []) {
      result.push({ intentId: intent.id, hook });
    }
  }
  return result;
}

/**
 * One segment of a glob (`*` = any run of non-`/`, everything else literal)
 * matched against one path segment. Classic linear two-pointer wildcard match:
 * a single greedy `*` backtrack point, never the nested-quantifier backtracking
 * a RegExp of repeated `**` produces (that was CWE-1333 ReDoS — a 43-char
 * pattern froze a job-runner for 2.7s). No RegExp, no catastrophic blowup.
 */
function matchSegment(pattern: string, str: string): boolean {
  let p = 0;
  let s = 0;
  let star = -1;
  let starS = 0;
  while (s < str.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === str[s]) {
      p++;
      s++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p;
      starS = s;
      p++;
    } else if (star !== -1) {
      p = star + 1;
      starS++;
      s = starS;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/**
 * Glob → boolean match for artifact-root-relative paths, evaluated as a
 * segment-level DP (memoized): `*` = one segment (no `/`), `**` = any depth
 * (whole segment only — the validator enforces that). A trailing `**` matches
 * one-or-more remaining segments (`reports/**` needs something under it); an
 * interior `**` matches zero-or-more (`reports/**​/*.md` matches `reports/a.md`).
 * The DP is O(patternSegments × pathSegments) — no backtracking to exploit.
 */
export function matchArtifactGlob(pattern: string, path: string): boolean {
  const pSegs = pattern.split('/');
  const sSegs = path.split('/');
  const memo = new Map<number, boolean>();
  const key = (pi: number, si: number) => pi * (sSegs.length + 1) + si;

  const dp = (pi: number, si: number): boolean => {
    const k = key(pi, si);
    const cached = memo.get(k);
    if (cached !== undefined) return cached;

    let result: boolean;
    if (pi === pSegs.length) {
      result = si === sSegs.length;
    } else if (pSegs[pi] === '**') {
      if (pi === pSegs.length - 1) {
        // Trailing `**`: at least one remaining segment (regex `.*` after `/`).
        result = si < sSegs.length;
      } else {
        // Interior `**`: zero-or-more segments.
        result = false;
        for (let k2 = si; k2 <= sSegs.length; k2++) {
          if (dp(pi + 1, k2)) {
            result = true;
            break;
          }
        }
      }
    } else if (si >= sSegs.length) {
      result = false;
    } else {
      result = matchSegment(pSegs[pi], sSegs[si]) && dp(pi + 1, si + 1);
    }
    memo.set(k, result);
    return result;
  };

  return dp(0, 0);
}

/** Normalize a tool-reported write path to the glob vocabulary (artifact-root relative posix). */
export function normalizeArtifactPath(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Stable ledger key: `<intentId>#artifact:<glob>` | `<intentId>#action:<tool>`. */
export function hookKeyOf(h: ActiveStopHook): string {
  return 'artifact' in h.hook
    ? `${h.intentId}#artifact:${h.hook.artifact}`
    : `${h.intentId}#action:${h.hook.action}`;
}

/**
 * Evaluate every active hook against the turn's observed evidence plus the
 * restored ledger (paused-sequence continuity). Pure — disk existence is the
 * caller's follow-up via {@link verifyChecksOnDisk}.
 */
export function checkStopHooks(
  hooks: readonly ActiveStopHook[],
  evidence: { writes: readonly string[]; actions: readonly string[]; ledger?: StopHookLedger },
): StopHookCheck[] {
  const actionSet = new Set(evidence.actions);
  return hooks.map((h) => {
    if (evidence.ledger?.[hookKeyOf(h)]?.metAtTurn === true) {
      return { intentId: h.intentId, hook: h.hook, matchedWrites: [], met: true, viaLedger: true };
    }
    if ('artifact' in h.hook) {
      const glob = h.hook.artifact;
      const matchedWrites = Array.from(new Set(evidence.writes.map(normalizeArtifactPath))).filter((w) =>
        matchArtifactGlob(glob, w),
      );
      return { intentId: h.intentId, hook: h.hook, matchedWrites, met: matchedWrites.length > 0 };
    }
    const action = h.hook.action;
    return {
      intentId: h.intentId,
      hook: h.hook,
      matchedWrites: [],
      // A narrowed value never matches the bare tool name, so a scaffold POST
      // cannot satisfy a hook that asks for a specific write.
      met: API_ACTION_NARROWED_PATTERN.test(action)
        ? evidence.actions.some((tok) => matchesNarrowedApiAction(action, tok))
        : actionSet.has(action),
    };
  });
}

/**
 * Disk re-verification for artifact hooks: a matched write only counts while
 * the file still exists (a later call this run may have deleted it) —
 * respond's plan-card gate precedent. Ledger-met checks are exempt (their
 * evidence lived on a prior turn). Returns rewritten checks.
 */
export async function verifyChecksOnDisk(
  checks: readonly StopHookCheck[],
  fileExists: (p: string) => Promise<boolean>,
): Promise<StopHookCheck[]> {
  return Promise.all(
    checks.map(async (c) => {
      if (!c.met || c.viaLedger || !('artifact' in c.hook) || c.matchedWrites.length === 0) return { ...c };
      const surviving: string[] = [];
      for (const w of c.matchedWrites) {
        if (await fileExists(w).catch(() => false)) surviving.push(w);
      }
      return { ...c, matchedWrites: surviving, met: surviving.length > 0 };
    }),
  );
}

/** Ledger of the met checks, for the paused seal. */
export function buildStopHookLedger(checks: readonly StopHookCheck[]): StopHookLedger {
  const ledger: StopHookLedger = {};
  for (const c of checks) {
    if (c.met) ledger[hookKeyOf({ intentId: c.intentId, hook: c.hook })] = { metAtTurn: true };
  }
  return ledger;
}

/** Restore a sealed `hookLedger` (JSON round-trip — sanitize every entry). */
export function parseSealedHookLedger(raw: unknown): StopHookLedger | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const ledger: StopHookLedger = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof key === 'string' &&
      key.length > 0 &&
      value &&
      typeof value === 'object' &&
      (value as { metAtTurn?: unknown }).metAtTurn === true
    ) {
      ledger[key] = { metAtTurn: true };
    }
  }
  return Object.keys(ledger).length > 0 ? ledger : undefined;
}

function describeHook(c: StopHookCheck): string {
  return 'artifact' in c.hook
    ? `write a file matching \`${c.hook.artifact}\``
    : `successfully call \`${c.hook.action}\``;
}

/** ✓/✗ split line list — met hooks acknowledged so a sequence continues instead of restarting. */
function checkLines(checks: readonly StopHookCheck[]): string {
  return checks
    .map((c) => `- ${c.met ? '✓ met' : '✗ unmet'} — [${c.intentId}] ${describeHook(c)}`)
    .join('\n');
}

/**
 * The `[stop-hook]` gate message injected on a bounce. It lives in the
 * session memory permanently — keep it short. English only (prompt-plane
 * text, like every runtime injection); `language` shapes nothing today but
 * stays in the signature so respond/report copy can localize later.
 */
export function buildStopHookGateMessage(
  checks: readonly StopHookCheck[],
  attempt: number,
  budget: number,
): string {
  return (
    `[stop-hook] This turn's completion contract is not met yet ` +
    `(verified from actual tool results, attempt ${attempt}/${budget + 1}):\n` +
    `${checkLines(checks)}\n` +
    `Satisfy the unmet hooks with real tool calls now, or state explicitly why you cannot — ` +
    `do NOT claim completion.`
  );
}

/**
 * Chat manifest lines for respond. Returns null when no hooks are active.
 * Unmet patterns are printed verbatim so an author's typo is visible.
 */
export function formatStopHookManifest(
  checks: readonly StopHookCheck[],
  language: 'ko' | 'en',
): string | null {
  if (checks.length === 0) return null;
  const unmet = checks.filter((c) => !c.met);
  if (unmet.length === 0) {
    return language === 'ko' ? `🎯 **Stop hooks 충족**` : `🎯 **Stop hooks met**`;
  }
  const head =
    language === 'ko'
      ? `⚠️ **이번 턴의 stop hook이 충족되지 않았습니다** — 작업이 일시중지됩니다. 재개하면 남은 훅만 다시 요구됩니다.`
      : `⚠️ **This turn's stop hooks were not met** — the job pauses. Resuming re-demands only the remaining hooks.`;
  return `${head}\n${checkLines(checks)}`;
}

/** Prompt-band lines for the Turn Completion Contract (agent system prompt). */
export function formatStopHookContractLines(hooks: readonly ActiveStopHook[]): string[] {
  return hooks.map((h) =>
    'artifact' in h.hook
      ? `[${h.intentId}] a file matching \`${h.hook.artifact}\` is actually written this turn`
      : `[${h.intentId}] \`${h.hook.action}\` is successfully called this turn`,
  );
}
