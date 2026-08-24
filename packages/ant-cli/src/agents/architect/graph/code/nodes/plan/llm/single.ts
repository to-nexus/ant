/**
 * `generatePlanText` — single-shot plan-LLM call (no tool-use).
 *
 * Used as the fallback when the task type doesn't enter the plan-with-tools
 * loop (i.e. `plan.usesToolLoop=false`).
 *
 * Streams an XML-tagged response and extracts the single `<plan>{...}</plan>`
 * block at the tail. Truncation diagnostics distinguish max-token cuts
 * from missing-tag protocol errors.
 */

import { LLMClient } from "../../../../../../../core/ports";
import { ArchitectGraphState, Violation } from "../../../state";
import { CodeTask } from "../../../../../types/task";
import { formatViolations } from "../../../utils/violationFormatter";
import { logPrompt } from "../../../../../../../core/utils/promptLogger";
import { TEMPLATE_PATHS } from "../../../../../../../core/prompt/builder/templatePaths";
import { collectResolvedPartials } from "../../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from "../../../../../../common/graph/llmConfig";
import { maybeUpdatePhaseTokenUsage, applyEstimatedInputTokens } from "../../../../../../common/graph/llmHelpers";
import { buildPlanPrompt } from "./prompt";
import { selectLLMForTask } from "./selectModel";
import { savePlanTextForDebug } from "./savePlanText";
import { taskRequiresPlan } from "./requiresPlan";

export async function generatePlanText(
  llm: LLMClient,
  task: CodeTask,
  state: ArchitectGraphState,
  codeContext: any,
  violations?: Violation[],
  uiDoc?: string,  // ✅ UI spec/assets doc for UI-related tasks
  remainingTasks?: Array<{ id: string; name: string; description: string; priority: number }>,  // ✅ Remaining tasks for cross-task awareness
): Promise<string> {
  if (!taskRequiresPlan(task)) {
    return '';
  }

  if (!llm) {
    throw new Error('[Plan] LLM not available but plan is required');
  }

  const llmToUse = await selectLLMForTask(llm, task, state);
  const violationsText = violations && violations.length > 0 ? formatViolations(violations) : undefined;
  const { prompt, vars: hookVars } = await buildPlanPrompt(state, task, codeContext, violationsText, uiDoc, remainingTasks);

  // ✅ Log prompt structure (not content)
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'plan-planGen',
        prompt.length,
        {
          taskId: task.id,
          taskName: task.name,
          templatePath: TEMPLATE_PATHS.codePlanDefault.base,
          usedTemplates: [TEMPLATE_PATHS.codePlanDefault.rules!],
          resolvedPartials: collectResolvedPartials([TEMPLATE_PATHS.codePlanDefault.base, TEMPLATE_PATHS.codePlanDefault.rules!]),
          injectedVariables: {
            taskName: task.name,
            taskType: task.type,
            taskDescription: task.description ? `[${task.description.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            include: task.include || undefined,
            stack: task.stack || undefined,
            hasProjectCodeContext: !!codeContext,
            isRetry: !!violationsText,
            // hook-supplied variant variables (verification / error /
            // extraTemplateVars-only bundles). Empty for the generic path.
            ...hookVars,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Plan-PlanGen] Failed to log prompt:`, logError);
    }
  }

  // ✅ UI streaming (aligned with decompose/execute pattern)
  const { getChatAPIClient } = await import('../../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../../core/streaming/StreamOrchestrator');

  const createStrategy = () => {
    const strategy = new CommonRenderStrategy(chatAPI, 'en');
    strategy.setPlanTaskTitle(task.name);
    return strategy;
  };

  let orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: createStrategy(),
  });

  let response = '';
  let capturedUsage: any = undefined;
  let capturedStopReason: string | undefined;

  // Round-shape budget (metal-killing-crowd RCA): this single-shot call is the
  // sibling of the plan tool-loop and shares its per-round output budget. On
  // OpenAI-compat providers (GLM/DeepSeek) reasoning shares the single
  // `max_tokens` output budget and is NOT server-capped, so an uncapped call
  // let a degenerate thinking monologue run for minutes with no way for any
  // round-boundary breaker to fire (the stream never returns). The base cap
  // terminates it (`finish_reason:length`); a truncation MID-`<plan>` is a
  // legitimate large plan and escalates exactly once to DEFAULT — parity with
  // `runPlanWithTools` (gentle-leaping-lathe RCA).
  let roundMaxTokens: number = LLM_MAX_TOKENS.PLAN_TOOL_LOOP;
  let escalated = false;

  const {
    extractTokenUsageFromStreamEvent,
    accumulateTokenUsage,
    updateKanbanTokenUsage,
    logTokenUsageToFile,
  } = await import('../../../../../../common/graph/llmHelpers');

  for (;;) {
    // Per-attempt reset — an escalated retry is a fresh LLM call (both
    // attempts are billed in the 'done' branch) and must not inherit the
    // truncated attempt's text. Same reset as the provider-retry event below.
    response = '';
    capturedUsage = undefined;
    capturedStopReason = undefined;
    orchestrator = new StreamOrchestrator({
      parser: new XMLStreamParser(),
      renderStrategy: createStrategy(),
    });

    // R3: Provisional input-token estimate from prompt char-size. Overwritten
    // by the first `usage_partial` event from the LLM adapter.
    applyEstimatedInputTokens(state, prompt.length);

    for await (const event of llmToUse.stream(
      [{ role: 'user', content: prompt }],
      {
        temperature: LLM_TEMPERATURE.PLAN_GENERATION,
        maxTokens: roundMaxTokens,
        enableThinking: true,
        thinkingBudget: LLM_THINKING_BUDGET.PLAN,
        // Hard-stop the stream the moment `</plan>` closes. The plan node
        // consumes the sealed JSON only — any trailing narrative is wasted
        // output and delays the plan→execute transition.
        stopSequences: ['</plan>'],
      }
    )) {
      if (event.type === 'retry') {
        response = '';
        capturedUsage = undefined;
        capturedStopReason = undefined;
        orchestrator = new StreamOrchestrator({
          parser: new XMLStreamParser(),
          renderStrategy: createStrategy(),
        });
        continue;
      }

      // In-flight gauge update from usage_partial events (Anthropic/Gemini).
      // Overwrite-only; job/task counters are updated at 'done' below.
      maybeUpdatePhaseTokenUsage(state, event);

      await orchestrator.processEvent(event);

      if (event.text) {
        response += event.text;
      }

      if (event.type === 'done') {
        capturedUsage = extractTokenUsageFromStreamEvent(event);
        capturedStopReason = (event as any).stopReason;
        if (capturedUsage) {
          // Attribute to the plan node's actual model (may differ from job default).
          accumulateTokenUsage(state, capturedUsage, { taskLevel: true, jobLevel: true, modelId: llmToUse.modelName });
          updateKanbanTokenUsage(state);
          // Per-attempt file log — a truncated base attempt and its escalated
          // retry are both real cost and both appear in the token log.
          logTokenUsageToFile(
            state.context?.featurePath,
            state._httpJobId,
            capturedUsage,
            {
              taskId: state.currentTask?.id || 'unknown',
              taskName: state.currentTask?.name || 'unknown',
              node: 'plan-planGen',
              callIndex: escalated ? 1 : 0,
              modelId: llmToUse.modelName,
              nodeHistoryLength: 0,
              estimatedPromptChars: prompt.length,
              taskCumulativeInput: 0,
              taskCumulativeOutput: 0,
              recursionCount: state.recursionCount,
            }
          );
        }
      }
    }

    await orchestrator.finalize();

    const truncated = capturedStopReason === 'max_tokens';
    const hasOpenPlanTag = response.includes('<plan>') && !response.includes('</plan>');

    // Escalate exactly once when a large plan JSON was cut off mid-emission.
    // A no-`<plan>` truncation is a degenerate monologue and is NOT escalated
    // — the base cap is what terminates it; recovery is the orchestrator's
    // task re-queue (TaskWorker catch → reportFailure), not a bigger budget.
    if (truncated && hasOpenPlanTag && !escalated) {
      escalated = true;
      roundMaxTokens = LLM_MAX_TOKENS.DEFAULT;
      console.warn(
        `📋 [Plan] single-shot truncated mid-<plan> at ${LLM_MAX_TOKENS.PLAN_TOOL_LOOP} tokens — ` +
        `escalating to ${LLM_MAX_TOKENS.DEFAULT} for one retry (large plan emission).`,
      );
      continue;
    }

    // Final attempt truncated — surface the round shape (diagnostic parity
    // with plan-toolLoop) before the extraction below throws.
    if (truncated) {
      const degenerate = !hasOpenPlanTag;
      console.warn(
        `⚠️  [Plan/planGen] max_tokens truncated (output=${capturedUsage?.outputTokens ?? roundMaxTokens}, ` +
        `cap=${roundMaxTokens}, degenerate=${degenerate}) for task "${task.name}" (${task.id}). ${degenerate
          ? 'Degenerate no-output monologue — terminating; recovery is the orchestrator task re-queue.'
          : 'Escalated large-plan emission still overflowed DEFAULT.'}`,
      );
      if (state.context?.featurePath && state._httpJobId) {
        const { getExecutionLogger } = await import('../../../../../../../core/utils/executionLogger');
        void getExecutionLogger({
          featurePath: state.context.featurePath,
          jobId: state._httpJobId,
          jobType: 'code',
        })
          .log('max_tokens_truncated', {
            node: 'plan-planGen',
            outputTokens: capturedUsage?.outputTokens ?? roundMaxTokens,
            maxTokens: roundMaxTokens,
            degenerateMonologue: degenerate,
            taskName: task.name,
            taskType: task.type,
            recoveryHint: degenerate ? 'orchestrator-requeue' : 'orchestrator-requeue-after-escalation',
          }, task.id)
          .catch(() => { /* non-blocking */ });
      }
    }
    break;
  }

  // Normalize provider differences in stop_sequence handling. Anthropic
  // includes the matched stop sequence in the output; some Gemini SDK
  // versions strip it. When we requested a hard-stop on `</plan>` and the
  // run ended cleanly (not max_tokens), re-attach the closing tag if the
  // provider omitted it so the extraction regex still matches.
  if (response.includes('<plan>') && !response.includes('</plan>')) {
    const cleanStop = capturedStopReason === 'stop_sequence' || capturedStopReason === 'end_turn';
    if (cleanStop) {
      console.log(`📋 [Plan] Re-attaching </plan> after clean stop (stop_reason=${capturedStopReason})`);
      response += '</plan>';
    }
  }

  // ✅ Extract <plan> tag content (REQUIRED - structured JSON output)
  const planMatch = response.match(/<plan>([\s\S]*?)<\/plan>/);

  if (!planMatch) {
    const hasOpenTag = response.includes('<plan>');
    const outputDelta = capturedUsage?.outputTokens || 0;
    const isTruncation = hasOpenTag || outputDelta >= roundMaxTokens - 500;

    if (isTruncation) {
      console.error(`❌ [Plan] OUTPUT TRUNCATED — response hit max_tokens limit (${outputDelta} output tokens, limit: ${roundMaxTokens})`);
      console.error(`   <plan> open tag found: ${hasOpenTag}, response ends with: "...${response.substring(response.length - 100)}"`);
    } else {
      console.error(`❌ [Plan] <plan> tag not found in LLM response`);
      console.error(`   Response preview: "${response.substring(0, 200)}..."`);
    }

    throw new Error(
      `[Plan] <plan> tag not found. Your ENTIRE response must contain exactly one <plan>{JSON}</plan> block. ` +
      `Do NOT omit the <plan> tags. Do NOT output JSON without wrapping it in <plan>...</plan>.` +
      (isTruncation ? ` [TRUNCATION DETECTED: ${outputDelta} output tokens used, limit ${roundMaxTokens}]` : '')
    );
  }

  const planText = planMatch[1].trim();

  if (planText.length < 50) {
    throw new Error(`[Plan] Generated plan is too short (${planText.length} chars). This indicates plan generation failure.`);
  }

  // ✅ Save planText to sessions directory for debugging
  await savePlanTextForDebug(state, task, planText);

  return planText;
}
