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
import { sealUniversalConversation } from '../session/sealConversation';
import { getChatAPIClient } from '../../../../core/adapters/ChatAPIClient';
import { requireActiveCustomJob } from '../../../../core/customAgents/activeCustomJob';
import { isUnderPlanDir } from '../../../../core/customAgents/universalToolPolicy';
import {
  activeStopHooksOf,
  buildStopHookLedger,
  checkStopHooks,
  formatStopHookManifest,
  verifyChecksOnDisk,
  type StopHookCheck,
} from '../../../../core/customAgents/stopHooks';

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

  // 1.5. Stop-hook recomputation — respond never trusts the agent node's
  //      verdict flags: the SAME pure predicate re-runs over the sealed
  //      evidence plus a disk re-check (planCompleteCardWrites precedent).
  //      Plan turns are exempt (plan_complete owns their contract); a
  //      clarify pause DEFERS the contract (the answer turn re-gates via
  //      intent + ledger inheritance) but still records met hooks below.
  const fileSystem = state.deps?.fileSystem;
  const activeHooks =
    state.turnContext?.planTurn === true
      ? []
      : activeStopHooksOf(resolved.intents, state.turnContext?.intents ?? []);
  let hookChecks: StopHookCheck[] = [];
  if (activeHooks.length > 0) {
    const rawChecks = checkStopHooks(activeHooks, {
      writes: state._turnToolWrites ?? [],
      actions: state._turnToolActions ?? [],
      ledger: state.restoredHookLedger,
    });
    hookChecks = fileSystem
      ? await verifyChecksOnDisk(rawChecks, (p) => fileSystem.fileExists(p))
      : rawChecks;
  }
  // BOTH pauses are exempt: a paused turn has not finished its work, so its
  // hooks are not "unmet" — they are unreached. Reporting them made the
  // job-runner publish a `universal_stop_hook_unmet` interruption, and the
  // pipeline coordinator classifies an interruption as a step FAILURE before
  // it consults the clarify/approval seals (`outcome === 'succeeded'` gate) —
  // so an approval-gated tool call inside a step whose intent declares an
  // `artifact:` hook killed the whole run while its approval card sat in the
  // inbox. Clarify was exempt from the start; the manifest below already
  // exempted both.
  const hooksUnmet = state._clarifyPause || state._approvalPause ? [] : hookChecks.filter((c) => !c.met);

  // 2. Artifact manifest — only when writes happened. Stop-hook verdict
  //    lines share the manifest slot (✓/✗ split, unmet patterns verbatim so
  //    an author's glob typo is visible).
  const hookManifest =
    !state._clarifyPause && !state._approvalPause && hookChecks.length > 0
      ? formatStopHookManifest(hookChecks, state.language)
      : null;
  if (writes.length > 0 || hookManifest) {
    const writesManifest =
      writes.length > 0
        ? (state.language === 'ko' ? `📦 **이번 턴 산출물**\n` : `📦 **Artifacts written this turn**\n`) +
          writes.map((w) => `- \`${w}\``).join('\n')
        : null;
    const manifest = '\n\n' + [writesManifest, hookManifest].filter(Boolean).join('\n\n');
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
      // Verdict lift — the LAST <verdict> tag of the final assistant reply.
      // Parsed unconditionally (respond stays catalog-blind); the prompt band
      // makes outcome-declaring intents emit it, and consumers (the pipeline
      // coordinator) validate the value against the declared vocabulary.
      // Omitted on non-verdict seals, so a stale verdict self-clears.
      const mainConv = getConv(state.conversations, CONV_KEYS.SESSION_MAIN);
      const finalAssistant = [...mainConv].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string');
      const verdictMatches = typeof finalAssistant?.content === 'string'
        ? [...finalAssistant.content.matchAll(/<verdict>\s*([a-z0-9-]+)\s*<\/verdict>/g)]
        : [];
      const verdict = verdictMatches.length > 0 ? verdictMatches[verdictMatches.length - 1][1] : undefined;
      // The stored channel is run-scoped under a pipeline (F22) while the
      // graph works on session:main; siblings ride through untouched because
      // this state object replaces the file's whole state.
      const channel = state._sessionChannel ?? CONV_KEYS.SESSION_MAIN;
      const sessionState = {
        conversations: {
          ...(state._carriedChannels ?? {}),
          [channel]: sealUniversalConversation(getConv(state.conversations, CONV_KEYS.SESSION_MAIN)),
        },
        conversationChannel: channel,
        ...(verdict && !state._clarifyPause && !state._approvalPause && { verdict }),
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
        // Approval pause markers — the tool-approval HITL rail (unattended
        // runs). Same I2 shape and self-clear discipline as clarify.
        ...(state._approvalPause && {
          awaitingApproval: true,
          approvalToolUseId: state._approvalPause.toolUseId,
          approvalTool: state._approvalPause.toolName,
          approvalArgsSummary: state._approvalPause.argsSummary,
          ...(state.turnContext && { approvalTurnContext: state.turnContext }),
        }),
        // Stop-hook pause markers — the third rider of the clarify pause
        // rail: honest paused seal + resumable interruption (published by
        // the runner from `_hooksUnmet`). `hookLedger` records hooks already
        // met so the resumed turn re-demands only the remainder; it ALSO
        // rides a clarify pause mid-sequence (A done → clarify → answer turn
        // must not re-demand A). Both self-clear at the next normal seal —
        // a fresh request is a fresh contract (disk leftovers never satisfy
        // it: completion-signal = actual-write).
        ...(hooksUnmet.length > 0 && {
          awaitingStopHooks: true,
          ...(state.turnContext && { hookTurnContext: state.turnContext }),
          hookLedger: buildStopHookLedger(hookChecks),
        }),
        ...(state._clarifyPause &&
          hookChecks.some((c) => c.met) && { hookLedger: buildStopHookLedger(hookChecks) }),
        // Audit record of THIS turn's hook evaluation — until now the only
        // evidence a gate ran was a transient chat line. Record only:
        // `hookLedger` above stays the single gate-feeding state. Self-clears
        // on hook-less seals (state is replaced whole), like `verdict`.
        ...(hookChecks.length > 0 && {
          lastTurnHooks: hookChecks.map((c) => ({
            intentId: c.intentId,
            hook: c.hook,
            met: c.met,
            ...(c.matchedWrites.length > 0 && { matchedWrites: c.matchedWrites }),
          })),
        }),
      };
      await session.updateArtifacts(state.projectId, UNIVERSAL_FEATURE, resolved.jobId, { state: sessionState });
      console.log('💾 [Universal:Respond] Session sealed');
    } catch (e) {
      // Over-budget here means this turn's memory was not persisted, so the
      // next turn silently starts from the previous seal — loud, not a warn.
      if ((e as any)?.code === 'SESSION_WRITE_TOO_LARGE') {
        console.error('🚨 [Universal:Respond] Session seal REFUSED — over the write budget:', (e as Error).message);
      } else {
        console.warn('⚠️ [Universal:Respond] Session seal failed:', e instanceof Error ? e.message : String(e));
      }
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

  // Respond's recomputed verdict is what the runner surfaces (the agent
  // node's flag was pre-disk-recheck).
  return { _hooksUnmet: hooksUnmet.length > 0 ? hooksUnmet : undefined };
}
