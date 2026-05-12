/**
 * `_shared/verify/prompt/buildPlanPrompt` — verify-mode plan prompt builder shared
 * by every verification responsibility holder.
 *
 * Renders against `jobs/code/nodes/plan/variants/verification/base` with
 * tech-tier-aware language hints, dependency-status injection drawn from
 * `state._installNeededTransient`, prior-error-tasks awareness, and a
 * scalar batch-split banner.
 *
 * R2 — depends only on the shared plan prompt helpers + state shape.
 */

import type { PlanPromptCtx, PlanPromptResult } from '../../types';
import { effectiveTechTier, getTechTier } from '@ant/shared';
import { formatCodeContext, mapLang } from '../../helpers/planPrompt';
import { workspaceDepSnapshotVars } from '../../helpers/workspaceDepSnapshotHook';
import { AutoInjectionResolver } from '../../../../../../../../core/prompt/builder/AutoInjectionResolver';
import { renderPriorErrorTasks } from './priorErrorTasks';
import { containsRuntimeErrorPattern } from '../../../../../../../../core/utils/runtimeErrorPattern';

/**
 * Compact verification banner. Always rendered (the absence of a banner
 * was the `vast-curling-perch` cycle-2 incident root cause), even on
 * cycle-1 fresh entry. Drawn from `task.batchSplitCount` so the cycle
 * carry-over is durable across re-queue boundaries.
 */
function renderSessionSummary(batchSplits: number): string {
  return `- Prior batch-split cycles: ${batchSplits}`;
}

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

  const installNeededTransient = state._installNeededTransient;
  const depStatus: 'current' | 'changed' | 'unknown' =
    installNeededTransient === false ? 'current'
    : installNeededTransient === true ? 'changed'
    : 'unknown';
  let dependencyStatus: string | undefined;
  if (depStatus === 'current') {
    dependencyStatus = 'Observation: every declared `package.json` dependency is present in `node_modules`.';
  } else if (depStatus === 'changed') {
    dependencyStatus = 'Observation: one or more declared `package.json` dependencies are missing from `node_modules`.';
  }

  const packageManager = techTier?.packageManager || state._detectedPackageManager || undefined;

  const fmtCtx = formatCodeContext(codeContext);

  let languageHints = '';
  if (techTier?.language) {
    try {
      languageHints = await promptBuilder.render(
        `jobs/code/nodes/plan/variants/verification/basis/techTier/${mapLang(techTier.language)}/hints`,
        {},
      );
    } catch { /* no hints */ }
  }

  const batchSplitCount = (task as { batchSplitCount?: number }).batchSplitCount ?? 0;
  const sessionSummary = renderSessionSummary(batchSplitCount);

  // Prior error sub-tasks spawned in this verification cycle. Injected so
  // the LLM avoids regression-by-repetition without a read_file lookup.
  const priorErrorTasks = renderPriorErrorTasks(state);

  // Directive-grounding flag — true when this verification cycle was
  // initiated by a user-reported runtime error directive OR when prior
  // error sub-tasks ran in this cycle. Both signals indicate that
  // `state.directive` carries the original failing scenario the
  // verification must close against. The verification base template
  // gates the "Cross-reference User Report" + reproducer requirement on
  // this flag (replaces the legacy hard-coded `isErrorTask: false`).
  const hasUserRuntimeErrorContext =
    containsRuntimeErrorPattern(state.directive) ||
    (priorErrorTasks?.length ?? 0) > 0;

  const taskTechTiers = task.techTiers?.length
    ? task.techTiers
    : (getTechTier(state) ? [getTechTier(state)!] : []);
  const { hasFrontend, hasBackend } = AutoInjectionResolver.computeStackFlags(taskTechTiers);

  // Service Virtualization parity guidance fires only inside verify-mode
  // when business external dependencies exist. The parity hook
  // (`tasks/_shared/verify/parity/`) emits retryable violations on adapter
  // shape divergence — surfacing the partial here teaches the LLM how to
  // root-cause them on the next plan cycle.
  const parityActive = state.virtualizationSnapshot?.hasBusinessConnection === true;

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
    // See `nodes/plan/llm/prompt.ts` — same response-language SSOT plumbing.
    userLanguage: state.context?.userLanguage || 'en',
    hasUserRuntimeErrorContext,
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
    sessionSummary,
    hasSessionSummary: true,
    priorErrorTasks,
    antrulesContent,
    resolvedAction: state.resolvedAction,
    hasFrontend,
    hasBackend,
    // Reproducer permission gates on the same SSOT flag — persistent
    // processes are unlocked iff this verification cycle is grounded by a
    // user-reported runtime error (initial directive OR prior error
    // sub-tasks present).
    allowPersistentProcesses: hasUserRuntimeErrorContext,
    parityActive,
    // Tier 3 cross-task analysis brief (sealed by Decompose).
    analysis: state.analysis ?? '',
    hasAnalysis: !!state.analysis,
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
      hasLanguageHints: !!languageHints,
      hasViolationsText: !!violationsText,
      violationsTextLen: violationsText?.length ?? 0,
      hasSessionSummary: true,
      batchSplitCount,
      priorErrorTasksCount: priorErrorTasks?.length ?? 0,
      hasUserRuntimeErrorContext,
      hasWorkspaceDepSnapshot: depSnapshot.hasWorkspaceDepSnapshot,
      parityActive,
    },
  };
}
