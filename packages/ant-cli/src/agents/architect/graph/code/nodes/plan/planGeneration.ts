/**
 * Plan Text Generation
 * 
 * Generates concrete implementation plan based on:
 * - Task description
 * - Retrieved code context
 * - Design documents
 */

import { LLMClient } from "../../../../../../core/ports";
import { TextContentBlock, MessageContentBlock } from "../../../../../../core/ports/llm";
import { ArchitectGraphState, TASK_PRIORITIES, Violation } from "../../state";
import { CodeTask } from "../../../../types/task";
import { formatViolations } from "../../utils/violationFormatter";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { getTechTier, type ResolvedArtifact } from "@ant/shared";
import { collectResolvedPartials } from "../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { AutoInjectionResolver } from "../../../../../../core/prompt/builder/AutoInjectionResolver";
import { isMockContentImageryActive } from "../../../../../../core/prompt/builder/mockContentImageryGate";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from "../../../../../common/graph/llmConfig";
import { maybeUpdatePhaseTokenUsage, applyEstimatedInputTokens, applyEstimatedInputTokensFromMessages } from "../../../../../common/graph/llmHelpers";
import { resolveArtifacts, ArtifactPoolView } from "../../../../../../core/prompt/builder/ArtifactPipeline";
import { loadAntrules } from "../../../../../../core/artifact/antrules";
import { getRACDocuments } from "@ant/shared";
import { getSessionDebugDir } from '../../../../../../core/utils/sessionPaths';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import { hooksForTaskType } from '../../tasks/_shared/registry';
import { isVerificationTask } from '../../tasks/verification';
import { isErrorTask } from '../../tasks/error';
import { isDocTask } from '../../tasks/doc/model/is';
import { isExplainTask } from '../../tasks/explain/model/is';
import { toPlanPromptResult, type PlanPromptCtx } from '../../tasks/_shared/types';
import { formatCodeContext } from '../../tasks/_shared/helpers/planPrompt';
import { isVerifyEntered } from '../../tasks/_shared/verify';
import { buildPrompt as sharedVerifyBuildPrompt } from '../../tasks/_shared/verify/buildPlanPrompt';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Select appropriate LLM for plan node
 */
async function selectLLMForTask(
  defaultLLM: LLMClient,
  task: CodeTask,
  state: ArchitectGraphState
): Promise<LLMClient> {
  if (!state.workspaceConfig) {
    return defaultLLM;
  }
  
  const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');
  
  return createLLMClient(
    'architect',
    undefined,
    { jobType: 'code', nodeType: 'plan' },
    state.workspaceConfig
  );
}

/**
 * Build plan prompt (shared by generatePlanText and plan-with-tools path).
 *
 * Dispatch order (T6b-β):
 *   1. `hooks.plan.buildPrompt(ctx)` — full override; used by verification
 *      and error which render against dedicated `jobs/code/nodes/plan/
 *      variants/{type}/base` templates.
 *   2. Generic `jobs/code/nodes/plan/base` path — artifact pipeline, RAC
 *      documents, basis section. Task types that only need to inject extra
 *      template vars (e.g. setup's `setupConstraints`) participate via
 *      `hooks.plan.extraTemplateVars(ctx)`.
 *
 * The phase layer itself is blind to `task.type`; all branching has moved
 * into `tasks/{type}/hooks/plan.ts`.
 */
export interface BuildPlanPromptResult {
  prompt: string;
  /**
   * Variant-specific variable snapshot contributed by
   * `hooksForTaskType(task.type).plan.buildPrompt`. Empty `{}` for the generic
   * path. Merged into `logPrompt`'s `injectedVariables` so debug logs surface
   * hook-injected variables (verification's `dependencyStatusKind`,
   * `cachedPassedStepsCount`, etc.) that phase code can't see directly.
   */
  vars: Record<string, unknown>;
}

async function buildPlanPrompt(
  state: ArchitectGraphState,
  task: CodeTask,
  codeContext: any,
  violationsText: string | undefined,
  uiDoc: string | undefined,
  remainingTasks: Array<{ id: string; name: string; description: string; priority: number }> | undefined,
  options?: { hasTools?: boolean },
): Promise<BuildPlanPromptResult> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Plan] PromptBuilder not available');

  const planHook = hooksForTaskType(task.type)?.plan;
  // Loaded once per plan render so every hook consumes the same snapshot.
  const antrulesContent = loadAntrules(state.context?.featurePath);
  const promptCtx: PlanPromptCtx = {
    state,
    task,
    codeContext,
    violationsText,
    uiDoc,
    remainingTasks,
    options,
    antrulesContent,
  };

  // Phase-mode dispatch (verify-mode SSOT): every task that owns a
  // verification cycle (verification task type AND Tier 2 self-verify
  // tasks once `_verifyEntered === true`) renders against the
  // `_shared/verify/buildPrompt` template surface. The dispatch happens
  // here at the phase layer so the bundle's apply-phase `buildPrompt`
  // stays untouched — the wrapper-vs-fallthrough split would otherwise
  // force every composeBundle bundle to always return a present-but-
  // empty buildPrompt, breaking the "no buildPrompt → generic plan base"
  // fallback.
  if (isVerifyEntered(state)) {
    const verifyResult = toPlanPromptResult(await sharedVerifyBuildPrompt(promptCtx));
    return { prompt: verifyResult.text, vars: verifyResult.vars ?? {} };
  }

  // Type-specific full override (apply phase — currently error variant only).
  if (planHook?.buildPrompt) {
    const hookResult = toPlanPromptResult(await planHook.buildPrompt(promptCtx));
    return { prompt: hookResult.text, vars: hookResult.vars ?? {} };
  }

  // Generic path — artifact pipeline + RAC docs + optional extra template vars.
  // Spec-driven = a spec artifact is present with role='ref' (RAC-derived).
  const pool = state.artifacts || [];
  const isSpecDriven = new ArtifactPoolView(pool).activeSpecRefFilename() !== null;
  const hasExplicitDocs = state.resolvedAction?.source === 'explicit'
    && ((state.resolvedAction?.artifacts?.length ?? state.resolvedAction?.documents?.length ?? 0) > 0);

  let planDocs: ResolvedArtifact[] = [];
  let resolvedActionWithDocs = state.resolvedAction;
  if (!hasExplicitDocs) {
    planDocs = resolveArtifacts(pool,
      { taskType: task.type, include: task.include },
      { threshold: 30_000 });

    if (planDocs.length > 0) {
      resolvedActionWithDocs = {
        ...(state.resolvedAction || { source: 'infer' as const, mode: 'generate' as const, tech: {}, hasExplicitFields: false }),
        artifacts: planDocs,
        documents: planDocs,
      };
      const totalChars = planDocs.reduce((s, a) => s + (a.content?.length || 0), 0);
      console.log(`📄 [Plan] Pipeline: ${pool.length} pool → ${planDocs.length} selected (${totalChars.toLocaleString()} chars, include=${JSON.stringify(task.include ?? 'default')})`);
    }
  }

  const taskTechTiers = task.techTiers?.length ? task.techTiers : (getTechTier(state) ? [getTechTier(state)!] : []);
  const { hasFrontend, hasBackend } = AutoInjectionResolver.computeStackFlags(taskTechTiers);
  const fmtCtx = formatCodeContext(codeContext);

  const _planBasis = state.resolvedAction?.basis;
  if (!_planBasis) {
    console.warn(`⚠️  [Plan] state.resolvedAction.basis is ${_planBasis === undefined ? 'undefined' : 'falsy'} (resolvedAction exists: ${!!state.resolvedAction}, intent: ${state.resolvedAction?.intent})`);
  } else {
    console.log(`📐 [Plan] basis present: stack=${_planBasis.techTier?.stack || 'none'}, visualTier=${_planBasis.visualTier ? Object.keys(_planBasis.visualTier).join(',') : 'none'}`);
  }
  // Phase 1: thread domain + slot so the matrix gate (`isTierActive`) is
  // honoured. Without these the legacy permissive path renders every tier
  // with data — fine for the existing service flow but bypasses the
  // domain × tier policy for game/* and any future-domain extensions.
  const _slot = state.resolvedAction?.intent
    ? (await import('@ant/shared')).getConfigSlots(state.resolvedAction.intent)?.basis
    : undefined;
  const basisSection = await promptBuilder.renderBasis(
    state.resolvedAction?.basis,
    'code',
    taskTechTiers,
    state.resolvedAction?.domain,
    _slot,
  );

  // Post-RAC template flags — see `.cursorrules`
  // "Post-RAC Template Condition SSOT" for the 3-category semantics.
  //
  // Under the 3-axis role model (Authority / Edit-scope / Task-scope),
  // both `ref` and `context` are authoritative inputs, and the
  // "API Contract IMMUTABLE" directive applies whenever a system-design
  // doc is present — regardless of whether it is injected via ref or
  // context. Gate (`hasSystemDesign`) is therefore the correct flag for
  // the plan/base.md IMMUTABLE notice, not the old role-scoped
  // `hasSystemDesignRef` (which would have silently skipped gen-code-spec
  // / rev-code, where sys-design arrives as context).
  //
  //   `hasSystemDesign` (Gate): gates the "API Contract IMMUTABLE" notice.
  //   `hasUi`           (Gate): gates design-system TOKEN INVENTORY / ui
  //                              ASSET INVENTORY / LAYOUT SPECS in
  //                              plan/rules.md.
  const allDocs = getRACDocuments(resolvedActionWithDocs);
  const planPool = new ArtifactPoolView(allDocs);
  const hasSystemDesign = planPool.hasSystemDesign();
  const hasUi = planPool.hasUi();
  // `uiSource` — Contract-flavoured discriminator; plan/rules.md dispatches
  // the TOKEN/ASSET/LAYOUT inventory branch to the correct per-source
  // template. Hard-exclusive by construction (throws on mixed sources).
  const uiSource = planPool.uiSource();

  // Per-type contributions (e.g. setup → { setupConstraints, hasSetupConstraints }).
  const typeVars = (await planHook?.extraTemplateVars?.(promptCtx)) ?? {};

  const prompt = await promptBuilder.render('jobs/code/nodes/plan/base', {
    taskName: task.name, taskDescription: task.description,
    directive: state.directive || '', taskType: task.type,
    documents: planDocs, hasDocuments: allDocs.length > 0,
    isSpecDriven: isSpecDriven || false,
    projectCodeContext: fmtCtx, directoryTree: codeContext?.directoryTree || '',
    hasProjectCodeContext: !!fmtCtx,
    violationsText, isRetry: !!violationsText,
    remainingTasks, hasRemainingTasks: remainingTasks && remainingTasks.length > 0,
    hasTools: options?.hasTools ?? false,
    resolvedAction: resolvedActionWithDocs, hasSystemDesign, hasUi, uiSource,
    featureContext: state.featureContext,
    antrulesContent,
    hasFrontend, hasBackend,
    // Derived gate (SBS) — service domain × FE stack × feature task.
    // Domain comparison happens in code (Domain-Branching Locality I1).
    mockContentImageryActive: isMockContentImageryActive({
      hasFrontend,
      domain: state.resolvedAction?.domain,
      taskType: task.type,
    }),
    ...typeVars,
  });

  const composed = basisSection ? `${basisSection}\n\n---\n\n${prompt}` : prompt;
  return { prompt: composed, vars: typeVars };
}

/**
 * Build plan prompt as CacheableContent blocks for Anthropic prompt caching.
 *
 * The designDoc (typically 36K-126K chars) is stable within a plan-toolLoop
 * session, so placing it in a separate block with cache_control enables
 * Anthropic to cache it across successive tool-loop rounds.
 *
 * Used only by the plan-with-tools path (plan-toolLoop). The generatePlanText
 * path (single-shot, no tools) continues to use buildPlanPrompt directly.
 */
export interface BuildPlanPromptBlocksResult {
  blocks: TextContentBlock[];
  /** Hook-contributed template var snapshot; see `BuildPlanPromptResult.vars`. */
  vars: Record<string, unknown>;
}

export async function buildPlanPromptBlocks(
  state: ArchitectGraphState,
  task: CodeTask,
  codeContext: any,
  violationsText: string | undefined,
  uiDoc: string | undefined,
  remainingTasks: Array<{ id: string; name: string; description: string; priority: number }> | undefined,
  options?: { hasTools?: boolean },
): Promise<BuildPlanPromptBlocksResult> {
  const { prompt: fullPrompt, vars } = await buildPlanPrompt(state, task, codeContext, violationsText, uiDoc, remainingTasks, options);

  // Cache split: use the SAME compacted artifacts that buildPlanPrompt rendered
  // into fullPrompt. Using un-compacted originals would cause replace() mismatches.
  const pipelineArtifacts = resolveArtifacts(state.artifacts || [],
    { taskType: task.type, include: task.include },
    { threshold: 30_000 });
  const artifactContents = pipelineArtifacts
    .filter(a => a.content && a.content.length > 0)
    .map(a => a.content);
  const totalDocSize = artifactContents.reduce((sum, c) => sum + c.length, 0);

  const blocks: TextContentBlock[] = [];

  if (totalDocSize > 3000) {
    const combinedDocs = artifactContents.join('\n\n---\n\n');
    blocks.push({
      type: 'text',
      text: combinedDocs,
      cache_control: { type: 'ephemeral' },
    });
    let promptWithoutDocs = fullPrompt;
    for (const content of artifactContents) {
      promptWithoutDocs = promptWithoutDocs.replace(content, '[See document in previous block]');
    }
    blocks.push({
      type: 'text',
      text: promptWithoutDocs,
    });
    console.log(`🔥 [Plan] Split prompt into cached documents (${totalDocSize} chars) + prompt (${promptWithoutDocs.length} chars)`);
  } else {
    blocks.push({
      type: 'text',
      text: fullPrompt,
      cache_control: { type: 'ephemeral' },
    });
  }

  return { blocks, vars };
}

/**
 * Determine whether a task requires plan text generation.
 *
 * Tasks that skip planning (LLM never produces a `planText` here; execute
 * node drives directly):
 *   - verification (final pass — diagnostics drive remediation, not a plan)
 *   - doc          (documentation tasks render without a plan stage)
 *   - explain      (response-only mode; no implementation plan needed)
 *
 * test-code used to live here (R1 residual) but was moved back into the
 * standard plan path in F2 (2026-04 test-code infinite-loop fix) so test
 * authoring benefits from keyword / RAG observation and violation
 * feedback on retry like every other code-writing task.
 *
 * R1 — phase layer delegates to per-task predicates so the
 * literal comparisons live only inside `tasks/{type}/model/is.ts`.
 * The `FINAL_VERIFICATION` priority guard is kept as a defence against
 * dynamically-constructed tasks whose `type` is missing (same pattern
 * as `isVerificationTask`).
 */
export function taskRequiresPlan(task: CodeTask): boolean {
  if (task.priority === TASK_PRIORITIES.FINAL_VERIFICATION) return false;
  if (isVerificationTask(task)) return false;
  if (isDocTask(task)) return false;
  if (isExplainTask(task)) return false;
  return true;
}

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
          templatePath: 'jobs/code/nodes/plan/base',
          usedTemplates: ['jobs/code/nodes/plan/rules'],
          resolvedPartials: collectResolvedPartials(['jobs/code/nodes/plan/base', 'jobs/code/nodes/plan/rules']),
          injectedVariables: {
            taskName: task.name,
            taskType: task.type,
            taskDescription: task.description ? `[${task.description.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            include: task.include || undefined,
            packages: task.packages || undefined,
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
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../core/streaming/StreamOrchestrator');

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

  let response = '';
  let capturedUsage: any = undefined;

  // R3: Provisional input-token estimate from prompt char-size. Overwritten
  // by the first `usage_partial` event from the LLM adapter.
  applyEstimatedInputTokens(state, prompt.length);

  for await (const event of llmToUse.stream(
    [{ role: 'user', content: prompt }],
    {
      temperature: LLM_TEMPERATURE.PLAN_GENERATION,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      enableThinking: true,
      thinkingBudget: LLM_THINKING_BUDGET.PLAN,
    }
  )) {
    if (event.type === 'retry') {
      response = '';
      capturedUsage = undefined;
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

    if (event.text) {
      response += event.text;
    }

    if (event.type === 'done') {
      const { extractTokenUsageFromStreamEvent, accumulateTokenUsage, updateKanbanTokenUsage } = await import('../../../../../common/graph/llmHelpers');
      capturedUsage = extractTokenUsageFromStreamEvent(event);
      if (capturedUsage) {
        accumulateTokenUsage(state, capturedUsage, { taskLevel: true, jobLevel: true });
        updateKanbanTokenUsage(state);
      }
    }
  }

  await orchestrator.finalize();

  const { logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
  if (capturedUsage) {
    logTokenUsageToFile(
      state.context?.featurePath,
      state._httpJobId,
      capturedUsage,
      {
        taskId: state.currentTask?.id || 'unknown',
        taskName: state.currentTask?.name || 'unknown',
        node: 'plan-planGen',
        callIndex: 0,
        nodeHistoryLength: 0,
        estimatedPromptChars: prompt.length,
        taskCumulativeInput: 0,
        taskCumulativeOutput: 0,
        recursionCount: state.recursionCount,
      }
    );
  }

  // ✅ Extract <plan> tag content (REQUIRED - structured JSON output)
  const planMatch = response.match(/<plan>([\s\S]*?)<\/plan>/);
  
  if (!planMatch) {
    const hasOpenTag = response.includes('<plan>');
    const outputDelta = capturedUsage?.outputTokens || 0;
    const isTruncation = hasOpenTag || outputDelta >= LLM_MAX_TOKENS.DEFAULT - 500;

    if (isTruncation) {
      console.error(`❌ [Plan] OUTPUT TRUNCATED — response hit max_tokens limit (${outputDelta} output tokens, limit: ${LLM_MAX_TOKENS.DEFAULT})`);
      console.error(`   <plan> open tag found: ${hasOpenTag}, response ends with: "...${response.substring(response.length - 100)}"`);
    } else {
      console.error(`❌ [Plan] <plan> tag not found in LLM response`);
      console.error(`   Response preview: "${response.substring(0, 200)}..."`);
    }

    throw new Error(
      `[Plan] <plan> tag not found. Your ENTIRE response must contain exactly one <plan>{JSON}</plan> block. ` +
      `Do NOT omit the <plan> tags. Do NOT output JSON without wrapping it in <plan>...</plan>.` +
      (isTruncation ? ` [TRUNCATION DETECTED: ${outputDelta} output tokens used, limit ${LLM_MAX_TOKENS.DEFAULT}]` : '')
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

/**
 * Save planText to sessions/debug/plans directory for debugging
 * 
 * Saves to: {featurePath}/sessions/architect/debug/plans/plan-{jobId}.json
 * All task plans for a job are stored in a single JSON file.
 * 
 * @param state - Current graph state
 * @param task - Current task
 * @param planText - Generated plan text (JSON string)
 */
async function savePlanTextForDebug(
  state: ArchitectGraphState,
  task: CodeTask,
  planText: string
): Promise<void> {
  try {
    const featurePath = state.context.featurePath;
    const jobId = state._httpJobId;
    
    if (!featurePath || !jobId) {
      return; // No feature path or jobId available
    }
    
    // Create sessions/architect/debug/plans/ directory
    const planTextDir = getSessionDebugDir(featurePath, 'architect', 'plans');
    await fs.mkdir(planTextDir, { recursive: true });
    
    const filepath = path.join(planTextDir, `plan-${jobId}.json`);
    
    // Load existing plans array or create new
    let plansArray: any[] = [];
    try {
      const existing = await fs.readFile(filepath, 'utf-8');
      plansArray = JSON.parse(existing);
    } catch {
      // File doesn't exist, start fresh
    }
    
    // Determine if this is a replan (retry)
    const retryCount = state.retries || 0;
    
    // Parse planText JSON (or use raw if invalid)
    let planJson: any;
    try {
      planJson = JSON.parse(planText);
    } catch {
      planJson = { raw: planText };
    }
    
    // Build entry for this task
    const entry = {
      taskId: task.id,
      taskName: task.name,
      taskType: task.type,
      priority: task.priority,
      retry: retryCount,
      generated: new Date().toISOString(),
      plan: planJson
    };
    
    plansArray.push(entry);
    
    // Save as JSON
    await fs.writeFile(filepath, JSON.stringify(plansArray, null, 2), 'utf-8');
  } catch (err) {
    // Non-blocking - plan save failed
  }
}

/** Max plan↔tool round-trips before forcing plan finalization.
 * After this many rounds the LLM is called once more WITHOUT tools
 * so it must produce a <plan> from the gathered exploration context. */
export const PLAN_TOOL_LOOP_MAX = 15;

type PlanWithToolsResult =
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

  const { getTools } = await import('./tools');
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
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../core/streaming/StreamOrchestrator');

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
      const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
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

/**
 * Default finalize nudge used when no task-type-specific override exists.
 * Stops further tool calls and asks the LLM to synthesize a `<plan>` from
 * what it has gathered, following the format spec already in the initial
 * prompt. Task types whose initial prompt presents multiple output formats
 * (e.g. test-code's Format A / Format B) need to reinforce the decision
 * under finalize pressure — they publish `plan.finalizeNudge` to override
 * this default. Templates remain the SSOT for output schema; the override
 * only adds a decision-level reminder, never a schema redefinition.
 *
 * Exported so per-task-type tests can assert that hooks publishing their
 * own nudge do NOT accidentally return this default string.
 */
export const FINALIZE_NUDGE =
  'You have finished exploring. Do NOT call any more tools. ' +
  'Based on all tool results above, output exactly one `<plan>{JSON}</plan>` block ' +
  'following the format specified in the initial prompt.';

/**
 * Finalize plan from tool exploration context.
 *
 * Called when the plan↔tool loop hits PLAN_TOOL_LOOP_MAX. Instead of
 * discarding the conversation (which contains valuable tool results like
 * `go doc` output, file contents, etc.), this function makes ONE MORE
 * LLM call with the existing conversation history but WITHOUT tools,
 * forcing the LLM to synthesize a <plan> from what it has gathered.
 *
 * @returns planText string on success, null on failure (caller falls back to generatePlanText)
 */
export async function finalizePlanFromExploration(
  state: ArchitectGraphState,
  history: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>,
  task: CodeTask,
): Promise<string | null> {
  const llm = state.deps?.llm as LLMClient | undefined;
  if (!llm || !history?.length) return null;

  const llmToUse = await selectLLMForTask(llm, task, state);
  if (!llmToUse?.stream) return null;

  // R1 — single-line dispatch. NEVER inline `if (task.type === ...)` here;
  // task-type-specific finalize guidance lives behind `plan.finalizeNudge`.
  const nudge = hooksForTaskType(task.type)?.plan?.finalizeNudge?.({ task, state }) ?? FINALIZE_NUDGE;

  const finalizeMessage: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }> = [
    ...history,
    {
      role: 'user' as const,
      content: nudge,
    },
  ];

  console.log(`📋 [Plan] Finalizing plan from exploration context (${history.length} messages)`);

  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../core/streaming/StreamOrchestrator');

  const createStrategy = () => {
    const strategy = new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'code', undefined);
    strategy.setPlanTaskTitle(task.name);
    strategy.setParallelTaskName(task.name);
    return strategy;
  };

  let orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: createStrategy(),
    existingFiles: new Set(),
  });

  let textResponse = '';
  let tokenUsage: any = undefined;

  // T1 pre-call estimate for the finalize pass.
  applyEstimatedInputTokensFromMessages(state, finalizeMessage);
  for await (const event of llmToUse.stream(finalizeMessage, {
    maxTokens: LLM_MAX_TOKENS.DEFAULT,
    enableThinking: true,
    thinkingBudget: LLM_THINKING_BUDGET.PLAN,
  })) {
    if (event.type === 'retry') {
      textResponse = '';
      tokenUsage = undefined;
      orchestrator = new StreamOrchestrator({
        parser: new XMLStreamParser(),
        renderStrategy: createStrategy(),
        existingFiles: new Set(),
      });
      continue;
    }

    // In-flight gauge update from usage_partial events (Anthropic/Gemini).
    // Overwrite-only; job/task counters are updated at 'done' below.
    maybeUpdatePhaseTokenUsage(state, event);

    await orchestrator.processEvent(event);

    if (event.type === 'text') {
      textResponse += (event as any).text ?? '';
    }
    if (event.type === 'done' && (event as any).usage) {
      tokenUsage = (event as any).usage;
      const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
      accumulateTokenUsage(state, tokenUsage, { taskLevel: true, jobLevel: true });
      updateKanbanTokenUsage(state);
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        tokenUsage,
        {
          taskId: task.id,
          taskName: task.name,
          node: 'plan-finalize',
          callIndex: 0,
          nodeHistoryLength: finalizeMessage.length,
          recursionCount: state.recursionCount,
        },
      );
    }
  }

  await orchestrator.finalize();

  // Log to prompt log for traceability
  const jobId = state._httpJobId || 'unknown';
  if (state.context?.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'plan-finalize',
        finalizeMessage.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0),
        {
          taskId: task.id,
          taskName: task.name,
          templatePath: 'plan-finalize (from exploration)',
          usedTemplates: [],
          resolvedPartials: [],
          injectedVariables: {
            explorationRounds: Math.floor(history.length / 2),
            historyMessages: history.length,
          },
        },
      );
    } catch {
      // Non-blocking
    }
  }

  const planMatch = textResponse.match(/<plan>([\s\S]*?)<\/plan>/);
  if (planMatch) {
    const planText = planMatch[1].trim();
    if (planText.length >= 50) {
      console.log(`✅ [Plan] Finalized plan from exploration (${planText.length} chars)`);

      await savePlanTextForDebug(state, task, planText);
      return planText;
    }
  }

  console.warn(`⚠️ [Plan] finalizePlanFromExploration failed to produce valid <plan>, falling back`);
  return null;
}
