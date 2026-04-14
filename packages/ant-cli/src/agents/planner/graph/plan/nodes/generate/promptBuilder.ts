import * as path from 'path';
import { PlanGraphState, getPlanMode } from '../../state';
import { ConversationEntry } from '../../../../../../core/types/session';

/**
 * Format conversation entries for the system prompt.
 * Excludes the last user message (which goes into the messages array).
 */
export function formatConversationForPrompt(conversation: ConversationEntry[]): string {
  if (!conversation || conversation.length === 0) return '';
  
  return conversation.map(entry => {
    if (entry.role === 'system') {
      return `**[Previous context]**: ${entry.content}`;
    }
    const roleLabel = entry.role === 'user' ? 'User' : 'Assistant';
    const artifactNote = entry.metadata?.hasArtifact
      ? ` [produced ${entry.metadata.mode || 'artifact'}]`
      : '';
    const content = entry.role === 'assistant' && entry.content.length > 500
      ? entry.content.substring(0, 500) + '...(truncated)'
      : entry.content;
    return `**${roleLabel}**${artifactNote}: ${content}`;
  }).join('\n\n');
}

/**
 * Derive staging path from resolvedAction.target[0].
 * Convention: outputs/plan/{basename(target)}
 */
export function getStagingPath(state: PlanGraphState): string | undefined {
  const target = state.resolvedAction?.target?.[0];
  if (!target) return undefined;
  return `outputs/plan/${path.basename(target)}`;
}

/**
 * Build system prompt via PromptBuilder pipeline.
 */
export async function buildSystemPrompt(
  state: PlanGraphState,
  compaction: { entries: ConversationEntry[]; summary?: string; wasCompacted: boolean },
): Promise<string> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Planner:Generate] PromptBuilder not available in state.deps');

  const stagingPath = getStagingPath(state);
  const hasTargets = (state.resolvedAction?.target?.length ?? 0) > 0;
  const planMode = getPlanMode(state);

  const resolvedArtifacts = state.resolvedArtifacts || [];

  const result = await promptBuilder.build({
    templates: { base: 'planner/plan/base', rules: 'planner/plan/rules' },
    intent: state.resolvedAction?.intent,
    artifacts: resolvedArtifacts.length > 0 ? resolvedArtifacts : undefined,
    vars: {
      isKorean: state.language === 'ko',
      directive: state.directive,
      mode: planMode,
      hasTargets,
      stagingPath: stagingPath || '',
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
