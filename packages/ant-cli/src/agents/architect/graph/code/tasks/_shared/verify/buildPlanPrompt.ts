/**
 * `_shared/verify/buildPlanPrompt` — verify-mode plan prompt builder shared
 * by every verification responsibility holder.
 *
 * SSOT: previously `tasks/verification/hooks/plan.ts::buildPrompt`. Moved
 * here so self-verify Tier 2 tasks render the same diagnostic plan
 * prompt as Tier 3/4 verification tasks once they enter verify-mode.
 *
 * Renders against `jobs/code/nodes/plan/variants/verification/base` with
 * tech-tier-aware language hints, dependency-status injection, deep-
 * diagnostic config snapshot, and cached-passed-step block. The
 * verification-specific `isErrorTask: false` template var is preserved
 * (the template branches on it for header copy).
 *
 * R2 — depends only on `_shared/verify/Session`, `configSnapshot`, and the
 * shared plan prompt helpers.
 */

import type { PlanPromptCtx, PlanPromptResult } from '../types';
import { effectiveTechTier, getTechTier } from '@ant/shared';
import { collectConfigSnapshot, renderConfigBlock } from './configSnapshot';
import { formatCodeContext, mapLang } from '../helpers/planPrompt';
import { AutoInjectionResolver } from '../../../../../../../core/prompt/builder/AutoInjectionResolver';

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
 * Compose the verification-variant plan prompt. Used for both Tier 3/4
 * verification tasks AND Tier 2 self-verify tasks once they enter
 * verify-mode (`composeBundle` dispatches to this when
 * `state._verifyEntered === true`).
 *
 *   - tech-tier resolution + language-hint lookup (silent fallback when the
 *     hint partial does not exist for the detected language);
 *   - dependency-status hint driven by `Session.dependencyStatus()`;
 *   - deep-diagnostic config-snapshot injection on re-entry ≥ threshold;
 *   - cached-passed-step block so the LLM does not re-run gates the
 *     session already considers passed.
 */
export async function buildPrompt(ctx: PlanPromptCtx): Promise<PlanPromptResult> {
  const { state, task, codeContext, violationsText, options, antrulesContent } = ctx;
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Plan] PromptBuilder not available');
  }

  const techTier = task.techTiers?.length ? effectiveTechTier(task.techTiers) : getTechTier(state);
  if (!techTier) {
    console.warn(`⚠️ [Plan] Verify-mode task "${task.name}": techTier is null`);
  } else {
    console.log(`🔧 [Plan] Verify-mode techTier: language=${techTier.language}, framework=${techTier.framework || 'none'}`);
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
  let fmtCtx = formatCodeContext(codeContext);
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
  const { hasFrontend, hasBackend } = AutoInjectionResolver.computeStackFlags(taskTechTiers);

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
    directoryTree: (codeContext as any)?.directoryTree || '',
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
    hasFrontend,
    hasBackend,
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
