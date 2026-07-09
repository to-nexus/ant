import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { PlanGraphState, getPlanMode } from '../state';
import { CONV_KEYS, getConv, type ConversationKey, type ConversationMessage } from '../../../../common/graph/conversations';
import { applyCompactionToConversation } from '../../../../../core/context';
import type { ConversationCompaction } from '../../../../../core/context';
import { getTargetPath } from './plan/buildSystemPrompt';

/**
 * Prune node history (Anthropic-format ReAct messages) via compactRun.
 * Used both before the LLM call and before session persist.
 */
export async function pruneConversationHistory(
  history: Array<{ role: string; content: any }>,
): Promise<Array<{ role: string; content: any }>> {
  const { compactRun } = await import('../../../../../core/context');
  const { TokenBudgetManager } = await import('../../../../../core/utils/tokenBudget');
  const { PLAN_CONVERSATION_HISTORY_BUDGET } = await import('../../../../../core/context');
  const planTokenManager = new TokenBudgetManager({
    areaBudgets: {
      systemPrompt: 30_000,
      projectContext: 30_000,
      taskContext: 25_000,
      conversationHistory: PLAN_CONVERSATION_HISTORY_BUDGET,
    },
  });
  return compactRun(history as any, planTokenManager).result;
}

export interface SaveConversationOpts {
  /** Which node loop's history to persist (NODE_PLAN for plan, NODE_EXECUTE for execute). */
  nodeKey: ConversationKey;
  responseText: string;
  generatedDocument?: string;
  /** Full ReAct node history for resume support. */
  nodeHistory?: Array<{ role: string; content: any }>;
  compaction?: ConversationCompaction;
  /**
   * When set, persists the clarify-pause flag (+ budget) so the next runner
   * invocation restores RAC + conversations and routes resolve → plan.
   */
  awaitingClarify?: boolean;
  clarifyRoundsUsed?: number;
  clarifyPhase?: import('@ant/shared').ClarifyPhase;
}

/**
 * Save conversation history to the plan session file for multi-turn
 * persistence. Persists SESSION_MAIN (semantic history) + the given node
 * channel (`nodeKey`) for resume, plus the clarify-pause flags.
 *
 * Shared by the `plan` node (NODE_PLAN — clarify pause / explain answer) and
 * the `execute` node (NODE_EXECUTE — final artifact turn). The write is atomic
 * (tmp + rename).
 */
export async function saveConversationToSession(
  state: PlanGraphState,
  opts: SaveConversationOpts,
): Promise<void> {
  const { nodeKey, responseText, generatedDocument, nodeHistory, compaction } = opts;
  const featurePath = state.featurePath;
  const sessionPath = path.join(featurePath, 'sessions/planner/plan.json');

  try {
    const sessionMain = getConv(state.conversations, CONV_KEYS.SESSION_MAIN);
    const updatedConversation: ConversationMessage[] = [...sessionMain];

    if (updatedConversation.length === 0 && state.directive) {
      updatedConversation.push({
        role: 'user',
        content: state.directive,
        timestamp: new Date().toISOString(),
      });
    }

    updatedConversation.push({
      role: 'assistant',
      content: responseText,
      timestamp: new Date().toISOString(),
      metadata: {
        hasArtifact: !!generatedDocument,
        artifactPath: generatedDocument ? getTargetPath(state) : undefined,
        mode: getPlanMode(state),
      },
    });

    let sessionData: any = {};
    try {
      sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    } catch {
      sessionData = {
        sessionId: state._httpJobId || 'plan-session',
        project: process.env.ANT_PROJECT_ID || 'default',
        feature: process.env.ANT_FEATURE_NAME || 'skeleton',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        runs: [],
        artifacts: {},
        state: {},
      };
    }

    if (!sessionData.state) sessionData.state = {};
    if (!sessionData.state.conversations) sessionData.state.conversations = {};
    sessionData.state.conversations[CONV_KEYS.SESSION_MAIN] = applyCompactionToConversation(
      updatedConversation as any,
      compaction,
      (summary) => ({
        role: 'system' as const,
        content: summary,
        timestamp: new Date().toISOString(),
        metadata: { chapterSummary: 'Conversation history summary' },
      }),
    );
    sessionData.state.jobId = state._httpJobId || sessionData.state.jobId;
    sessionData.state.directive = state.directive;
    sessionData.state.overrideDirective = state.overrideDirective;
    sessionData.state.chatSource = state.chatSource;
    sessionData.state.resolvedAction = state.resolvedAction;
    sessionData.state.tokenUsage = state.tokenUsage;
    sessionData.state.jobTiming = state.deps?.stateSnapshot?.jobTiming;
    sessionData.state.recursionCount = state.recursionCount;
    sessionData.state.recursionLimit = state.recursionLimit;
    // Persist the clarify-pause flag so the next runner invocation restores
    // RAC + conversations and routes resolve → plan. Always write so a
    // non-clarify save resets the flag (cannot leave it stale).
    sessionData.state.awaitingClarify = opts.awaitingClarify === true ? true : undefined;
    sessionData.state.clarifyRoundsUsed = opts.clarifyRoundsUsed;
    sessionData.state.clarifyPhase = opts.clarifyPhase;
    if (nodeHistory?.length) {
      try {
        sessionData.state.conversations[nodeKey] = await pruneConversationHistory(nodeHistory);
      } catch {
        sessionData.state.conversations[nodeKey] = nodeHistory;
      }
    }
    sessionData.updatedAt = new Date().toISOString();

    if (state.deps?.stateSnapshot) {
      state.deps.stateSnapshot.conversations = {
        ...state.conversations,
        [nodeKey]: (nodeHistory || getConv(state.conversations, nodeKey)) as ConversationMessage[],
      };
      state.deps.stateSnapshot.directive = state.directive;
      state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
    }

    const sessionDir = path.dirname(sessionPath);
    await fsPromises.mkdir(sessionDir, { recursive: true });
    const tmpPath = `${sessionPath}.tmp`;
    await fsPromises.writeFile(tmpPath, JSON.stringify(sessionData, null, 2), 'utf-8');
    await fsPromises.rename(tmpPath, sessionPath);

    console.log(`💬 [Planner] Conversation saved to ${nodeKey} (${updatedConversation.length} entries, ${nodeHistory?.length || 0} history)`);
  } catch (error: any) {
    console.warn(`⚠️ [Planner] Failed to save conversation: ${error.message}`);
  }
}

/**
 * Writer-fallback safety whitelist (dusk-mounding-pilot). Validates a
 * feature-relative path emitted by the LLM in a `<file>` tag before it is used
 * as the disk-write target when RAC.target is empty.
 */
export function isSafeStagingPath(relPath: string): boolean {
  if (!relPath) return false;
  if (path.isAbsolute(relPath)) return false;
  const normalized = path.normalize(relPath);
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) return false;
  const allowedPrefixes = ['plan/', 'meta/evals/'];
  return allowedPrefixes.some(prefix => normalized.startsWith(prefix));
}
