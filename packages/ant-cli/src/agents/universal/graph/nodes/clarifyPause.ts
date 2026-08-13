/**
 * Clarify pause node — end-and-resume, universal side.
 *
 * Reached only when the round's SOLE pending tool call is an allowed
 * `clarify` (the tool.ts wrapper enforces that predicate; every other
 * clarify emission gets an instructive gateCall rejection instead).
 *
 * The pause is a NORMAL job completion: no tool_result is appended, so
 * session:main's tail stays the dangling assistant `tool_use('clarify')`
 * that respond seals and the next turn's runner closes with the user's
 * reply as its tool_result. No worker slot or BullMQ lock outlives the turn.
 */

import type { UniversalGraphState } from '../state';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { clarifyBlockFromArgs } from '../../../common/clarify/tool';
import { sendClarify } from '../../../common/clarify/transport';
import { getOrCreateUniversalTurnStreaming } from '../runtime';

/**
 * Returns null on invalid args — the caller falls through to the inner
 * factory node so the model receives the uniform gateCall rejection.
 */
export async function clarifyPauseNode(
  state: UniversalGraphState,
  call: { id: string; name: string; args: Record<string, any> },
): Promise<Partial<UniversalGraphState> | null> {
  const block = clarifyBlockFromArgs(call.args);
  if (typeof block === 'string') return null;

  const chatAPI = getChatAPIClient();
  // The turn genuinely ends here — close the live message before the card so
  // chat ordering is prose → card (legitimate terminal finalize, not an A14
  // mid-turn flush).
  await chatAPI.sendLLMEvent({ type: 'done' });
  const orchestrator = getOrCreateUniversalTurnStreaming(chatAPI, state.language === 'ko' ? 'ko' : 'en');
  await orchestrator.finalize(false);

  await sendClarify([block]);
  console.log(`🙋 [Universal:Clarify] Paused on question (tool_use ${call.id})`);

  return {
    pendingToolCalls: [],
    _clarifyPause: { toolUseId: call.id, question: block.question },
    clarifyRoundsUsed: (state.clarifyRoundsUsed ?? 0) + 1,
    recursionCount: (state.recursionCount ?? 0) + 1,
  };
}
