/**
 * verification/hooks/plan.ts — TaskPlanHook implementation.
 *
 * Translates the plan-node's verification-specific branches into Session API
 * calls. Hooks supplied:
 *
 *   - `initSession(state, env)`    — idempotent merge-aware Session creation
 *                                    at plan-node entry (fresh / seed-only
 *                                    metadata / fully rehydrated).
 *   - `buildPrompt(ctx)`           — renders the verification-variant plan
 *                                    prompt (`jobs/code/nodes/plan/variants/
 *                                    verification/base`) with tech-tier-aware
 *                                    dependency / deep-diagnostic / cached-pass
 *                                    injections. Ported from
 *                                    `nodes/plan/planGeneration.ts` L95~148
 *                                    as part of T6b-β.
 *
 * Attempt-counter bookkeeping (`session.onPlanEntry(reason)`) and plan-entry
 * classification (`state._nextPlanEntry`) are called directly by the phase
 * layer in `nodes/plan/parts/entry.ts` (`handleRetryEntry`, `handleReverifyEntry`,
 * `resolvePlanEntry`). Earlier drafts routed both through extra `onEntry` /
 * `classifyEntry` hook slots, but the phase layer already holds the Session
 * reference and the router-set `_nextPlanEntry` signal, so the indirection
 * produced dead surface. Those slots were retired in the T11 post-review
 * consistent with the T7/T8 follow-ups that removed `attachSnapshot` /
 * `captureOnFailure` and `decideOutcome` / `maybeSplit` / `makeTerminalError`.
 *
 * Termination decisions (`VerificationTerminalError` throws for
 * `max_retries_exceeded` / `batch_cycle_limit` / `unresolved_violations`)
 * remain at the phase layer (`nodes/plan/parts/entry.ts`,
 * `nodes/plan/parts/batchSplit.ts`, `parallel/TaskWorker.ts`) where the
 * surrounding control flow lives.
 *
 * R2 compliance — the hook's verdicts come from its own `model/` (Session,
 * errors). Prompt-rendering helpers (`collectConfigSnapshot`,
 * `renderConfigBlock`) also live under `model/configSnapshot` as of T9.
 * No imports from `nodes/`, `routers/`, or `parallel/`.
 */

import type { ArchitectGraphState } from '../../../state';
import { VerificationSession } from '../model/Session';
import type { PlanPromptCtx, InitSessionEnv, PlanPromptResult } from '../../_shared/types';
import { effectiveTechTier, getTechTier } from '@ant/shared';
import {
  collectConfigSnapshot,
  renderConfigBlock,
} from '../model/configSnapshot';
import { formatCodeContext, mapLang } from '../../_shared/helpers/planPrompt';
import { VerificationTerminalError } from '../model/errors';

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
 *     `hydrateEnv` while preserving attempts, history, installNeeded, etc.
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

/** Trailing identical-plan count that marks the LLM as stuck. */
const NO_PROGRESS_STREAK = 2;

/**
 * Verification's retry terminator. Returns `no_progress` when the just-failed
 * plan matches the trailing plan-history streak; `null` continues the loop.
 * Runaway is bounded by `state.recursionLimit` at the routing layer.
 *
 * Empty-plan coverage: `state.planText === ''` is a legitimate input here.
 * The plan-phase LLM sometimes emits `<done>true</done>` with no `<plan>`
 * block mid-retry — a protocol-violation "silent give-up" that used to
 * evade termination because the old `!state.planText` early-return bailed
 * out before the hash comparison. Empty strings now flow through
 * `isPlanRepeated` and hash to a stable value, so two consecutive empties
 * register as a repeated-plan streak and throw `no_progress` through the
 * same channel that catches verbatim repeated plans.
 */
export function checkRetryTermination(
  state: ArchitectGraphState,
): VerificationTerminalError | null {
  const session = state.verification;
  if (!session) return null;

  const repeat = session.isPlanRepeated(state.planText ?? '');
  if (repeat.count >= NO_PROGRESS_STREAK) {
    const planDesc = state.planText ? `the same plan` : `an empty plan`;
    return new VerificationTerminalError(
      'no_progress',
      `Task "${state.currentTask?.name ?? 'verification'}" stuck: the LLM produced ${planDesc} ${repeat.count} times in a row.`,
      session.snapshot(),
    );
  }
  return null;
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

/**
 * Compact session-state banner rendered at the top of the verification
 * plan prompt when the task has already attempted remediation or
 * batch-split at least once. Replaces the verbose
 * `buildDiagnosticRetryContext` narrative that used to embed completed
 * error sub-tasks' prePlanText and the full planHistoryBodies buffer
 * (removed per postmortem §4.1). Three principles drive the copy:
 *
 *   1. Scalar summary only — attempts / passed / missing gates /
 *      batch-split count. Details live on disk (`sessions/architect/code.json`)
 *      and are fetched on demand by the LLM.
 *   2. Points the LLM at self-service lookup when it suspects cascading
 *      failure — the rules-level Prior-Attempt Lookup principle tells
 *      it HOW to call `read_file`.
 *   3. No task-specific internals — keeps the surface blind to
 *      individual error sub-tasks' fix content.
 *
 * Returns `undefined` on the first attempt so the banner stays silent
 * when there is nothing to report.
 */
function renderSessionSummary(
  session: { attempts(): number; passed(): readonly string[]; missing(): readonly string[]; batchSplitCount(): number } | undefined,
): string | undefined {
  if (!session) return undefined;
  const attempts = session.attempts();
  const batchSplits = session.batchSplitCount();
  if (attempts === 0 && batchSplits === 0) return undefined;

  const passed = session.passed();
  const missing = session.missing();
  const parts: string[] = [];
  parts.push(`- Diagnostic attempts so far: ${attempts}`);
  parts.push(`- Passed gates: ${passed.length > 0 ? passed.join(', ') : 'none'}`);
  parts.push(`- Outstanding gates: ${missing.length > 0 ? missing.join(', ') : 'none'}`);
  if (batchSplits > 0) parts.push(`- Prior batch-split cycles: ${batchSplits}`);
  return parts.join('\n');
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
export async function buildPrompt(ctx: PlanPromptCtx): Promise<PlanPromptResult> {
  const { state, task, projectCodeContext, violationsText, options, antrulesContent } = ctx;
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
    dependencyStatus = 'Observation: every declared `package.json` dependency is present in `node_modules`.';
  } else if (depStatus === 'changed') {
    dependencyStatus = 'Observation: one or more declared `package.json` dependencies are missing from `node_modules`.';
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

  // Scalar retry-banner: one-line status drawn from Session. Replaces the
  // removed `buildDiagnosticRetryContext` narrative (postmortem §4.1).
  const sessionSummary = renderSessionSummary(session);

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
    sessionSummary,
    hasSessionSummary: !!sessionSummary,
    antrulesContent,
    resolvedAction: state.resolvedAction,
  });

  const text = basisSection ? `${basisSection}\n\n---\n\n${body}` : body;
  return {
    text,
    vars: {
      dependencyStatusKind: depStatus,
      dependencyStatus: dependencyStatus ? `[${dependencyStatus.length} chars]` : undefined,
      packageManager,
      hasPackageManager: !!packageManager,
      cachedPassedStepsRendered: !!cachedPassedSteps,
      cachedPassedStepsCount: session?.passed().length ?? 0,
      isDeepDiagnostic,
      diagnosticAttempts: session?.attempts() ?? 0,
      hasLanguageHints: !!languageHints,
      hasViolationsText: !!violationsText,
      violationsTextLen: violationsText?.length ?? 0,
      hasSessionSummary: !!sessionSummary,
      batchSplitCount: session?.batchSplitCount() ?? 0,
    },
  };
}
