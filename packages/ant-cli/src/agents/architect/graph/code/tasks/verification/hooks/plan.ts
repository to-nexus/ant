/**
 * verification/hooks/plan.ts — TaskPlanHook implementation.
 *
 * Translates the plan-node's verification-specific branches into Session API
 * calls. Hooks supplied:
 *
 *   - `onEntry(state, reason)`     — bump attempt counter + clear cycle set
 *                                    via `session.onPlanEntry(reason)`.
 *   - `classifyEntry(state)`       — derives the plan-entry reason from
 *                                    `state._nextPlanEntry` (set by exec
 *                                    router before re-entering plan).
 *   - `decideOutcome(state, pt)`   — forwards raw plan text to
 *                                    `session.evaluate({ planText })` so
 *                                    the verdict is derived strictly from
 *                                    session-owned state (attempts, history,
 *                                    empty-plan body). Never returns
 *                                    `force_split` — that is `maybeSplit`'s
 *                                    single responsibility (§6.2 boundary).
 *   - `maybeSplit(state, pt)`      — sole owner of the force_split path.
 *                                    Parses the plan, calls
 *                                    `session.evaluate({…parsed})` once,
 *                                    and when the verdict is `force_split`
 *                                    advances the batch-split cycle counter
 *                                    and returns the `SplitResult` envelope
 *                                    the plan node should enqueue.
 *   - `makeTerminalError(...)`     — constructs a typed `VerificationTerminalError`
 *                                    with a carry-over snapshot so the
 *                                    orchestrator can classify it immediately.
 *   - `buildPrompt(ctx)`           — renders the verification-variant plan
 *                                    prompt (`jobs/code/nodes/plan/variants/
 *                                    verification/base`) with tech-tier-aware
 *                                    dependency / deep-diagnostic / cached-pass
 *                                    injections. Ported from
 *                                    `nodes/plan/planGeneration.ts` L95~148
 *                                    as part of T6b-β.
 *
 * R2 compliance — the hook's verdicts come from its own `model/` (Session,
 * outcome, errors). Prompt-rendering helpers (`collectConfigSnapshot`,
 * `renderConfigBlock`) also live under `model/configSnapshot` as of T9.
 * No imports from `nodes/`, `routers/`, or `parallel/`.
 */

import type { ArchitectGraphState } from '../../../state';
import type { PlanEntry } from '../model/Session';
import { VerificationSession } from '../model/Session';
import type { VerificationOutcome } from '../model/outcome';
import { VerificationTerminalError } from '../model/errors';
import type { VerificationTerminalKind } from '../model/errors';
import type { TerminalOutcome, SplitResult, PlanPromptCtx, InitSessionEnv } from '../../_shared/types';
import { effectiveTechTier, getTechTier } from '@ant/shared';
import {
  collectConfigSnapshot,
  renderConfigBlock,
} from '../model/configSnapshot';

// ────────────────────────────────────────────────────────────────────────────
// Plan parsing helpers — kept local to avoid coupling to `nodes/plan/*`.
// ────────────────────────────────────────────────────────────────────────────

function stripFences(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  return m ? m[1].trim() : trimmed;
}

interface ParsedPlan {
  totalErrors: number;
  modifyCount: number;
  batches: unknown[];
  implementation: Record<string, unknown>;
  raw: Record<string, unknown>;
}

function parsePlan(planText: string): ParsedPlan | null {
  if (!planText || planText.length === 0) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFences(planText));
  } catch {
    return null;
  }
  const diagnostics = (parsed.diagnostics ?? {}) as Record<string, unknown>;
  const implementation = (parsed.implementation ?? {}) as Record<string, unknown>;
  const modify = Array.isArray(implementation.modify) ? implementation.modify : [];
  const batches = Array.isArray(parsed.batches) ? parsed.batches : [];
  return {
    totalErrors: typeof diagnostics.totalErrors === 'number' ? diagnostics.totalErrors : 0,
    modifyCount: modify.length,
    batches,
    implementation,
    raw: parsed,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Hook implementations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Merge-aware VerificationSession population at plan-node entry.
 *
 *   - Missing session → constructs a fresh one via `createFresh(env)`.
 *   - Session present with an empty required-gate set (scenario seed that
 *     carried only attempts / history metadata, or an early-rehydrated
 *     pre-plan snapshot) → populates required/passed from `env` via
 *     `hydrateEnv` while preserving attempts, history, depHash, etc.
 *   - Session present with a populated required set → no-op (carry-over
 *     from resume/rehydrate is authoritative).
 *
 * This is the single writer of `state.verification` in the fresh-entry
 * path. Carry-over boundaries populate the session via
 * `hooks/orchestrator.ts::restoreIntoWorkerState` and `runner.ts` resume
 * hydration; both run before the plan node fires, so `initSession` never
 * stomps a rehydrated cycle.
 */
export function initSession(state: ArchitectGraphState, env: InitSessionEnv): void {
  if (!state.verification) {
    state.verification = VerificationSession.createFresh(env);
    return;
  }
  state.verification.hydrateEnv(env);
}

/**
 * Record plan-node re-entry. `retry` and `reverify` bump the attempt counter
 * and clear the per-cycle attempted set; other reasons are no-ops at the
 * session level.
 */
export function onEntry(state: ArchitectGraphState, reason: PlanEntry): void {
  state.verification?.onPlanEntry(reason);
}

/**
 * Derive the plan-entry reason from transient state set by upstream routers.
 * Returns `null` when the router has not pre-declared a reason — the phase
 * layer is then responsible for choosing `fresh` / `resumed` / `toolLoop`.
 */
export function classifyEntry(state: ArchitectGraphState): PlanEntry | null {
  const next = state._nextPlanEntry;
  if (next === 'retry' || next === 'reverify') return next;
  return null;
}

/**
 * Decide the "continue / short_circuit / terminal" verdict using only
 * information the session already owns (attempts, history, repeated-plan
 * hashes, empty-plan body). This hook is strictly the non-split path —
 * per handoff §6.2 the boundary is:
 *
 *   maybeSplit  : parses the plan and decides force_split only
 *   decideOutcome : passes raw planText; `evaluate` never sees parsed
 *                   metadata, so `force_split` is unreachable here
 *
 * Keeping decideOutcome parse-free enforces the contract that
 * `force_split` can only originate from `maybeSplit`. When `maybeSplit`
 * returns null, the phase layer calls decideOutcome for the remaining
 * three outcome kinds. Missing session → conservative `continue`.
 */
export function decideOutcome(
  state: ArchitectGraphState,
  planText: string,
): VerificationOutcome {
  const session = state.verification;
  if (!session) return { kind: 'continue' };
  return session.evaluate({ planText });
}

/**
 * Parse the plan body and ask the Session whether this cycle warrants a
 * force-split. When it does, advance the session's batch-split cycle
 * counter and return a `SplitResult` envelope describing the per-batch
 * decomposition the plan node should enqueue.
 *
 * This hook is the single owner of the force_split decision — it parses
 * the plan once, delegates to `Session.evaluate({…parsed})` for the
 * verdict, and only composes the envelope when the verdict is
 * `force_split`. Any other outcome (`continue`/`terminal`/`short_circuit`)
 * leaves the session untouched and returns `null`, letting the phase
 * layer fall through to `decideOutcome`.
 */
export function maybeSplit(
  state: ArchitectGraphState,
  planText: string,
): SplitResult | null {
  const session = state.verification;
  if (!session) return null;

  const parsed = parsePlan(planText);
  if (!parsed) return null;

  const outcome = session.evaluate({
    planText,
    totalErrors: parsed.totalErrors,
    modifyCount: parsed.modifyCount,
    batches: parsed.batches.length,
  });
  if (outcome.kind !== 'force_split') return null;

  session.onBatchSplit(JSON.stringify({
    totalErrors: parsed.totalErrors,
    modifyCount: parsed.modifyCount,
    reason: outcome.reason,
  }));

  const batches = parsed.batches.length > 0
    ? parsed.batches
    : [parsed.implementation];

  return {
    reason: outcome.reason,
    batches,
    totalErrors: parsed.totalErrors,
    modifyCount: parsed.modifyCount,
    batchSplitCount: session.batchSplitCount(),
  };
}

/**
 * Render a terminal outcome as a typed `VerificationTerminalError`. The
 * orchestrator's `classifyTerminalError` uses the `kind` field to decide
 * re-queue vs. escalate without resorting to regex on message text.
 */
const KNOWN_KINDS: ReadonlySet<string> = new Set<VerificationTerminalKind>([
  'max_retries_exceeded',
  'budget_exhausted',
  'no_progress',
  'unresolved_violations',
  'batch_cycle_limit',
]);

export function makeTerminalError(
  state: ArchitectGraphState,
  outcome: TerminalOutcome,
): Error {
  const rawKind = (outcome as { errorKind?: string }).errorKind ?? '';
  const message = (outcome as { message?: string }).message ?? 'Verification terminal failure.';
  const kind: VerificationTerminalKind = KNOWN_KINDS.has(rawKind)
    ? (rawKind as VerificationTerminalKind)
    : 'unresolved_violations';

  // Snapshot the session at failure time for observability and resume.
  const carryOver = state.verification?.snapshot() ?? null;
  return new VerificationTerminalError(kind, message, carryOver);
}

// ────────────────────────────────────────────────────────────────────────────
// buildPrompt — verification-variant plan prompt
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render a bullet block for the "already passed" gates so the LLM skips
 * steps that are known-green. The labels below are the SSOT for the prompt
 * surface; callers supply the set of passed-step names from whichever
 * source they trust (Session.passed() when available, legacy tracker
 * derivation as a coexistence fallback).
 */
function renderPassedSteps(passed: readonly string[]): string | undefined {
  if (passed.length === 0) return undefined;
  const labels: Record<string, string> = {
    typecheck: '- ✓ typecheck (tsc --noEmit)',
    build: '- ✓ build',
    test: '- ✓ test',
  };
  const rendered = passed.map(s => labels[s]).filter(Boolean).join('\n');
  return rendered || undefined;
}

function formatCodeContext(ctx: any): string {
  if (!ctx?.files || !Array.isArray(ctx.files) || ctx.files.length === 0) return '';
  return `**Retrieved Files** (${ctx.files.length} files):\n\n${ctx.files.map((f: any) => `- \`${f.path}\``).join('\n')}`;
}

function mapLang(language: string): string {
  const l = language.toLowerCase();
  if (l.includes('go')) return 'go';
  if (l.includes('python')) return 'python';
  if (l.includes('rust')) return 'rust';
  if (l.includes('java')) return 'java';
  return 'typescript';
}

/**
 * Compose the verification-variant plan prompt. Mirrors the behaviour of the
 * `task.type === 'verification'` block previously inlined at
 * `nodes/plan/planGeneration.ts` L95~148, including:
 *
 *   - tech-tier resolution + language-hint lookup (silent fallback when the
 *     hint partial does not exist for the detected language);
 *   - dependency-status hint driven by `Session.dependencyStatus()`;
 *   - deep-diagnostic config-snapshot injection on re-entry ≥ threshold;
 *   - cached-passed-step block so the LLM does not re-run gates the
 *     session already considers passed.
 */
export async function buildPrompt(ctx: PlanPromptCtx): Promise<string> {
  const { state, task, projectCodeContext, violationsText, options } = ctx;
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Plan] PromptBuilder not available');
  }

  const techTier = task.techTiers?.length ? effectiveTechTier(task.techTiers) : getTechTier(state);
  if (!techTier) {
    console.warn(`⚠️ [Plan] Verification task "${task.name}": techTier is null`);
  } else {
    console.log(`🔧 [Plan] Verification techTier: language=${techTier.language}, framework=${techTier.framework || 'none'}`);
  }

  // `state.verification` is the sole SSOT for every verification-owned
  // read (attempts, passed gates, dep status). `initSession` has already
  // run for a verification task by the time `buildPrompt` fires, so the
  // session is normally present; any absence short-circuits the
  // verification-specific vars via `?? undefined`.
  const session = state.verification;

  const depStatus = session?.dependencyStatus() ?? 'unknown';
  let dependencyStatus: string | undefined;
  if (depStatus === 'current') {
    dependencyStatus = 'Dependencies are current. Dependency declaration files are unchanged since last install. Skip dependency installation and proceed directly to build verification.';
  } else if (depStatus === 'changed') {
    dependencyStatus = 'Dependency declaration files have changed since last successful install. Run the project\'s install command before build verification.';
  }

  const packageManager = techTier?.packageManager || state._detectedPackageManager || undefined;

  // Deep-diagnostic mode activates on the 2nd re-entry. We inject config
  // files + a dedicated prompt signal so the LLM breaks out of "same
  // category of fix" loops. Session is the sole authority — the hook
  // never runs without a populated session because `initSession` is
  // called from plan/parts/entry.ts before any hook fires.
  const isDeepDiagnostic = session?.inDeepMode() ?? false;
  let fmtCtx = formatCodeContext(projectCodeContext);
  if (isDeepDiagnostic) {
    const configs = await collectConfigSnapshot(state.context?.featurePath);
    const block = renderConfigBlock(configs);
    if (block) {
      fmtCtx = `${fmtCtx || ''}\n\n${block}`.trim();
      console.log(`🧭 [Plan] Deep-diagnostic injected ${configs.length} config file(s)`);
    }
  }

  let languageHints = '';
  if (techTier?.language) {
    try {
      languageHints = await promptBuilder.render(
        `jobs/code/nodes/plan/variants/verification/basis/techTier/${mapLang(techTier.language)}/hints`,
        {},
      );
    } catch { /* no hints */ }
  }

  // "Already passed" hint so the LLM skips cached steps instead of hitting
  // the codeCommandPolicy rejection to learn the same. Session.passed()
  // is the SSOT once hydrated; legacy tracker is the coexistence bridge.
  const cachedPassedSteps = renderPassedSteps(session?.passed() ?? []);

  const taskTechTiers = task.techTiers?.length
    ? task.techTiers
    : (getTechTier(state) ? [getTechTier(state)!] : []);

  const basisSection = await promptBuilder.renderBasis(
    state.resolvedAction?.basis,
    'code',
    taskTechTiers,
  );

  const body = await promptBuilder.render('jobs/code/nodes/plan/variants/verification/base', {
    taskId: task.id,
    taskName: task.name,
    taskDescription: task.description,
    directive: state.directive || '',
    isErrorTask: false,
    runTests: true,
    projectCodeContext: fmtCtx,
    directoryTree: (projectCodeContext as any)?.directoryTree || '',
    violationsText,
    isRetry: !!violationsText,
    hasTools: options?.hasTools ?? false,
    languageHints,
    hasLanguageHints: !!languageHints,
    dependencyStatus,
    packageManager,
    hasPackageManager: !!packageManager,
    isDeepDiagnostic,
    diagnosticAttempts: session?.attempts() ?? 0,
    cachedPassedSteps,
    resolvedAction: state.resolvedAction,
  });

  return basisSection ? `${basisSection}\n\n---\n\n${body}` : body;
}
