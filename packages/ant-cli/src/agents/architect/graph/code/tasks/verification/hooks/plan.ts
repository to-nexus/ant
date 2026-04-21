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
import type { PlanPromptCtx, InitSessionEnv } from '../../_shared/types';
import { effectiveTechTier, getTechTier } from '@ant/shared';
import {
  collectConfigSnapshot,
  renderConfigBlock,
} from '../model/configSnapshot';

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
