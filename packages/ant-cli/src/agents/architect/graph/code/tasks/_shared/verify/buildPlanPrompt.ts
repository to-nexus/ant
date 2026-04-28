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
import { workspaceDepSnapshotVars } from '../helpers/workspaceDepSnapshotHook';
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
 * Compress a single plan body into a 2~5 line summary for the verify-mode
 * plan prompt. Used to surface in-task plan history (the carrier the
 * cycle-N+1 plan LLM otherwise lacks — `Session.planHistoryBodies()` is
 * non-empty but not previously rendered into the prompt).
 *
 * Extracts only `task.goal`, `diagnostics.rootCauses[].cause`, and the
 * `implementation.modify[].target` (plus `batches[].modify[].target` for
 * Format B plans) — full bodies are excluded to keep the surface bounded.
 *
 * Returns a parse-failure stub when the body is not valid JSON; the
 * prompt explicitly tells the LLM that an unparseable attempt should
 * still be treated as "previously tried" rather than a clean slate.
 *
 * Exported for unit tests (`tests/tasks/verification/priorPlans.test.ts`).
 * Not part of the public API.
 */
export function summarizePlanBody(body: string, attemptIndex: number): string | null {
  if (!body) return null;
  let parsed: any;
  try {
    const stripped = body.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
    parsed = JSON.parse(stripped);
  } catch {
    return `- **Attempt ${attemptIndex}**: (plan body could not be parsed as JSON; ${body.length} chars in history — treat as a prior attempt with unknown specifics)`;
  }

  const goal: string = parsed?.task?.goal ?? '(no goal)';
  const rootCauses: string[] = Array.isArray(parsed?.diagnostics?.rootCauses)
    ? parsed.diagnostics.rootCauses
        .map((rc: any) => rc?.cause)
        .filter((c: unknown): c is string => typeof c === 'string' && c.length > 0)
        .map((c: string) => (c.length > 240 ? c.slice(0, 240) + '…' : c))
    : [];

  const modifyTargets = new Set<string>();
  if (Array.isArray(parsed?.implementation?.modify)) {
    for (const m of parsed.implementation.modify) {
      if (typeof m?.target === 'string') modifyTargets.add(m.target);
    }
  }
  if (Array.isArray(parsed?.batches)) {
    for (const b of parsed.batches) {
      if (Array.isArray(b?.modify)) {
        for (const m of b.modify) {
          if (typeof m?.target === 'string') modifyTargets.add(m.target);
        }
      }
    }
  }

  const lines: string[] = [`- **Attempt ${attemptIndex}** — goal: ${goal}`];
  for (const cause of rootCauses) {
    lines.push(`  - Root cause: ${cause}`);
  }
  if (modifyTargets.size > 0) {
    lines.push(`  - Modified: ${[...modifyTargets].join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Render the prior-plan attempts block. Receives the bounded buffer
 * `Session.planHistoryBodies()` (newest last, capped at
 * `PLAN_HISTORY_BODY_LIMIT = 3`) and returns a markdown bullet list with
 * one entry per prior plan body.
 *
 * SSOT for the cycle-N+1 plan LLM's view of "what I already tried" —
 * deliberately complements (not replaces) `renderSessionSummary` (which
 * carries scalar attempt counters). Without this carrier the LLM sees
 * only `attempts: N` and re-discovers the same fix space from scratch
 * each cycle — the cascade pattern observed in `misty-filling-rivet`.
 *
 * Returns `undefined` when the buffer is empty or every body fails the
 * summarizer — the template `{{#if hasPriorPlans}}` block then stays
 * silent on the first cycle.
 *
 * Exported for unit tests (`tests/tasks/verification/priorPlans.test.ts`).
 * Not part of the public API.
 */
export function renderPriorPlans(bodies: readonly string[]): string | undefined {
  if (!bodies || bodies.length === 0) return undefined;
  const lines: string[] = [];
  bodies.forEach((body, idx) => {
    const summary = summarizePlanBody(body, idx + 1);
    if (summary) lines.push(summary);
  });
  if (lines.length === 0) return undefined;
  return lines.join('\n\n');
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

  // Prior-plan attempts in this same task — the carrier the cycle-N+1
  // plan LLM otherwise lacks. `Session.planHistoryBodies()` already
  // accumulates the bounded buffer; this exposes a compressed (root
  // cause + modify targets) view to the prompt so the LLM can detect
  // its own cascade pattern. Distinct from postmortem §4.1's removed
  // narrative — that channel embedded *prior tasks'* prePlanText into
  // the prompt (cross-task leak); this one is *same-task* attempt
  // history bounded by `PLAN_HISTORY_BODY_LIMIT` and is the only
  // signal the cycle-N+1 LLM has when static gates produce no new
  // violations (runtime-bug scenario, e.g. `misty-filling-rivet`).
  const priorPlans = renderPriorPlans(session?.planHistoryBodies() ?? []);

  const taskTechTiers = task.techTiers?.length
    ? task.techTiers
    : (getTechTier(state) ? [getTechTier(state)!] : []);
  const { hasFrontend, hasBackend } = AutoInjectionResolver.computeStackFlags(taskTechTiers);

  const _verifySlot = state.resolvedAction?.intent
    ? (await import('@ant/shared')).getConfigSlots(state.resolvedAction.intent)?.basis
    : undefined;
  const basisSection = await promptBuilder.renderBasis(
    state.resolvedAction?.basis,
    'code',
    taskTechTiers,
    state.resolvedAction?.domain,
    _verifySlot,
  );

  const depSnapshot = await workspaceDepSnapshotVars(ctx);

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
    priorPlans,
    hasPriorPlans: !!priorPlans,
    priorPlanCount: session?.planHistoryBodies().length ?? 0,
    antrulesContent,
    resolvedAction: state.resolvedAction,
    hasFrontend,
    hasBackend,
    ...depSnapshot,
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
      hasPriorPlans: !!priorPlans,
      priorPlanCount: session?.planHistoryBodies().length ?? 0,
      batchSplitCount: session?.batchSplitCount() ?? 0,
      hasWorkspaceDepSnapshot: depSnapshot.hasWorkspaceDepSnapshot,
    },
  };
}
