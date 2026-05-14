/**
 * `runPlanLLMWithTools` — code-job thin wrapper around the shared
 * `runPlanWithTools` helper in `agents/common/graph/nodes/plan/`.
 *
 * The wrapper preserves the legacy external surface (return type,
 * `extraLogVars` option, the empty-plan shortcut for verification /
 * remediation, the prompt-log emission) while delegating the LLM-stream
 * + `<plan>` extraction + tool-call assembly to the shared helper.
 *
 * Returns either:
 *   - `{ planText }` — the LLM produced a `<plan>{...}</plan>` and any
 *     concurrent tool calls in the same response are ignored (apply
 *     phase will re-verify).
 *   - `{ llmResponse, nodePlanHistory, _activePhase: 'plan' }` — the LLM
 *     chose tool calls; caller short-circuits and the next graph tick
 *     re-enters plan via `runPlanToolLoopPhase`.
 *   - `null` — pre-flight aborted (no LLM, no tools, missing stream).
 *
 * The tool-set (`getTools` from sibling `nodes/plan/tools.ts`) is
 * intentionally separate from this module — `plan/tools.ts` is the SSOT
 * for "what tools the plan phase exposes"; `llm/tools.ts` is the SSOT
 * for "how the plan-LLM is driven through one tool-loop round".
 */

import { LLMClient } from "../../../../../../../core/ports";
import { MessageContentBlock } from "../../../../../../../core/ports/llm";
import { ArchitectGraphState } from "../../../state";
import { CodeTask } from "../../../../../types/task";
import { logPrompt } from "../../../../../../../core/utils/promptLogger";
import { getExecutionLogger } from "../../../../../../../core/utils/executionLogger";
import { collectResolvedPartials } from "../../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from "../../../../../../common/graph/llmConfig";
import { hooksForTaskType } from "../../../tasks/_shared/registry";
import { isVerifyModeActive } from "../../../tasks/_shared/verify";
import { selectLLMForTask } from "./selectModel";
import { runPlanWithTools } from "../../../../../../common/graph/nodes/plan";

export type PlanWithToolsResult =
  | { planText: string }
  | {
      llmResponse: {
        toolCalls: Array<{ id: string; name: string; args: Record<string, any> }>;
        textResponse: string;
        thinking?: string;
        thinkingSignature?: string;
        done: false;
        tokenUsage?: any;
      };
      nodePlanHistory: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>;
      _activePhase: 'plan';
    }
  | null;

/**
 * Run plan-phase LLM with tools (stream). Returns planText, or state updates for tool loop, or null to fallback to generatePlanText.
 */
export async function runPlanLLMWithTools(
  state: ArchitectGraphState,
  messages: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>,
  task: CodeTask,
  options?: {
    /**
     * Hook-contributed variant vars (from `buildPlanPromptBlocks`) merged into
     * the plan-toolLoop `logPrompt` call so debug logs record the same
     * variant-specific variables as plan-planGen.
     */
    extraLogVars?: Record<string, unknown>;
  },
): Promise<PlanWithToolsResult> {
  const llm = state.deps?.llm as LLMClient | undefined;
  if (!llm) {
    console.log('[Plan] runPlanLLMWithTools: llm not available, skipping tools');
    return null;
  }

  const { getTools } = await import('../tools');
  const tools = await getTools(state);
  if (!tools?.length) {
    console.log('[Plan] runPlanLLMWithTools: no tools available, skipping tools');
    return null;
  }

  const llmToUse = await selectLLMForTask(llm, task, state);

  const isFirstRound = messages.length <= 1;

  const result = await runPlanWithTools<ArchitectGraphState>({
    state,
    messages,
    llm: llmToUse,
    tools,
    enableThinking: isFirstRound,
    thinkingBudget: isFirstRound ? LLM_THINKING_BUDGET.PLAN : undefined,
    maxTokens: LLM_MAX_TOKENS.DEFAULT,
    taskName: task.name,
    jobType: 'code',
    onTokenUsage: async (usage) => {
      const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import(
        '../../../../../../common/graph/llmHelpers'
      );
      accumulateTokenUsage(state, usage, { taskLevel: true, jobLevel: true });
      updateKanbanTokenUsage(state);
      const planRound = Math.floor((messages.length - 1) / 2);
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        usage,
        {
          taskId: state.currentTask?.id || 'unknown',
          taskName: state.currentTask?.name || 'unknown',
          node: 'plan-toolLoop',
          callIndex: planRound,
          nodeHistoryLength: messages.length,
          recursionCount: state.recursionCount,
        },
      );
    },
    onMaxTokensTruncation: ({ outputTokens, round }) => {
      // safe-braking-eagle: surface max_tokens truncation that the legacy
      // fallthrough path absorbed silently. The output is still discarded
      // (chunked-emission recovery is option C); A only adds visibility.
      const taskId = task.id;
      console.warn(
        `⚠️  [Plan/toolLoop] max_tokens truncated (round=${round}, output=${outputTokens}) ` +
        `for task "${task.name}" (${taskId}). The partial output is discarded; the next ` +
        `tool-loop entry restarts from scratch. Consider bumping LLM_MAX_TOKENS.DEFAULT or ` +
        `having the plan emit \`batches[]\` to fan out before producing this much detail.`,
      );
      const featurePath = state.context?.featurePath;
      if (featurePath && state._httpJobId) {
        void getExecutionLogger({
          featurePath,
          jobId: state._httpJobId,
          jobType: 'code',
        })
          .log('max_tokens_truncated', {
            node: 'plan-toolLoop',
            round,
            outputTokens,
            maxTokens: LLM_MAX_TOKENS.DEFAULT,
            taskName: task.name,
            taskType: task.type,
            recoveryHint: 'fresh-toolloop-restart',
          }, taskId)
          .catch(() => { /* non-blocking */ });
      }
    },
  });

  // Always emit the prompt log entry (preserves debug parity with the
  // legacy implementation regardless of how the round resolved).
  await logPlanToolLoop(state, task, messages, result, options);

  if (result === null) {
    return null;
  }

  if (result.kind === 'planText') {
    const planText = result.planText;
    // Verify-mode 진입 자체가 "verify-mode plan 프롬프트가 LLM에게 no-errors
    // sentinel emit을 지시했고 그 sentinel은 cycle 종료 신호다" 라는 계약을
    //의미한다. requiresVerification(task)인 모든 task — verification +
    // selfVerifyOnDone (error/feature/ui/setup) — 가 동일한 verify-mode
    // 프롬프트·동일 sentinel 계약을 쓰므로 task type을 분기할 필요가 없다.
    // (solar-coming-bough 회귀: 옛 게이트는 `verification` task에만 fire되어
    // Tier-2 self-verify의 sentinel을 인식하지 못했고 cycle이 닫히지 않았다.)
    if (isVerifyModeActive(state)) {
      try {
        const parsed = JSON.parse(planText);
        if (
          parsed.diagnostics?.totalErrors === 0 ||
          (parsed.implementation?.modify?.length === 0 &&
            parsed.implementation?.create?.length === 0 &&
            (parsed.implementation?.delete?.length ?? 0) === 0)
        ) {
          console.log(`✅ [Plan] Verify-mode sentinel detected — returning empty planText for immediate done`);
          return { planText: '' };
        }
      } catch {
        // Non-blocking parse error, use plan as-is.
      }
    }
    return { planText };
  }

  // toolCalls branch
  return {
    llmResponse: result.llmResponse,
    nodePlanHistory: [...messages, result.assistantMessage as any],
    _activePhase: 'plan' as const,
  };
}

async function logPlanToolLoop(
  state: ArchitectGraphState,
  task: CodeTask,
  messages: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>,
  result: Awaited<ReturnType<typeof runPlanWithTools>>,
  options?: { extraLogVars?: Record<string, unknown> },
): Promise<void> {
  const featurePath = state.context?.featurePath;
  if (!featurePath) return;

  const jobId = state._httpJobId || 'unknown';
  const planRound = Math.floor((messages.length - 1) / 2);
  const toolCalls = result?.kind === 'toolCalls' ? result.llmResponse.toolCalls : [];
  const hasTextResponse = result?.kind === 'planText'
    ? result.planText.length > 0
    : (result?.kind === 'toolCalls' ? result.llmResponse.textResponse.length > 0 : false);

  try {
    const estimatedChars = messages.reduce(
      (n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length),
      0,
    );
    const logTemplate =
      hooksForTaskType(task.type)?.plan?.toolLoopLogTemplate ?? 'jobs/code/base/injections/plan-tools-batch';
    await logPrompt(featurePath, jobId, 'code', `plan-toolLoop`, estimatedChars, {
      taskId: task.id,
      taskName: task.name,
      templatePath: 'plan-toolLoop (with tools)',
      usedTemplates: [logTemplate],
      resolvedPartials: collectResolvedPartials([logTemplate]),
      injectedVariables: {
        round: planRound,
        historyMessages: messages.length,
        toolCallsThisRound: toolCalls.length,
        toolNames: toolCalls.map((t) => t.name),
        hasTextResponse,
        ...(options?.extraLogVars ?? {}),
      },
    });
  } catch {
    // Non-blocking
  }
}
