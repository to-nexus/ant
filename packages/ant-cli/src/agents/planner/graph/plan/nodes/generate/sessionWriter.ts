import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { PlanGraphState, getPlanMode } from '../../state';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../../../../common/graph/conversations';
import { applyCompactionToConversation } from '../../../../../../core/context';
import type { ConversationCompaction } from '../../../../../../core/context';
import { getTargetPath } from './promptBuilder';

/**
 * Prune node history (Anthropic-format ReAct messages) via compactRun.
 * Used both before LLM call and before session persist.
 */
export async function pruneConversationHistory(
  history: Array<{ role: string; content: any }>,
): Promise<Array<{ role: string; content: any }>> {
  const { compactRun } = await import('../../../../../../core/context');
  const { TokenBudgetManager } = await import('../../../../../../core/utils/tokenBudget');
  const { PLAN_CONVERSATION_HISTORY_BUDGET } = await import('../../../../../../core/context');
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

/**
 * Save conversation history to session file for multi-turn persistence.
 * 
 * On first run: adds user directive + assistant response.
 * On continuation: adds assistant response (user message was already appended by resolve).
 * 
 * Also saves node history (full LLM messages) for resume support.
 */
export async function saveConversationToSession(
  state: PlanGraphState,
  responseText: string,
  generatedDocument: string | undefined,
  currentConversationHistory?: Array<{ role: string; content: any }>,
  compaction?: ConversationCompaction,
): Promise<void> {
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
    
    if (!sessionData.state) {
      sessionData.state = {};
    }
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
    if (currentConversationHistory?.length) {
      try {
        sessionData.state.conversations[CONV_KEYS.NODE_GENERATE] = await pruneConversationHistory(currentConversationHistory);
      } catch {
        sessionData.state.conversations[CONV_KEYS.NODE_GENERATE] = currentConversationHistory;
      }
    }
    sessionData.updatedAt = new Date().toISOString();
    
    if (state.deps?.stateSnapshot) {
      state.deps.stateSnapshot.conversations = {
        ...state.conversations,
        [CONV_KEYS.NODE_GENERATE]: (currentConversationHistory || getConv(state.conversations, CONV_KEYS.NODE_GENERATE)) as ConversationMessage[],
      };
      state.deps.stateSnapshot.directive = state.directive;
      state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
    }
    
    const sessionDir = path.dirname(sessionPath);
    await fsPromises.mkdir(sessionDir, { recursive: true });
    const tmpPath = `${sessionPath}.tmp`;
    await fsPromises.writeFile(tmpPath, JSON.stringify(sessionData, null, 2), 'utf-8');
    await fsPromises.rename(tmpPath, sessionPath);
    
    console.log(`💬 [Planner:Generate] Conversation saved (${updatedConversation.length} entries, ${currentConversationHistory?.length || 0} history)`);
  } catch (error: any) {
    console.warn(`⚠️ [Planner:Generate] Failed to save conversation: ${error.message}`);
  }
}
