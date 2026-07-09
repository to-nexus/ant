import { PlanGraphState, getPlanMode } from '../../state';
import type { ConversationMessage } from '../../../../../common/graph/conversations';
import { TEMPLATE_PATHS } from '../../../../../../core/prompt/builder/templatePaths';

/**
 * Format conversation entries for the system prompt.
 * Truncates long assistant messages to keep the prompt bounded.
 */
export function formatConversationForPrompt(conversation: ConversationMessage[]): string {
  if (!conversation || conversation.length === 0) return '';

  return conversation.map(entry => {
    if (entry.role === 'system') {
      return `**[Previous context]**: ${entry.content}`;
    }
    const roleLabel = entry.role === 'user' ? 'User' : 'Assistant';
    const artifactNote = entry.metadata?.hasArtifact
      ? ` [produced ${entry.metadata.mode || 'artifact'}]`
      : '';
    const rawContent = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content);
    const content = entry.role === 'assistant' && rawContent.length > 500
      ? rawContent.substring(0, 500) + '...(truncated)'
      : rawContent;
    return `**${roleLabel}**${artifactNote}: ${content}`;
  }).join('\n\n');
}

/** Return the target path from resolvedAction.target[0] directly. */
export function getTargetPath(state: PlanGraphState): string | undefined {
  return state.resolvedAction?.target?.[0];
}

/**
 * Build the `plan`-node system prompt via the PromptBuilder pipeline.
 *
 * The plan node OBSERVES (codebase / web / live-site), scopes gaps, may
 * clarify, and seals a brief (inside a `<plan>` tag) — it does NOT author the document.
 * The domain overlay (`jobs/plan/domain/{d}.md`) is injected here too because
 * gap analysis + the brief's `proposedOutline` are derived against the
 * document skeleton it defines.
 */
export async function buildPlanSystemPrompt(
  state: PlanGraphState,
  compaction: { entries: ConversationMessage[]; summary?: string; wasCompacted: boolean },
): Promise<{ prompt: string; injectedTemplates: string[]; basisInjected: boolean }> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Planner:Plan] PromptBuilder not available in state.deps');

  const targetPath = getTargetPath(state);
  const hasTargets = (state.resolvedAction?.target?.length ?? 0) > 0;
  const planMode = getPlanMode(state);

  // dusk-mounding-pilot guard — a generate/refactor RAC with an empty target
  // would silently drop the Target-Path section and let the LLM hallucinate a
  // path. Hard-fail loudly instead. `explain` is read-only and has no target.
  if (!targetPath && (planMode === 'generate' || planMode === 'refactor')) {
    throw new Error(
      `[Planner:Plan] resolvedAction.target is empty in ${planMode} mode `
      + `(intent=${state.resolvedAction?.intent ?? 'unknown'}, source=${state.resolvedAction?.source ?? 'unknown'}). `
      + `Refusing to render a Target-Path-less prompt — see detect/index.ts explicit branch fallback.`,
    );
  }

  const resolvedArtifacts = state.resolvedArtifacts || [];

  const result = await promptBuilder.build({
    templates: TEMPLATE_PATHS.plannerPlan,
    intent: state.resolvedAction?.intent,
    artifacts: resolvedArtifacts.length > 0 ? resolvedArtifacts : undefined,
    // D27 / born-dead-overlay guard: the plan node needs the domain overlay
    // (document skeleton) so gap analysis + proposedOutline are grounded.
    // Requires includeBasis + basis + techContext together or the section is
    // silently skipped.
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
      evalReport: state.evalReport || '',
      hasEvalReport: !!state.evalReport,
      rubricContent: state.rubricContent || '',
      hasRubric: !!state.rubricContent && !state.evalReport,
      recentTurnSummaries: state.recentTurnSummaries?.join('\n') || '',
      hasRecentTurns: (state.recentTurnSummaries?.length || 0) > 0,
      conversationContext: formatConversationForPrompt(compaction.entries),
      hasConversation: compaction.entries.length > 0,
      conversationSummary: compaction.summary || '',
      hasConversationSummary: !!compaction.summary,
      resolvedAction: state.resolvedAction,
      // Codebase Channel SSOT — flow workspace state to the codebase-channel
      // partial / AutoInjectionResolver gate.
      workspaceState: state.workspaceState,
    },
  });

  return {
    prompt: [result.user, result.system].filter(Boolean).join('\n\n---\n\n'),
    injectedTemplates: result.injections ?? [],
    basisInjected: !!result.sections?.profiles,
  };
}
