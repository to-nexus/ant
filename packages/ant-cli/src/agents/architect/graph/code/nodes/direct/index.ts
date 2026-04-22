/**
 * Direct Node — single-turn ReAct loop for Tier 0-2 (oneshot / exploratory).
 *
 * Alternative execution path to plan/execute, chosen when the Tier Entry
 * Node classifies the job as Tier 0, 1, or 2 (`isDirectTier`). Independent
 * of currentTask: the loop opens and closes within a single graph
 * invocation, then routes to `learn` (success) or back to `decompose`
 * (escalation).
 *
 * Tool policy: explain mode → read-only set; generate/refactor → full code set.
 * Loop budget derived from tier via `tierToDirectMode`:
 *   Tier 0, 1 → DIRECT_LOOP_LIMITS.oneshot (= 2 steps)
 *   Tier 2    → ANT_DIRECT_MAX_STEPS (default 10)
 */

import { ArchitectGraphState } from '../../state';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from '../../../../../common/graph/llmConfig';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import { getTools } from './tools';
import { createCodeToolRegistry } from '../../../../../common/tool/presets';
import { createChatStatusReporter } from '../../../../../common/tool/chatStatusAdapter';
import type { ToolExecutionContext } from '../../../../../common/tool/types';
import { toolResultManager } from '../tool/utils/managers';
import { saveCheckpoint } from '../../session/checkpoint';
import { accumulateTokenUsage, beginNodePhase } from '../../../../../common/graph/llmHelpers';
import { invokeLLMWithTools } from '../_common/invokeLLMWithTools';
import { runToolCallsAndCollect } from '../_common/runToolCallsAndCollect';
import { parseReActResponse } from '../../utils/parseReActResponse';
import { emitFileWriteTrace } from '../_common/emitFileWriteTrace';
import { shouldEscalate } from './shouldEscalate';
import { DIRECT_LOOP_LIMITS } from '@ant/shared';
import { tierToDirectMode } from '../../../../../../core/executionTier';

const registry = createCodeToolRegistry();

function getExploratoryMaxSteps(): number {
  const raw = process.env.ANT_DIRECT_MAX_STEPS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DIRECT_LOOP_LIMITS.exploratory;
}

export async function direct(
  state: ArchitectGraphState,
): Promise<Partial<ArchitectGraphState>> {
  beginNodePhase(state as any, 'direct', 'Direct');
  state.recursionCount = (state.recursionCount || 0) + 1;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧭 DIRECT: ReAct loop');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const llm = state.deps?.llm;
  if (!llm) throw new Error('[Direct] LLM client not available');
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Direct] PromptBuilder not available');

  const mode = state.resolvedAction?.mode;
  const directMode = state.executionTier !== undefined
    ? tierToDirectMode(state.executionTier)
    : 'oneshot';
  const isExplainMode = mode === 'explain';
  const maxSteps =
    directMode === 'oneshot' ? DIRECT_LOOP_LIMITS.oneshot : getExploratoryMaxSteps();

  const tools = await getTools(state);

  console.log(
    `🧭 [Direct] mode=${mode} directMode=${directMode} tools=${tools.length} maxSteps=${maxSteps}`,
  );

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'direct',
      state.workerId ?? 0,
      undefined,
      extractLLMInfo(llm),
      state.recursionCount,
      state.recursionLimit,
    );
  }

  // Render per-turn framing (rules + base). Re-rendered each turn is cheap;
  // the directive / featureContext may evolve on resume.
  const renderedRules = await promptBuilder.render(
    'jobs/code/nodes/direct/variants/default/rules',
    { mode, directMode, isExplainMode, maxSteps },
  );
  const renderedBase = await promptBuilder.render(
    'jobs/code/nodes/direct/variants/default/base',
    {
      directive: state.directive || '',
      directHints: state.directHints || {},
      featureContext: state.featureContext,
      mode,
      directMode,
    },
  );

  const framing = `${renderedRules}\n\n${renderedBase}`;

  let history = [...getConv(state.conversations, CONV_KEYS.NODE_DIRECT)] as any[];
  let success = false;
  let needsEscalation = false;
  let stepsExecuted = 0;
  const touchedFiles = new Set<string>();

  // 1-shot escalation cap (§4.12 / runtime_escalate):
  // `_promotedThisJob` flips false→true exactly when direct is re-entered
  // following a prior escalation — i.e. `state.needsEscalation === true` was
  // already visible to the router on this run's entry. Setting the flag at
  // entry (not at escalation return) is what actually enforces the cap: if
  // we set it atomically with the first escalation, the router's
  // `!state._promotedThisJob` guard would evaluate against the post-merge
  // state and skip the decompose re-entry entirely.
  const wasEscalationReentry =
    state.needsEscalation === true && state._promotedThisJob !== true;
  const effectivePromoted =
    state._promotedThisJob === true || wasEscalationReentry;
  if (wasEscalationReentry) {
    console.log(
      '🔁 [Direct] Re-entered after prior escalation — 2nd escalation will route to learn',
    );
  }

  for (let step = 0; step < maxSteps; step++) {
    stepsExecuted = step + 1;

    const isStopRequested =
      typeof state._isStopRequested === 'function' && state._isStopRequested();
    if (isStopRequested) {
      console.log('🛑 [Direct] User stop requested — exiting loop');
      break;
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
      { role: 'user', content: framing },
      ...history,
    ];

    const response = await invokeLLMWithTools({
      llm,
      messages,
      tools,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      enableThinking: step === 0,
      thinkingBudget: LLM_THINKING_BUDGET.CODE_EXECUTE,
    });

    if (response.tokenUsage) {
      accumulateTokenUsage(state, response.tokenUsage, {
        taskLevel: false,
        jobLevel: true,
      });
      if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
        state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
      }
    }

    const parsed = parseReActResponse(response.textResponse || '');

    if (parsed.needsEscalation) {
      needsEscalation = true;
      history.push(
        buildAssistantMessage({
          thinking: response.thinking,
          thinkingSignature: response.thinkingSignature,
          text: parsed.cleanedText || undefined,
        }),
      );
      console.log(
        `⚡ [Direct] Escalation signal at step ${stepsExecuted}/${maxSteps}`,
      );
      break;
    }

    if (response.toolCalls.length > 0) {
      history.push(
        buildAssistantMessage({
          thinking: response.thinking,
          thinkingSignature: response.thinkingSignature,
          text: parsed.cleanedText || undefined,
          toolCalls: response.toolCalls,
        }),
      );

      const ctx: ToolExecutionContext = {
        fileSystem: state.deps?.fileSystem as any,
        chatStatus: createChatStatusReporter(),
        workingDir: state.context?.featurePath || process.cwd(),
        featurePath: state.context?.featurePath,
        project: state.context?.project,
        featureFolder: state.context?.featureFolder,
        command: state.deps?.command as any,
        git: state.deps?.git as any,
        redis: state.deps?.redis,
        fileTreeUpdate: state.deps?.fileTreeUpdate as any,
        figmaFileKey: state.figmaFileKey,
        activePhase: 'execute',
        currentTaskType: undefined,
        // Direct mode does not run verification tasks, so the Session is
        // always absent here — the command policy falls through to the
        // generic (non-verification) guard.
        verificationSession: undefined,
        retries: 0,
        referenceRequests: state.referenceRequests,
        resolvedActionMode: mode,
        retriever: state.deps?.retriever as any,
        vectorDB: state.deps?.vectorDB,
        workspaceResolver: state.deps?.workspaceResolver,
        userId: state.context?.userId,
        organizationId: state.context?.organizationId,
      };

      const batch = await runToolCallsAndCollect({
        registry,
        resultManager: toolResultManager,
        ctx,
        calls: response.toolCalls,
        workflowUpdate: state.deps?.workflowUpdate
          ? {
              enterNode: state.deps.workflowUpdate.enterNode.bind(
                state.deps.workflowUpdate,
              ),
              exitNode: state.deps.workflowUpdate.exitNode.bind(
                state.deps.workflowUpdate,
              ),
            }
          : undefined,
        httpJobId: state._httpJobId,
        workerId: state.workerId ?? 0,
        recursionCount: state.recursionCount,
        recursionLimit: state.recursionLimit,
      });

      history.push({
        role: 'user' as const,
        content: batch.toolResultBlocks as any,
      });
      state.recursionCount = (state.recursionCount || 0) + 1;

      // Aggregate touched files for runtime escalate. SSOT is
      // `ev.result.sideEffects` — the same source emitFileWriteTrace
      // forwards to trace.jsonl. This keeps the escalation heuristic and
      // the breadcrumb/touched accounting on the exact same set of files
      // (actual mutations, not attempted writes). A failed edit_file call
      // has no sideEffects and therefore must not push the loop toward
      // escalation — the scope hasn't actually widened.
      for (const ev of batch.events) {
        const effects = ev.result.sideEffects;
        if (effects && effects.length > 0) {
          for (const effect of effects) {
            if (
              (effect.type === 'fileModified' ||
                effect.type === 'fileCreated' ||
                effect.type === 'fileDeleted') &&
              typeof effect.path === 'string' &&
              effect.path.length > 0
            ) {
              touchedFiles.add(effect.path);
            }
          }
        }
        emitFileWriteTrace({
          session: state.deps?.session,
          jobId: state.jobId,
          turnId: state.turnId,
          jobType: 'code',
          sideEffects: effects,
        });
      }

      if (!effectivePromoted && shouldEscalate(state, touchedFiles)) {
        needsEscalation = true;
        console.log(
          `⚡ [Direct] Touched-file escalation at step ${stepsExecuted}/${maxSteps} (touched=${touchedFiles.size})`,
        );
        break;
      }
      continue;
    }

    // Terminal assistant turn — no tool calls.
    history.push(
      buildAssistantMessage({
        thinking: response.thinking,
        thinkingSignature: response.thinkingSignature,
        text: parsed.cleanedText || '',
      }),
    );

    if (parsed.done) {
      success = true;
      console.log(
        `✅ [Direct] <done>true</done> at step ${stepsExecuted}/${maxSteps}`,
      );
    } else {
      console.warn(
        `⚠️  [Direct] Premature stop at step ${stepsExecuted}/${maxSteps} (no tools, no termination tag)`,
      );
    }
    break;
  }

  if (!success && !needsEscalation && stepsExecuted >= maxSteps) {
    console.warn(
      `⚠️  [Direct] Step budget exhausted (${stepsExecuted}/${maxSteps})`,
    );
  }

  const updatedConversations = { [CONV_KEYS.NODE_DIRECT]: history };

  try {
    await saveCheckpoint({
      ...state,
      conversations: { ...state.conversations, ...updatedConversations },
    } as any);
  } catch (err) {
    console.warn(`⚠️  [Direct] saveCheckpoint failed: ${(err as Error).message}`);
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(
      state._httpJobId,
      'direct',
      state.workerId ?? 0,
    );
  }

  // Runtime escalate: `_promotedThisJob` is persisted as the re-entry flag so
  // the routeAfterDirect 1-shot cap (routing.ts) has a stable guard. We
  // intentionally DO NOT flip the flag on the first escalation return —
  // doing so would close the `!_promotedThisJob` router branch before
  // decompose gets a chance to re-plan. The flag advances at next-entry
  // (see `wasEscalationReentry` above) so the second escalation (if any)
  // correctly collapses to learn.
  return {
    conversations: updatedConversations,
    needsEscalation,
    _promotedThisJob: effectivePromoted,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
  };
}
