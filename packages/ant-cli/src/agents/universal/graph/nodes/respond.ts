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
import { isUnderPlanDir } from '../../../../core/customAgents/universalToolPolicy';

/** Plan-doc listing cap shared with resolve's PLAN_DOCS_MAX. */
const PLAN_CARD_FILES_MAX = 20;

/**
 * Plan-dir writes eligible for the plan_complete CTA, or null when the card
 * must not be offered. Deterministic on sealed state only: `turnContext`
 * (resolve is the single writer), `_turnToolWrites` (tool side-effects, never
 * LLM claims), and the clarify-pause marker — no LLM judgment.
 */
export function planCompleteCardWrites(
  state: Pick<UniversalGraphState, 'turnContext' | '_clarifyPause' | '_turnToolWrites'>,
): string[] | null {
  if (state.turnContext?.planTurn !== true) return null;
  if (state._clarifyPause) return null; // the clarify card IS the reply
  const planWrites = Array.from(new Set(state._turnToolWrites ?? [])).filter(isUnderPlanDir);
  return planWrites.length > 0 ? planWrites : null;
}

/**
 * Plan-complete CTA — the universal analog of the design job's
 * `emitSpecCompleteCard`. Offers to continue the work from the plan just
 * written (proceed / review-and-edit / keep planning / later); the FE variant
 * owns all four behaviors, resolution is a pure audit line. Log-and-swallow:
 * the CTA is the turn's last chat signal and never aborts the terminal node.
 */
async function emitPlanCompleteCard(state: UniversalGraphState, planWrites: string[]): Promise<void> {
  try {
    const resolved = requireActiveCustomJob();
    const chatAPI = getChatAPIClient();
    const fileSystem = state.deps?.fileSystem;
    const isKo = state.language === 'ko';

    // Defense-in-depth: never offer a card on a plan file that isn't on disk
    // (a later tool call in the same run may have deleted it).
    const planFiles: string[] = [];
    for (const p of planWrites) {
      const exists = fileSystem ? await fileSystem.fileExists(p).catch(() => false) : false;
      if (exists) planFiles.push(p);
      if (planFiles.length >= PLAN_CARD_FILES_MAX) break;
    }
    if (planFiles.length === 0) {
      console.error('❌ [Universal:Respond] Plan-complete card suppressed: no written plan file exists on disk');
      return;
    }

    const turnContext = state.turnContext!;
    await chatAPI.sendChoiceCard({
      type: 'plan_complete',
      title: isKo ? '계획 수립 완료' : 'Plan Complete',
      choices: [
        {
          id: 'proceed',
          label: isKo ? '이 계획대로 진행' : 'Proceed with this plan',
          action: 'redirect',
          data: {
            planFiles,
            customJobRef: `${resolved.agentId}/${resolved.jobId}`,
            intents: turnContext.intents,
            intentSource: turnContext.source,
          },
        },
        { id: 'edit', label: isKo ? '검토 후 수정해서 진행' : 'Review & edit before proceeding', action: 'prefill' },
        { id: 'keep_planning', label: isKo ? '계획 계속 다듬기' : 'Keep planning', action: 'prefill' },
        { id: 'later', label: isKo ? '나중에' : 'Later', action: 'dismiss' },
      ],
    });
  } catch (e) {
    console.error('❌ [Universal:Respond] Plan-complete card emit failed:', e instanceof Error ? e.message : String(e));
  }
}

export async function respondNode(state: UniversalGraphState): Promise<Partial<UniversalGraphState>> {
  const chatAPI = getChatAPIClient();
  const resolved = requireActiveCustomJob();
  const writes = Array.from(new Set(state._turnToolWrites ?? []));
  const workflowUpdate = state.deps?.workflowUpdate;
  // This turn's checklist, or the restored one carried through unchanged
  // (a turn that never re-emits keeps the prior list alive in the seal).
  const checklist = state.turnChecklist ?? state.restoredChecklist;

  if (workflowUpdate && state._httpJobId) {
    await workflowUpdate.enterNode(
      state._httpJobId, 'respond', 0,
      undefined, undefined,
      state.recursionCount, state.recursionLimit,
    );
  }

  // 1. Final response delivery (fallback path when not already streamed).
  //    A clarify pause skips this entirely — the clarify card IS the reply.
  if (state._clarifyPause) {
    // no-op
  } else if (state.response && !state.streamingCompleted) {
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

  // 2.5. Plan-complete CTA — only when this plan turn actually wrote plan
  //      docs (deterministic gate). Emitted after the manifest so the CTA is
  //      the turn's last chat line; before the seal so a seal failure can't
  //      swallow it.
  const planWrites = planCompleteCardWrites(state);
  if (planWrites) {
    await emitPlanCompleteCard(state, planWrites);
  }

  // 3. Session seal — the conversation IS the job's memory; persist it.
  const session = state.deps?.session;
  if (session && state.projectId) {
    try {
      const sessionState = {
        conversations: { [CONV_KEYS.SESSION_MAIN]: getConv(state.conversations, CONV_KEYS.SESSION_MAIN) },
        tokenUsage: state.tokenUsage,
        tokenUsageByModel: state.tokenUsageByModel,
        customJobRef: `${resolved.agentId}/${resolved.jobId}`,
        // Persisted so continuation turns update the same list instead of
        // recreating it. Known degradation: a pause skips this seal (same
        // acceptance as universal interruption persistence being a no-op).
        ...(checklist && { checklist }),
        ...(state._httpJobId && { jobId: state._httpJobId }),
        // Clarify markers — I2-compatible shape: `awaitingClarify` is a
        // STRICT BOOLEAN (JobCleanupManager checks `=== true`), id/question
        // ride as separate fields. Omitted on non-paused seals, so a stale
        // marker self-clears at the next seal. Rounds always seal (budget).
        clarifyRoundsUsed: state.clarifyRoundsUsed ?? 0,
        ...(state._clarifyPause && {
          awaitingClarify: true,
          clarifyToolUseId: state._clarifyPause.toolUseId,
          clarifyQuestion: state._clarifyPause.question,
          // Clarify continuity: the RESOLVED turn context survives the pause
          // so the answer turn re-runs under the same intents/@ctx/plan
          // confinement. Rides only the paused seal — self-clears at the
          // next non-paused seal, exactly like the markers above.
          ...(state.turnContext && { clarifyTurnContext: state.turnContext }),
        }),
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
