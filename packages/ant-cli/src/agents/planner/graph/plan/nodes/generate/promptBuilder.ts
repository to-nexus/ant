import { PlanGraphState, getPlanMode } from '../../state';
import type { ConversationMessage } from '../../../../../common/graph/conversations';

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

  const resolvedArtifacts = state.resolvedArtifacts || [];

  const result = await promptBuilder.build({
    templates: { base: 'jobs/plan/nodes/plan/variants/default/base', rules: 'jobs/plan/nodes/plan/variants/default/rules' },
    intent: state.resolvedAction?.intent,
    artifacts: resolvedArtifacts.length > 0 ? resolvedArtifacts : undefined,
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
    },
  });

  return [result.user, result.system].filter(Boolean).join('\n\n---\n\n');
}
