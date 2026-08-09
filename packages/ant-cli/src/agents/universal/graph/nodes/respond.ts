/**
 * Universal respond node — final response, artifact manifest, session seal.
 *
 * The manifest is CONDITIONAL (D6): a conversation-only turn is a normal
 * termination. Only when real writes happened this run (`_turnToolWrites`,
 * fed by tool side-effects — never by LLM claims) does the node announce
 * the artifact manifest.
 */

import { UNIVERSAL_FEATURE } from '@ant/shared';
import type { UniversalGraphState } from '../state';
import { CONV_KEYS, getConv } from '../../../common/graph/conversations';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { requireActiveCustomJob } from '../../../../core/customAgents/activeCustomJob';

export async function respondNode(state: UniversalGraphState): Promise<Partial<UniversalGraphState>> {
  const chatAPI = getChatAPIClient();
  const resolved = requireActiveCustomJob();
  const writes = Array.from(new Set(state._turnToolWrites ?? []));
  const workflowUpdate = state.deps?.workflowUpdate;

  if (workflowUpdate && state._httpJobId) {
    await workflowUpdate.enterNode(
      state._httpJobId, 'respond', 0,
      undefined, undefined,
      state.recursionCount, state.recursionLimit,
    );
  }

  // 1. Final response delivery (fallback path when not already streamed).
  if (state.response && !state.streamingCompleted) {
    await chatAPI.startMessage();
    await chatAPI.sendLLMEvent({ type: 'text', text: state.response });
    await chatAPI.finalizeMessage();
  } else if (!state.response && !state.streamingCompleted) {
    console.warn('[Universal:Respond] No response to send');
  }

  // 2. Artifact manifest — only when writes happened.
  if (writes.length > 0) {
    const manifest =
      (state.language === 'ko' ? `\n\n📦 **이번 턴 산출물**\n` : `\n\n📦 **Artifacts written this turn**\n`) +
      writes.map((w) => `- \`${w}\``).join('\n');
    await chatAPI.startMessage();
    await chatAPI.sendLLMEvent({ type: 'text', text: manifest });
    await chatAPI.finalizeMessage();
  }

  // 3. Session seal — the conversation IS the job's memory; persist it.
  const session = state.deps?.session;
  if (session && state.projectId) {
    try {
      const sessionState = {
        conversations: { [CONV_KEYS.SESSION_MAIN]: getConv(state.conversations, CONV_KEYS.SESSION_MAIN) },
        tokenUsage: state.tokenUsage,
        tokenUsageByModel: state.tokenUsageByModel,
        executionTier: state.turnContext?.executionTier,
        customJobRef: `${resolved.agentId}/${resolved.jobId}`,
        // Persisted so a resume without a new message keeps its
        // classification (explicit* fields are run-scoped — never sealed).
        // Known degradation: a pause skips this seal, so that resume can
        // demote to ['general'] (same acceptance as universal interruption
        // persistence being a no-op).
        activeIntents: state.turnContext?.intents,
        ...(state._httpJobId && { jobId: state._httpJobId }),
      };
      await session.updateArtifacts(state.projectId, UNIVERSAL_FEATURE, resolved.jobId, { state: sessionState });
      console.log('💾 [Universal:Respond] Session sealed');
    } catch (e) {
      console.warn('⚠️ [Universal:Respond] Session seal failed:', e instanceof Error ? e.message : String(e));
    }
  }

  // 4. Workflow terminal state — respond is universal's terminal node
  //    (learn plays this role in the design job). endJob() also closes any
  //    open history entries, so no separate exitNode is needed here.
  if (workflowUpdate && state._httpJobId) {
    try {
      await workflowUpdate.endJob(state._httpJobId);
    } catch (e) {
      console.warn('⚠️ [Universal:Respond] endJob broadcast failed:', e instanceof Error ? e.message : String(e));
    }
  }

  return {};
}
