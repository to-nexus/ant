/**
 * UI Design Decompose
 * 
 * LLM-driven task decomposition for UI design work
 * (ui-tokens.json, ui-assets.json, ui-spec.json).
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../../types/task";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../common/graph/llmConfig";
import { logErrorHeader } from "../../../code/nodes/_common/errorHandler";
import { updateKanban, createDesignTaskStreamingHook } from "./kanbanUpdate";
import { resolveLLMClient, showChatPlaceholder } from "./llmClient";
import { applyEstimatingUsage } from "../../../../../common/graph/llmHelpers";
import { parseLLMJsonResponse } from "../../utils/jsonResponseParser";
import { safeLogPrompt } from "../../utils/promptLog";
import { saveDecomposeCheckpoint } from "../../session/checkpoint";
import { ARTIFACT_PREFIX, BOUNDARY, buildTechTier, type TechTierConfig, SURFACE_SYSTEM_VARIANTS, SPATIAL_SYSTEM_VARIANTS, getVisualLanguagesWithModes, isTierActive, getEffectiveDomain, getConfigSlots } from "@ant/shared";
import { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { parseExecutionTierTag, coerceExecutionTier, recordUserTurnMeta } from "../../../../../../core/executionTier";

interface DecomposeContext {
  phaseStart: number;
  newJobId: string;
  newJobTiming: any;
}

/**
 * Handle UI design decomposition via LLM.
 */
export async function decomposeUiDesign(
  state: DesignGraphState,
  ctx: DecomposeContext
): Promise<DesignGraphState> {
  const {
    DECOMPOSE_SOURCE_THRESHOLD,
    READ_SOURCE_DOC_TOOL,
    handleReadSourceFile,
  } = await import('../docGen/sourceSelector');
  const { callLLMWithToolLoop } = await import('../../../../../common/llm/callLLMWithToolLoop');
  const { buildDecomposeContext } = await import('./buildDecomposeContext');

  const pool = new ArtifactPoolView(state.artifacts || []);
  const sourceRecord = pool.sourcesAsRecord();

  // Role-aware partition (refs / context preserved). The legacy
  // `uiContext` string with the hard-coded "PRD:" header is replaced by
  // `<sources role="…" doc="{PRD|GDD}">` blocks rendered by the shared
  // input-context partial — game-domain pools now correctly render as
  // GDD instead of being mislabelled.
  const decomposeCtx = buildDecomposeContext(pool, state, {
    includePreviousDesign: false,
    toolModeThreshold: DECOMPOSE_SOURCE_THRESHOLD,
  });
  const useToolMode = decomposeCtx.meta.sourcesMode === 'tool';
  console.log(
    `📊 [UIDecompose] sourcesMode=${decomposeCtx.meta.sourcesMode}, ` +
    `refSize=${decomposeCtx.meta.refSize.toLocaleString()}, ` +
    `contextSize=${decomposeCtx.meta.contextSize.toLocaleString()}, ` +
    `threshold=${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()}`,
  );

  const { isFigmaPipeline, isFigmaDataPopulated } = await import('@ant/shared');
  const sourceFileNames = pool.sourceFileNames();
  const isFigmaMode = isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));
  if (isFigmaMode && !sourceFileNames.includes('figma.json')) {
    sourceFileNames.push('figma.json');
  }

  // Render prompt — figma mode dispatches to the by-figma variant; all
  // other UI design entry points (gen-ui-desc / rev-ui) share the
  // description-driven by-desc variant. The legacy `by-ref` variant has
  // been removed alongside the gen-ui-ref intent.
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  const templateSuffix = isFigmaMode ? 'by-figma' : 'by-desc';
  const decomposeTemplatePath = `jobs/design/nodes/decompose/variants/ui-design-${templateSuffix}/base`;

  const uiDecomposePrompt = await promptAdapter.render(decomposeTemplatePath, {
    documentName: decomposeCtx.documentName,
    refs: decomposeCtx.refs,
    context: decomposeCtx.context,
    directive: decomposeCtx.directive,
    assetCount: state.uiAssetsList
      ? Object.values(state.uiAssetsList).reduce((sum, arr) => sum + arr.length, 0)
      : 0,
    detectedMode: state.resolvedAction?.mode || 'generate',
    sourceFileNames: sourceFileNames.length > 0 ? sourceFileNames : undefined,
    nodeSummary: isFigmaMode && state.figmaExplorationResult?.nodeSummary
      ? state.figmaExplorationResult.nodeSummary
          .map(n => `${'  '.repeat(n.depth)}${n.type} "${n.name}" nodeId=${n.nodeId} (${n.childCount} children)`)
          .join('\n')
      : undefined,
    variationMatrixSummary: isFigmaMode && state.figmaExplorationResult?.variationMatrix?.length
      ? state.figmaExplorationResult.variationMatrix
          .map(v => {
            const widths = [...new Set(v.frames.map(f => Math.round(f.width)))].sort((a, b) => b - a);
            return `"${v.section}" (${v.pageNodeId}): [${widths.map(w => w + 'px').join(', ')}]`;
          })
          .join('\n')
      : undefined,
    availableVisualLanguagesWithModes: getVisualLanguagesWithModes(),
    availableSurfaceSystems: SURFACE_SYSTEM_VARIANTS.join(', '),
    availableSpatialSystems: SPATIAL_SYSTEM_VARIANTS.join(', '),
    visualTierActive: isTierActive(
      'visualTier',
      state.resolvedAction?.intent ? getConfigSlots(state.resolvedAction.intent)?.basis : undefined,
      getEffectiveDomain(state.resolvedAction?.domain),
      { techTier: state.resolvedAction?.basis?.techTier, hasUiDoc: pool.hasUi() },
    ),
  });

  await safeLogPrompt(
    state.context.featurePath,
    state.jobId || state._httpJobId || 'unknown',
    'decompose-uiDesign',
    uiDecomposePrompt.length,
    {
      templatePath: decomposeTemplatePath,
      usedTemplates: [`jobs/design/nodes/decompose/variants/ui-design-${templateSuffix}/rules`],
    },
  );

  try {
    await showChatPlaceholder();
    const llmToUse = await resolveLLMClient(state);
    if (!llmToUse) throw new Error('LLM client not available');
    
    let textResponse: string;

    // Streaming Kanban hook — surfaces each `<task>` JSON as it streams
    // out of the tool loop so the todo column fills task-by-task instead
    // of in a single post-decompose burst (mirrors code-decompose's
    // accumulatedTasks pattern; see kanbanUpdate.ts).
    const streamingHook = createDesignTaskStreamingHook(state);

    // Both tool-mode (RAG) and inline-mode go through `callLLMWithToolLoop`
    // — the tool list is empty when useToolMode=false so the loop terminates
    // after the first streamed response. The shared path guarantees the
    // streaming Kanban hook fires regardless of source size; previously the
    // inline branch used `invokeWithUsage` (single-shot) and `<task>` wrappers
    // never reached `XMLStreamParser` so the todo column always landed in one
    // burst at the end.
    const tools = useToolMode && pool.hasSources() ? [READ_SOURCE_DOC_TOOL] : [];
    const { response: streamedResponse, usage } = await callLLMWithToolLoop(
      llmToUse,
      [{ role: 'user', content: uiDecomposePrompt }],
      tools,
      (name, args) => {
        if (name === 'read_source_doc') {
          return handleReadSourceFile(args.filename, sourceRecord, args.startLine, args.endLine);
        }
        return `Error: Unknown tool "${name}"`;
      },
      {
        temperature: LLM_TEMPERATURE.DECOMPOSE,
        maxTokens: LLM_MAX_TOKENS.DEFAULT,
        enableThinking: true,
        thinkingBudget: 10000,
        state: state as any,
        onTaskParsed: streamingHook.onTaskParsed,
      },
    );
    textResponse = streamedResponse;
    applyEstimatingUsage(state, 'decompose', usage, { subNode: 'ui', promptChars: uiDecomposePrompt.length });

    // ExecutionTier: LLM SSOT — `<executionTier>N</executionTier>` emitted
    // BEFORE the JSON output. Missing tag degrades to Tier 0 Reflex.
    const executionTier = coerceExecutionTier(
      parseExecutionTierTag(textResponse),
      'UIDecompose',
    );
    console.log(`🧭 [UIDecompose] executionTier=${executionTier}`);

    // Parse and validate
    const parsedResponse = parseLLMJsonResponse(textResponse);
    const response: {
      strategy?: string;
      targetFiles: string[];
      tasks: Array<{
        id: string;
        name: string;
        targetFile: string;
        description: string;
        priority: number;
        parallelGroup?: string;
      }>;
    } = parsedResponse;

    if (!response.targetFiles || !response.tasks) {
      throw new Error('Invalid UI task breakdown format from LLM');
    }

    // Build task queue
    const taskQueue = new TaskQueue<DesignTask>();
    response.tasks.forEach((task) => {
      const baseName = task.targetFile.replace(/\.json$/, '');
      const isAssets = baseName === 'ui-assets';

      // tokens/spec: chapter-specific parallelGroup (enables parallel execution)
      // assets: shared group (keeps sequential — category conflicts possible)
      let parallelGroup: string;
      if (typeof task.parallelGroup === 'string') {
        parallelGroup = isAssets ? baseName : task.parallelGroup;
      } else {
        parallelGroup = isAssets ? baseName : task.id;
      }
      
      const sf: string[] = Array.isArray((task as any).sourceFiles) ? [...(task as any).sourceFiles] : [];
      if (isFigmaMode && !sf.includes('figma.json')) {
        sf.push('figma.json');
      }

      // In figma mode, include the canonical figma workfile reference
      // (visual/ui/figma/figma.json) so UI design tasks can read it via the
      // artifact pool. Single injection SSOT — `include`; role is inherited
      // from the pool's RAC annotation.
      const includePrefixes = isFigmaMode
        ? [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.UI_ANT, ARTIFACT_PREFIX.UI_FIGMA]
        : [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.UI_ANT];

      taskQueue.push({
        id: task.id,
        name: task.name,
        type: 'doc',
        priority: task.priority,
        description: task.description,
        sourceFiles: sf.length > 0 ? sf : undefined,
        include: includePrefixes,
        completed: false,
        targetFile: task.targetFile,
        parallelGroup,
      } as DesignTask);
    });

    // Pre-compute forceAppend and isLastTaskForDocument per targetFile group
    const tasksByFile = new Map<string, DesignTask[]>();
    for (const task of taskQueue.getAll()) {
      const file = task.targetFile || '';
      if (!tasksByFile.has(file)) tasksByFile.set(file, []);
      tasksByFile.get(file)!.push(task);
    }
    for (const [, tasks] of tasksByFile.entries()) {
      tasks.sort((a, b) => (a.priority || 0) - (b.priority || 0));

      // anchorAfterSection used to be pre-computed here, but it always returned
      // null in new-build scenarios (target file is still empty at decompose
      // time). The insertion anchor is now computed live in docGen each turn —
      // see `design/_shared/anchor.ts` and `nodes/docGen/intent/ui.ts`.
      for (let i = 0; i < tasks.length; i++) {
        if (i > 0) tasks[i].forceAppend = true;
        if (i === tasks.length - 1) tasks[i].isLastTaskForDocument = true;
      }
    }

    if (sourceFileNames.length > 0) {
      for (const task of taskQueue.getAll()) {
        if (!task.sourceFiles || task.sourceFiles.length === 0) {
          console.warn(`⚠️ [UI Decompose] task "${task.id}" missing sourceFiles`);
        }
      }
    }

    console.log(`✅ UI decompose: ${taskQueue.size()} tasks (${response.strategy || 'chapter-based'} strategy)`);

    // Finalize estimating phase
    const phaseBreakdown = { ...(state._phaseTimings || {}), decompose: Date.now() - ctx.phaseStart };
    const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(ctx.newJobTiming, ctx.newJobTiming.startedAt, phaseBreakdown);
    if (state.deps?.kanbanUpdate?.setJobTiming) {
      state.deps.kanbanUpdate.setJobTiming(finalJobTiming);
    }

    // VisualTier resolution (gen-ui-desc) — suppressed when a UI design doc
    // (ant / figma / handoff) is already in the RAC pool: the doc IS the
    // design-system authority and a parallel visualTier would conflict.
    const uiDocPresent = pool.hasUi();
    if (
      state.resolvedAction?.intent === 'gen-ui-desc' &&
      isTierActive(
        'visualTier',
        getConfigSlots(state.resolvedAction.intent)?.basis,
        getEffectiveDomain(state.resolvedAction?.domain),
        { techTier: state.resolvedAction?.basis?.techTier, hasUiDoc: uiDocPresent },
      )
    ) {
      const { resolveVisualTierFromDecompose } = await import('../../../../../common/visualTierResolver');
      const resolvedVT = resolveVisualTierFromDecompose(
        textResponse,
        state.resolvedAction?.basis?.visualTier,
      );
      if (resolvedVT) {
        state.resolvedAction = {
          ...state.resolvedAction!,
          basis: {
            ...state.resolvedAction?.basis,
            visualTier: {
              ...state.resolvedAction?.basis?.visualTier,
              ...resolvedVT,
            },
          },
        };
        console.log(`✅ VisualTier: ${resolvedVT.visualLanguage ?? '-'}/${resolvedVT.surfaceSystem ?? '-'}/${resolvedVT.spatialSystem ?? '-'}`);
      }
    } else if (
      uiDocPresent &&
      state.resolvedAction?.basis?.visualTier &&
      Object.keys(state.resolvedAction.basis.visualTier).length > 0
    ) {
      state.resolvedAction = {
        ...state.resolvedAction,
        basis: {
          ...state.resolvedAction.basis,
          visualTier: undefined,
        },
      };
      console.log('🎨 VisualTier: suppressed (UI design doc present — doc is the design-system authority)');
    }

    // UI design is always frontend
    const uiTechTier = buildTechTier(state.profile, 'frontend');
    console.log(`✅ TechTier: stack=frontend, language=${uiTechTier.language}, framework=${uiTechTier.framework || 'none'}`);

    // Sync to RAC basis.techTier so getTechTier(state) returns it
    const basisTechTierConfig: TechTierConfig = {
      stack: 'frontend',
      frontend: { ...uiTechTier, stack: 'frontend' as const },
    };
    state.resolvedAction = {
      ...state.resolvedAction!,
      basis: { ...state.resolvedAction?.basis, techTier: basisTechTierConfig },
    };

    state.jobId = ctx.newJobId;
    state.jobTiming = finalJobTiming;
    state.executionTier = executionTier;
    await saveDecomposeCheckpoint(state, {
      taskQueue: taskQueue.getAll(),
      completedTasks: [],
      completedTasksDetails: [],
    });

    // Update Kanban
    updateKanban(state, null, taskQueue.getAll());

    await recordUserTurnMeta({
      session: state.deps?.session,
      turnId: state.turnId,
      jobId: ctx.newJobId,
      jobType: 'design',
      executionTier,
      nodeLabel: 'UIDecompose',
    });

    return {
      ...state,
      taskQueue,
      completedTasks: [],
      completedTasksDetails: [],
      _httpJobId: state._httpJobId,
      jobId: ctx.newJobId,
      jobTiming: finalJobTiming,
      executionTier,
      boundary: BOUNDARY.HEAVYWEIGHT,
    };
  } catch (error: any) {
    logErrorHeader('decompose');
    console.error(error);
    throw error;
  }
}
