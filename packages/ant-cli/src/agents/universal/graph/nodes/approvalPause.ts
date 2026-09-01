/**
 * Approval pause node — end-and-resume, unattended (pipeline) runs only.
 *
 * Reached when the round's SOLE pending call is approval-gated and no grant
 * covers it (tool.ts wrapper enforces the predicate — mixed rounds get an
 * instructive gateCall rejection telling the model to re-issue the call
 * alone). Mirrors clarifyPause: the pause is a NORMAL job completion with the
 * assistant `tool_use` left dangling; the pipeline coordinator parks the step
 * on the sealed markers and, on a human APPROVE, re-dispatches with the
 * decision text as the tool_result plus a one-turn grant for the tool name.
 * A REJECT fails the step; the leftover dangling call is healed by the
 * runner's generic closure on the session's next turn.
 */

import type { UniversalGraphState } from '../state';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { getOrCreateUniversalTurnStreaming } from '../runtime';

/** Bounded, JSON-ish args echo for the approval card — never the full payload. */
export function approvalArgsSummary(args: Record<string, any>): string {
  try {
    const text = JSON.stringify(args ?? {});
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return '(unserializable args)';
  }
}

export async function approvalPauseNode(
  state: UniversalGraphState,
  call: { id: string; name: string; args: Record<string, any> },
): Promise<Partial<UniversalGraphState>> {
  const chatAPI = getChatAPIClient();
  await chatAPI.sendLLMEvent({
    type: 'text',
    text:
      state.language === 'ko'
        ? `\n\n🛂 승인 대기: \`${call.name}\` 호출은 사람의 승인이 필요합니다. 승인/거절은 파이프라인 인박스에서 결정합니다.`
        : `\n\n🛂 Awaiting approval: the \`${call.name}\` call needs a human decision (pipeline inbox).`,
  });
  await chatAPI.sendLLMEvent({ type: 'done' });
  const orchestrator = getOrCreateUniversalTurnStreaming(chatAPI, state.language === 'ko' ? 'ko' : 'en');
  await orchestrator.finalize(false);
  console.log(`🛂 [Universal:Approval] Paused on approval-gated call (tool_use ${call.id}, ${call.name})`);

  return {
    pendingToolCalls: [],
    _approvalPause: { toolUseId: call.id, toolName: call.name, argsSummary: approvalArgsSummary(call.args) },
    recursionCount: (state.recursionCount ?? 0) + 1,
  };
}
