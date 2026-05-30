import { PlanGraphState, getPlanMode } from '../../state';
import type { ConversationMessage } from '../../../../../common/graph/conversations';
import { TEMPLATE_PATHS } from '../../../../../../core/prompt/builder/templatePaths';

/**
 * Format conversation entries for the system prompt.
 * Excludes the last user message (which goes into the messages array).
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

/**
 * Return the target path from resolvedAction.target[0] directly.
 */
export function getTargetPath(state: PlanGraphState): string | undefined {
  return state.resolvedAction?.target?.[0];
}

/**
 * Build system prompt via PromptBuilder pipeline.
 */
export async function buildSystemPrompt(
  state: PlanGraphState,
  compaction: { entries: ConversationMessage[]; summary?: string; wasCompacted: boolean },
): Promise<string> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Planner:Generate] PromptBuilder not available in state.deps');

  const targetPath = getTargetPath(state);
  const hasTargets = (state.resolvedAction?.target?.length ?? 0) > 0;
  const planMode = getPlanMode(state);

  // dusk-mounding-pilot guard — the detect explicit branch now always
  // populates a default target via the matrix, but if a future caller
  // produces a generate/refactor RAC with an empty `target`, the prompt
  // would silently drop the "Target Path" section and the LLM would
  // hallucinate a path (last regression: `architecture/system/main.md`).
  // Hard-fail loudly here instead of producing a degraded prompt.
  // `explain` mode is read-only and legitimately has no target.
  if (!targetPath && (planMode === 'generate' || planMode === 'refactor')) {
    throw new Error(
      `[Planner:Generate] resolvedAction.target is empty in ${planMode} mode `
      + `(intent=${state.resolvedAction?.intent ?? 'unknown'}, source=${state.resolvedAction?.source ?? 'unknown'}). `
      + `Refusing to render a Target-Path-less prompt — see detect/index.ts explicit branch fallback.`,
    );
  }

  const resolvedArtifacts = state.resolvedArtifacts || [];

  const result = await promptBuilder.build({
    templates: TEMPLATE_PATHS.plannerPlan,
    intent: state.resolvedAction?.intent,
    artifacts: resolvedArtifacts.length > 0 ? resolvedArtifacts : undefined,
    // Phase 1 (F-1) + D27: plan generate must opt into basis injection so
    // `buildBasisSection` runs. That section now layers
    // `templates/domain/{d}.md` (identity, D27) +
    // `templates/jobs/plan/domain/{d}.md` (GDD/PRD skeleton overlay) on top
    // of the active tier set, in addition to any plan-overlay tiers
    // (gameContentTier, etc.). Without `includeBasis: true` + `basis` +
    // `techContext`, the section is silently skipped and plan-overlay
    // templates are dead code.
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
      // Codebase Channel SSOT — flow workspace state to the
      // codebase-channel partial / AutoInjectionResolver gate.
      workspaceState: state.workspaceState,
    },
  });

  return [result.user, result.system].filter(Boolean).join('\n\n---\n\n');
}
