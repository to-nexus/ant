/**
 * `runPlanLLMWithTools` — plan-LLM call with the read-only `planExplore`
 * tool-set attached. Streams a single round; returns either:
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
import { collectResolvedPartials } from "../../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from "../../../../../../common/graph/llmConfig";
import { maybeUpdatePhaseTokenUsage, applyEstimatedInputTokensFromMessages } from "../../../../../../common/graph/llmHelpers";
import { buildAssistantMessage } from "../../../../../../common/tool/messageBuilder";
import { hooksForTaskType } from "../../../tasks/_shared/registry";
import { isVerificationTask } from "../../../tasks/verification";
import { isErrorTask } from "../../../tasks/error";
import { selectLLMForTask } from "./selectModel";

/** Max plan↔tool round-trips before forcing plan finalization.
 * After this many rounds the LLM is called once more WITHOUT tools
 * so it must produce a <plan> from the gathered exploration context. */
export const PLAN_TOOL_LOOP_MAX = 15;

export type PlanWithToolsResult =
  | { planText: string }
  | { llmResponse: { toolCalls: Array<{ id: string; name: string; args: Record<string, any> }>; textResponse: string; thinking?: string; thinkingSignature?: string; done: false; tokenUsage?: any }; nodePlanHistory: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>; _activePhase: 'plan' }
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
  if (!llmToUse?.stream) {
    console.log('[Plan] runPlanLLMWithTools: resolved LLM has no stream method, skipping tools');
    return null;
  }

  // ✅ UI streaming (aligned with decompose/execute pattern)
  const { getChatAPIClient } = await import('../../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../../core/streaming/StreamOrchestrator');

  const createStrategy = () => {
    const strategy = new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'code', undefined);
    strategy.setPlanTaskTitle(task.name);
    strategy.setParallelTaskName(task.name);
    return strategy;
  };

  let orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: createStrategy(),
    existingFiles: new Set()
  });

  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];
  let textResponse = '';
  let thinking = '';
  let thinkingSignature = '';
  let tokenUsage: any = undefined;

  const isFirstRound = messages.length <= 1;
  // T1 per-iteration estimate: tool-loop calls can change messages[] shape
  // significantly between rounds — re-seed so the gauge tracks each request.
  applyEstimatedInputTokensFromMessages(state, messages);
  for await (const event of llmToUse.stream(messages, {
    tools,
    maxTokens: LLM_MAX_TOKENS.DEFAULT,
    enableThinking: isFirstRound,
    thinkingBudget: isFirstRound ? LLM_THINKING_BUDGET.PLAN : undefined,
  })) {
    if (event.type === 'retry') {
      textResponse = '';
      thinking = '';
      thinkingSignature = '';
      toolCalls.length = 0;
      tokenUsage = undefined;
      orchestrator = new StreamOrchestrator({
        parser: new XMLStreamParser(),
        renderStrategy: createStrategy(),
        existingFiles: new Set()
      });
      continue;
    }

    // In-flight gauge update from usage_partial events (Anthropic/Gemini).
    // Overwrite-only; job/task counters are updated at 'done' below.
    maybeUpdatePhaseTokenUsage(state, event);

    await orchestrator.processEvent(event);

    if (event.type === 'thinking') {
      thinking += (event as any).thinking ?? '';
      if (event.signature) {
        thinkingSignature = event.signature;
      }
    }
    if (event.type === 'tool_use' && (event as any).toolUse) {
      const { id, name, input } = (event as any).toolUse;
      await chatAPI.sendLLMEvent(event);
      toolCalls.push({ id, name, args: input ?? {} });
    }
    if (event.type === 'text') {
      textResponse += (event as any).text ?? '';
    }
    if (event.type === 'done' && (event as any).usage) {
      tokenUsage = (event as any).usage;
      const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import('../../../../../../common/graph/llmHelpers');
      accumulateTokenUsage(state, tokenUsage, { taskLevel: true, jobLevel: true });
      updateKanbanTokenUsage(state);
      const planRound = Math.floor((messages.length - 1) / 2);
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        tokenUsage,
        {
          taskId: state.currentTask?.id || 'unknown',
          taskName: state.currentTask?.name || 'unknown',
          node: 'plan-toolLoop',
          callIndex: planRound,
          nodeHistoryLength: messages.length,
          recursionCount: state.recursionCount,
        }
      );
    }
  }

  // Log prompt for plan-toolLoop so it appears in prompt-*.md debug files.
  // The "empty plan → done" shortcut below applies to verification (gates
  // passed with no fix left) AND error (remediation plan reports zero
  // implementation items). Feature/setup plans cannot legitimately be
  // empty so they never enter the shortcut and fall through to execute.
  const allowsEmptyPlanShortcut = isVerificationTask(task) || isErrorTask(task);
  const planRound = Math.floor((messages.length - 1) / 2);
  const jobId = state._httpJobId || 'unknown';
  if (state.context?.featurePath) {
    try {
      const estimatedChars = messages.reduce(
        (n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0,
      );
      const logTemplate = hooksForTaskType(task.type)?.plan?.toolLoopLogTemplate
        ?? 'jobs/code/base/injections/plan-tools-batch';
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        `plan-toolLoop`,
        estimatedChars,
        {
          taskId: task.id,
          taskName: task.name,
          templatePath: 'plan-toolLoop (with tools)',
          usedTemplates: [logTemplate],
          resolvedPartials: collectResolvedPartials([logTemplate]),
          injectedVariables: {
            round: planRound,
            historyMessages: messages.length,
            toolCallsThisRound: toolCalls.length,
            toolNames: toolCalls.map(t => t.name),
            hasTextResponse: textResponse.length > 0,
            ...(options?.extraLogVars ?? {}),
          },
        },
      );
    } catch {
      // Non-blocking
    }
  }

  // Extract <plan> BEFORE checking tool calls.
  // LLMs may produce both a structured plan and tool calls in the same response.
  // Once a valid plan exists, additional tool calls (install, re-verify) are redundant —
  // execute applies fixes, then a fresh diagnostic cycle re-verifies.
  const planMatch = textResponse.match(/<plan>([\s\S]*?)<\/plan>/);
  if (planMatch) {
    const planText = planMatch[1].trim();
    if (planText.length >= 50) {
      await orchestrator.finalize();
      if (toolCalls.length > 0) {
        console.log(`📋 [Plan] <plan> extracted (${planText.length} chars) — ignoring ${toolCalls.length} concurrent tool call(s)`);
      }
      // Shortcut: if plan indicates no errors, return empty planText
      // so execute can immediately mark done without LLM interpretation
      if (allowsEmptyPlanShortcut) {
        try {
          const parsed = JSON.parse(planText);
          if (parsed.diagnostics?.totalErrors === 0 ||
              (parsed.implementation?.modify?.length === 0 &&
               parsed.implementation?.create?.length === 0 &&
               (parsed.implementation?.delete?.length ?? 0) === 0)) {
            console.log(`✅ [Plan] Diagnostic plan shows no errors — returning empty planText for immediate done`);
            return { planText: '' };
          }
        } catch { /* non-blocking parse error, use plan as-is */ }
      }
      return { planText };
    }
  }

  if (toolCalls.length > 0) {
    await orchestrator.finalize(true);

    const assistantMsg = buildAssistantMessage({
      thinking: thinking || undefined,
      thinkingSignature: thinkingSignature || undefined,
      text: textResponse || undefined,
      toolCalls,
    });

    return {
      llmResponse: { toolCalls, textResponse, thinking: thinking || undefined, thinkingSignature: thinkingSignature || undefined, done: false, tokenUsage },
      nodePlanHistory: [...messages, assistantMsg],
      _activePhase: 'plan' as const,
    };
  }

  await orchestrator.finalize();
  return null;
}
