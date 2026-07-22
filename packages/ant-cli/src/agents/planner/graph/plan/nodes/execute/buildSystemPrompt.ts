import { PlanGraphState, getPlanMode } from '../../state';
import { TEMPLATE_PATHS } from '../../../../../../core/prompt/builder/templatePaths';
import type { PromptBuildResult } from '../../../../../../core/prompt/builder/PromptBuildConfig';
import { getTargetPath } from '../plan/buildSystemPrompt';

/**
 * Build the `execute`-node system prompt via the PromptBuilder pipeline.
 *
 * The execute node AUTHORS the document from `directive + planText` on a fresh
 * NODE_EXECUTE channel — the plan-loop research transcript is severed. This
 * prompt carries the Output Protocol (`<file>` / `edit_file`), document quality
 * rules, and the domain-overlay document skeleton — but NOT the codebase
 * "MUST inspect" observation block (that was the plan node's job).
 *
 * Same born-dead-overlay guard as the plan builder: `includeBasis` + `basis`
 * + `techContext` must all be present or the document-skeleton overlay is
 * silently skipped.
 */
export async function buildExecuteSystemPrompt(
  state: PlanGraphState,
): Promise<{ prompt: string; result: PromptBuildResult; injectedTemplates: string[]; basisInjected: boolean }> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Planner:Execute] PromptBuilder not available in state.deps');

  const targetPath = getTargetPath(state);
  const targetPaths = state.resolvedAction?.target ?? [];
  const hasTargets = targetPaths.length > 0;
  const hasMultipleTargets = targetPaths.length > 1;
  const planMode = getPlanMode(state);

  // dusk-mounding-pilot guard — never render a Target-Path-less authoring prompt.
  if (!targetPath && (planMode === 'generate' || planMode === 'refactor')) {
    throw new Error(
      `[Planner:Execute] resolvedAction.target is empty in ${planMode} mode `
      + `(intent=${state.resolvedAction?.intent ?? 'unknown'}). Refusing to render a Target-Path-less prompt.`,
    );
  }

  const resolvedArtifacts = state.resolvedArtifacts || [];

  const result = await promptBuilder.build({
    templates: TEMPLATE_PATHS.plannerExecute,
    intent: state.resolvedAction?.intent,
    artifacts: resolvedArtifacts.length > 0 ? resolvedArtifacts : undefined,
    // Domain overlay (document skeleton) drives authoring — same born-dead
    // guard as the plan node: needs includeBasis + basis + techContext together.
    pipeline: {
      includeBasis: true,
    },
    basis: state.resolvedAction?.basis,
    techContext: {
      resolvedAction: state.resolvedAction,
    },
    vars: {
      isKorean: state.language === 'ko',
      directive: state.directive,
      mode: planMode,
      hasTargets,
      targetPath: targetPath || '',
      // Multi-file plan output — the sealed brief may split the plan into
      // several MECE docs under `plan/`. `targetPaths` is the full list; the
      // template lists them and instructs one `<file>` per file when >1.
      targetPaths,
      hasMultipleTargets,
      // The sealed brief from the plan node — the authoring anchor. Rendered
      // under `{{#if planText}}` in the execute base template.
      planText: state.planText || '',
      hasPlanText: !!state.planText && state.planText.trim().length > 0,
      resolvedAction: state.resolvedAction,
    },
  });

  return {
    prompt: [result.user, result.system].filter(Boolean).join('\n\n---\n\n'),
    result,
    injectedTemplates: result.injections ?? [],
    basisInjected: !!result.sections?.profiles,
  };
}
