/**
 * Universal respond node — final response, outputs-contract check, session seal.
 *
 * The outputs check is CONDITIONAL (D6): a conversation-only turn is a normal
 * termination. Only when real writes happened this run (`_turnToolWrites`,
 * fed by tool side-effects — never by LLM claims) does the node verify them
 * against the declared contract and announce the artifact manifest.
 */

import * as path from 'path';
import { UNIVERSAL_FEATURE } from '@ant/shared';
import type { UniversalGraphState } from '../state';
import { CONV_KEYS, getConv } from '../../../common/graph/conversations';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { requireActiveCustomJob } from '../../../../core/customAgents/activeCustomJob';
import type { OutputArtifactContract } from '../../../../core/customAgents/types';

function matchContract(writePath: string, artifacts: OutputArtifactContract[]): OutputArtifactContract | null {
  const normalized = writePath.replace(/^\.\//, '');
  for (const contract of artifacts) {
    const dir = contract.dir.replace(/\/+$/, '');
    const inDir = normalized === dir || normalized.startsWith(`${dir}/`);
    const ext = path.extname(normalized).replace(/^\./, '');
    if (inDir && (!contract.format || ext === contract.format)) return contract;
  }
  return null;
}

export async function respondNode(state: UniversalGraphState): Promise<Partial<UniversalGraphState>> {
  const chatAPI = getChatAPIClient();
  const resolved = requireActiveCustomJob();
  const writes = Array.from(new Set(state._turnToolWrites ?? []));

  // 1. Final response delivery (fallback path when not already streamed).
  if (state.response && !state.streamingCompleted) {
    await chatAPI.startMessage();
    await chatAPI.sendLLMEvent({ type: 'text', text: state.response });
    await chatAPI.finalizeMessage();
  } else if (!state.response && !state.streamingCompleted) {
    console.warn('[Universal:Respond] No response to send');
  }

  // 2. Artifact manifest + contract conformance — only when writes happened.
  if (writes.length > 0) {
    const lines: string[] = [];
    const violations: string[] = [];
    for (const w of writes) {
      if (resolved.outputs.mode === 'contract' && resolved.outputs.artifacts?.length) {
        const matched = matchContract(w, resolved.outputs.artifacts);
        if (matched) {
          lines.push(`- \`${w}\` (${matched.kind})`);
        } else {
          lines.push(`- \`${w}\``);
          violations.push(w);
        }
      } else {
        lines.push(`- \`${w}\``);
      }
    }
    const manifest =
      (state.language === 'ko' ? `\n\n📦 **이번 턴 산출물**\n` : `\n\n📦 **Artifacts written this turn**\n`) +
      lines.join('\n') +
      (violations.length > 0
        ? (state.language === 'ko'
            ? `\n\n⚠️ 규약(outputs) 경로/형식과 다른 산출물: ${violations.map((v) => `\`${v}\``).join(', ')}`
            : `\n\n⚠️ Outside the declared outputs contract: ${violations.map((v) => `\`${v}\``).join(', ')}`)
        : '');
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
        executionTier: state.executionTier,
        customJobRef: `${resolved.agentId}/${resolved.jobId}`,
        // Persisted so a resume without a new message keeps its
        // classification (explicit* fields are run-scoped — never sealed).
        // Known degradation: a pause skips this seal, so that resume can
        // demote to ['general'] (same acceptance as universal interruption
        // persistence being a no-op).
        activeIntents: state.activeIntents,
        ...(state._httpJobId && { jobId: state._httpJobId }),
      };
      await session.updateArtifacts(state.projectId, UNIVERSAL_FEATURE, resolved.jobId, { state: sessionState });
      console.log('💾 [Universal:Respond] Session sealed');
    } catch (e) {
      console.warn('⚠️ [Universal:Respond] Session seal failed:', e instanceof Error ? e.message : String(e));
    }
  }

  return {};
}
