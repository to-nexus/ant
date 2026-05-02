/**
 * Direct Node — single-turn ReAct loop for Tier 0-1.
 *
 * Alternative execution path to plan/execute, chosen when the Tier Entry
 * Node classifies the job as Tier 0 (read-only textual answer) or Tier 1
 * (verification-unneeded write — comment/typo/safe config) via
 * `isDirectTier`. Independent of currentTask: the loop opens and closes
 * within a single graph invocation, then routes to `learn` (success) or
 * back to `decompose` (escalation).
 *
 * Tier 2+ cases route to the task pipeline (plan → execute →
 * checkTaskStatus) — single-unit work at Tier 2 runs as 1 task with
 * `selfVerifyOnDone:true` and follows a two-cycle apply→reverify
 * lifecycle within the same task (verify-mode dispatched through
 * `tasks/_shared/verify/`); Tier 3/4 decompose into >= 2 tasks with a
 * mandatory verification task.
 *
 * Tool policy: explain mode → read-only set; generate/refactor → full code set.
 * Loop budget derived from tier via `tierToDirectMode`:
 *   Tier 0 → undefined  (no tool loop; assistant answers via text)
 *   Tier 1 → 'oneshot'  (DIRECT_LOOP_LIMITS.oneshot — up to 2 steps)
 *   Tier 2+ → undefined (direct does not apply; routing never sends those here)
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
import { accumulateTokenUsage } from '../../../../../common/graph/llmHelpers';
import { invokeLLMWithTools } from '../_common/invokeLLMWithTools';
import { runToolCallsAndCollect } from '../_common/runToolCallsAndCollect';
import { parseReActResponse } from '../../utils/parseReActResponse';
import { shouldEscalate } from './shouldEscalate';
import { DIRECT_LOOP_LIMITS, getTechTier } from '@ant/shared';
import { tierToDirectMode } from '../../../../../../core/executionTier';
import { loadAntrules } from '../../../../../../core/artifact/antrules';

const registry = createCodeToolRegistry();

function getExploratoryMaxSteps(): number {
  const raw = process.env.ANT_DIRECT_MAX_STEPS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DIRECT_LOOP_LIMITS.exploratory;
}

export async function direct(
  state: ArchitectGraphState,
): Promise<Partial<ArchitectGraphState>> {
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
  // Loop budget:
  //   Tier 0 (`directMode === undefined`): single assistant turn, no tool
  //     loop — the read-only answer resolves in the first response.
  //   Tier 1 (`directMode === 'oneshot'`): DIRECT_LOOP_LIMITS.oneshot steps.
  //   The legacy 'exploratory' budget is retained in the env override for
  //   safety, but routing no longer reaches this node with Tier 2+.
  const maxSteps =
    directMode === undefined
      ? 1
      : directMode === 'oneshot'
        ? DIRECT_LOOP_LIMITS.oneshot
        : getExploratoryMaxSteps();

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

  // Tier-Verification Alignment: Tier 0/1 direct still runs through the same
  // `PromptBuilder.build()` pipeline as execute so the agent identity
  // (`agents/architect/base` via `jobs/code/base/system`), the critical rules
  // (Task Priority Hierarchy, Preserve Existing Code, Code Completeness,
  // Self-Verification mental checks), and the common injections
  // (tool-calling-rules, text-format, secure-coding, persistence-schema,
  // antrules partial + codebase/ANTRULES.md content) all flow in. The only
  // things excluded are task-specific surfaces (currentTask, planText,
  // violations, retryContext, task-type variant rules) because Tier 0/1
  // has no task by construction.
  const executionTierForPrompt = state.executionTier !== undefined ? state.executionTier : 0;
  const promptResult = await promptBuilder.build({
    templates: {
      system: 'jobs/code/base/system',
      base: 'jobs/code/nodes/direct/variants/default/base',
      rules: 'jobs/code/nodes/direct/variants/default/rules',
    },
    intent: state.resolvedAction?.intent,
    techContext: {
      techTier: getTechTier(state) ?? undefined,
      mode,
      resolvedAction: state.resolvedAction,
    },
    basis: state.resolvedAction?.basis,
    pipeline: {
      sanitizeInput: true,
      includeBasis: true,
      includeExamples: false,
      applyPolicyGuardrails: false,
      formatForLLM: false,
    },
    // Direct path intentionally omits artifacts: Tier 0 answers via text,
    // Tier 1 writes in a narrow known surface without needing full RAC
    // content. If a directive really needs artifact context the Tier Entry
    // Node should escalate to Tier 2 (which runs through the full execute
    // pipeline with artifact selection).
    vars: {
      directive: state.directive || '',
      directHints: state.directHints || {},
      featureContext: state.featureContext,
      mode,
      directMode,
      isExplainMode,
      maxSteps,
      executionTier: executionTierForPrompt,
      isTier0: executionTierForPrompt === 0,
      isTier1: executionTierForPrompt === 1,
      antrulesContent: loadAntrules(state.context?.featurePath),
      userLanguage: state.context?.userLanguage || 'en',
    },
  });

  const framing = [promptResult.system, promptResult.user].filter(Boolean).join('\n\n');

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
      state,
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
        // Direct mode does not run verification cycles.
        verifyModeActive: false,
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
      // `ev.result.sideEffects` — a failed edit_file call has no
      // sideEffects and therefore must not push the loop toward
      // escalation.
      //
      // chat.jsonl `chat_status` lines (statusType=file_create /
      // file_edit / file_delete + failed variants) are emitted by
      // `FileOperationHandler.addFileOperation` (see
      // core/llm-response/FileOperationHandler.ts) when tool handlers
      // call `ctx.chatStatus.completeFileCreation/Edit/Deletion`. No
      // separate emission is needed here.
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

  // Silent-failure guard (E from plan): direct was entered under a write
  // intent (generate/refactor), consumed its step budget, and produced
  // zero file modifications. Historically this completed the job as
  // "success" with no changes — e.g. metal-issuing-honor, where Tier 1
  // routing picked direct for what should have been a Tier 2+ fix and
  // the single assistant turn never wrote anything. Escalating to
  // decompose on this signal lets the 1-shot escalation cap in
  // routeAfterDirect kick in: decompose re-runs with a "previous
  // direct-path attempt touched zero files" framing (see
  // decompose/index.ts) and the LLM is nudged toward Tier 2+. A second
  // escalation collapses to learn, which is still strictly better than
  // silently logging "job complete" with an empty diff.
  const isWriteIntent = mode === 'generate' || mode === 'refactor';
  if (
    !needsEscalation &&
    isWriteIntent &&
    touchedFiles.size === 0 &&
    !effectivePromoted
  ) {
    needsEscalation = true;
    console.warn(
      `⚡ [Direct] No files touched at write-intent tier (mode=${mode}, ` +
      `executionTier=${state.executionTier}, steps=${stepsExecuted}/${maxSteps}) — ` +
      `escalating to decompose (re-classification expected to pick Tier 2+)`,
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
