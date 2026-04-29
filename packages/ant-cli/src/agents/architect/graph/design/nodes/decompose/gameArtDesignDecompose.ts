/**
 * GameArt Design Decompose
 *
 * LLM-driven task decomposition for **game-art design work** —
 * `game-art-tokens.json` / `game-art-assets.json` / `game-art-spec.json`
 * under `visual/game-art/ant/` (D24-revised v8, sub-source structure).
 *
 * Key differences from `decomposeUiDesign`:
 *   - Surface = game-art (not UI). Output dir is flat (no ant/figma/handoff).
 *   - Categories instead of chapters (D25). The LLM picks dictionary keys
 *     (effects / characters / projectiles / ...).
 *   - Asset entries carry `kind: 'inline' | 'external'` (D20).
 *   - `gameArtTier.{concept,perspective}` is the active tier (D18 — UI
 *     tier `visualTier` is not in scope here).
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
import { ARTIFACT_PREFIX, BOUNDARY, buildTechTier, type TechTierConfig, GAME_ART_CONCEPT_VARIANTS, isFigmaPipeline, isFigmaDataPopulated } from "@ant/shared";
import { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { parseExecutionTierTag, coerceExecutionTier, recordUserTurnMeta } from "../../../../../../core/executionTier";

interface DecomposeContext {
  phaseStart: number;
  newJobId: string;
  newJobTiming: any;
}

/**
 * Pick the decompose template variant based on the chosen intent.
 *
 * - `gen-game-art-figma` → `by-figma` (Figma MCP-driven catalog generation)
 * - `gen-game-art-desc`, `rev-game-art` and any other entry point → `by-desc`
 *   (directive-driven generation; `rev-game-art` modifies an existing
 *   game-art document and shares the directive contract)
 */
function pickGameArtDesignVariant(state: DesignGraphState): 'by-figma' | 'by-desc' {
  const intent = state.resolvedAction?.intent;
  if (intent === 'gen-game-art-figma') return 'by-figma';
  return 'by-desc';
}

/**
 * Handle game-art design decomposition via LLM.
 */
export async function decomposeGameArtDesign(
  state: DesignGraphState,
  ctx: DecomposeContext,
): Promise<DesignGraphState> {
  const {
    DECOMPOSE_SOURCE_THRESHOLD,
    READ_SOURCE_DOC_TOOL,
    decomposeWithToolLoop,
    handleReadSourceFile,
  } = await import('../docGen/sourceSelector');
  const { buildDecomposeContext } = await import('./buildDecomposeContext');

  const pool = new ArtifactPoolView(state.artifacts || []);
  const sourceRecord = pool.sourcesAsRecord();

  // Role-aware partition. The shared input-context partial replaces the
  // legacy `directiveContext` string with `<sources role="…" doc="GDD">`
  // (game domain) so the prompt mirrors the RAC-assigned roles instead
  // of flattening everything under a hard-coded "PRD:" header.
  const decomposeCtx = buildDecomposeContext(pool, state, {
    includePreviousDesign: false,
    toolModeThreshold: DECOMPOSE_SOURCE_THRESHOLD,
  });
  const useToolMode = decomposeCtx.meta.sourcesMode === 'tool';
  console.log(
    `📊 [GameArtDecompose] sourcesMode=${decomposeCtx.meta.sourcesMode}, ` +
    `refSize=${decomposeCtx.meta.refSize.toLocaleString()}, ` +
    `contextSize=${decomposeCtx.meta.contextSize.toLocaleString()}, ` +
    `threshold=${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()}`,
  );

  const sourceFileNames = pool.sourceFileNames();
  const variant = pickGameArtDesignVariant(state);
  const isFigmaMode = variant === 'by-figma'
    && isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig));
  if (isFigmaMode && !sourceFileNames.includes('figma.json')) {
    sourceFileNames.push('figma.json');
  }

  // Render prompt
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  const decomposeTemplatePath = `jobs/design/nodes/decompose/variants/game-art-design-${variant}/base`;

  // Asset count is sourced from `assets/game/` (D19-revised) when
  // workspace.domain is `game`. The pool view's `uiAssetsList` is reused
  // here because the asset-handler routing (D22 auto-effect) already
  // points it at the game pool. If a future reorg splits the lists,
  // this is the single dispatch point to update.
  const assetCount = state.uiAssetsList
    ? Object.values(state.uiAssetsList).reduce((sum, arr) => sum + arr.length, 0)
    : 0;

  const artDecomposePrompt = await promptAdapter.render(decomposeTemplatePath, {
    documentName: decomposeCtx.documentName,
    refs: decomposeCtx.refs,
    context: decomposeCtx.context,
    directive: decomposeCtx.directive,
    assetCount,
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
    gameArtConceptCandidates: GAME_ART_CONCEPT_VARIANTS.map((v: string) => `\`${v}\``).join(', '),
    resolvedAction: state.resolvedAction,
  });

  await safeLogPrompt(
    state.context.featurePath,
    state.jobId || state._httpJobId || 'unknown',
    'decompose-gameArtDesign',
    artDecomposePrompt.length,
    {
      templatePath: decomposeTemplatePath,
      usedTemplates: [`jobs/design/nodes/decompose/variants/game-art-design-${variant}/rules`],
    },
  );

  try {
    await showChatPlaceholder();
    const llmToUse = await resolveLLMClient(state);
    if (!llmToUse) throw new Error('LLM client not available');

    let textResponse: string;

    // Streaming Kanban hook — surfaces each `<task>` JSON as it streams
    // out of the tool loop. See kanbanUpdate.ts for the accumulator
    // contract; mirrors the ui / system / code-decompose pattern.
    const streamingHook = createDesignTaskStreamingHook(state);

    // Both tool-mode (RAG) and inline-mode go through `decomposeWithToolLoop`
    // — tools is empty in inline-mode so the loop terminates after a single
    // streamed round. The shared path guarantees the streaming Kanban hook
    // fires regardless of source size; the previous `invokeWithUsage` inline
    // branch never gave `XMLStreamParser` any text to scan, so the todo
    // column landed in one burst at stream end.
    const tools = useToolMode && pool.hasSources() ? [READ_SOURCE_DOC_TOOL] : [];
    const { response: streamedResponse, usage } = await decomposeWithToolLoop(
      llmToUse,
      [{ role: 'user', content: artDecomposePrompt }],
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
    applyEstimatingUsage(state, 'decompose', usage, { subNode: 'gameArt', promptChars: artDecomposePrompt.length });

    // ExecutionTier: LLM SSOT — `<executionTier>N</executionTier>` emitted
    // BEFORE the JSON output. Missing tag degrades to Tier 0 Reflex.
    const executionTier = coerceExecutionTier(
      parseExecutionTierTag(textResponse),
      'GameArtDecompose',
    );
    console.log(`🧭 [GameArtDecompose] executionTier=${executionTier}`);

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
      throw new Error('Invalid game-art task breakdown format from LLM');
    }

    // Build task queue
    const taskQueue = new TaskQueue<DesignTask>();
    response.tasks.forEach((task) => {
      // Each game-art category task owns its own parallelGroup (one
      // category = one top-level dictionary key, no merge conflict).
      // Tokens is a single task — also unique group.
      const parallelGroup = typeof task.parallelGroup === 'string' ? task.parallelGroup : task.id;

      const sf: string[] = Array.isArray((task as any).sourceFiles) ? [...(task as any).sourceFiles] : [];
      if (isFigmaMode && !sf.includes('figma.json')) sf.push('figma.json');

      // RAC pool: sources + game-art outputs (+ optional UI ant docs for
      // cross-surface context). D24-revised v8 — game-art now mounts the
      // `ant/` sub-source (canonical), parallel to UI's ant. Figma mode
      // also includes the UI figma workfile reference because game-art
      // figma is Phase 5+ (parser-only hook today).
      const includePrefixes = isFigmaMode
        ? [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.GAME_ART_ANT, ARTIFACT_PREFIX.UI_ANT, ARTIFACT_PREFIX.UI_FIGMA]
        : [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.GAME_ART_ANT, ARTIFACT_PREFIX.UI_ANT];
      const contextPrefixes = isFigmaMode
        ? [ARTIFACT_PREFIX.GAME_ART_ANT, ARTIFACT_PREFIX.UI_ANT, ARTIFACT_PREFIX.UI_FIGMA]
        : [ARTIFACT_PREFIX.GAME_ART_ANT, ARTIFACT_PREFIX.UI_ANT];

      taskQueue.push({
        id: task.id,
        name: task.name,
        type: 'doc',
        priority: task.priority,
        description: task.description,
        sourceFiles: sf.length > 0 ? sf : undefined,
        include: includePrefixes,
        artifactPolicy: {
          refs: [ARTIFACT_PREFIX.SOURCES],
          context: contextPrefixes,
        },
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
    for (const tasks of tasksByFile.values()) {
      tasks.sort((a, b) => (a.priority || 0) - (b.priority || 0));
      for (let i = 0; i < tasks.length; i++) {
        if (i > 0) tasks[i].forceAppend = true;
        if (i === tasks.length - 1) tasks[i].isLastTaskForDocument = true;
      }
    }

    if (sourceFileNames.length > 0) {
      for (const task of taskQueue.getAll()) {
        if (!task.sourceFiles || task.sourceFiles.length === 0) {
          console.warn(`⚠️ [GameArtDecompose] task "${task.id}" missing sourceFiles`);
        }
      }
    }

    console.log(`✅ GameArt decompose: ${taskQueue.size()} tasks (${response.strategy || 'category-based'} strategy)`);

    // Finalize estimating phase
    const phaseBreakdown = { ...(state._phaseTimings || {}), decompose: Date.now() - ctx.phaseStart };
    const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(ctx.newJobTiming, ctx.newJobTiming.startedAt, phaseBreakdown);
    if (state.deps?.kanbanUpdate?.setJobTiming) {
      state.deps.kanbanUpdate.setJobTiming(finalJobTiming);
    }

    // Game-art design is always frontend (rendered through the React/canvas
    // host that owns the engine sub-host).
    const gameArtTechTier = buildTechTier(state.profile, 'frontend');
    console.log(`✅ TechTier: stack=frontend, language=${gameArtTechTier.language}, framework=${gameArtTechTier.framework || 'none'}`);

    const basisTechTierConfig: TechTierConfig = {
      stack: 'frontend',
      frontend: { ...gameArtTechTier, stack: 'frontend' as const },
    };
    state.resolvedAction = {
      ...state.resolvedAction!,
      basis: { ...state.resolvedAction?.basis, techTier: basisTechTierConfig },
    };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Apply <gameArtTier> decision tag (Phase 2 — D18/D28)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Game-art design is the only design-job context that emits `<gameArtTier>`
    // (UI design suppresses it — D18). The matrix gate is implicit:
    // `intentGroup === 'design-game-art'` ⇒ workspace.domain === 'game'
    // (TIER_DOMAIN_MATRIX.gameArtTier=['game']), so reaching this code
    // path already guarantees the tier is active. We always parse + apply
    // (no extra gate needed) so existing explicit basis values are
    // preserved (registry default falls back only when both are missing).
    try {
      const { parseDecisionTags, applyDecisionTagDefaults } =
        await import('../../../../../../core/llm-response/DecisionTagRegistry');
      const decisionTags = parseDecisionTags(textResponse);
      const applied = applyDecisionTagDefaults(decisionTags.parsed, ['gameArtTier']);
      const emittedGameArtTier = applied.gameArtTier as
        | import('@ant/shared').GameArtTier
        | undefined;
      if (emittedGameArtTier) {
        const existing = state.resolvedAction.basis?.gameArtTier ?? {};
        // Explicit-over-infer (10.2): existing axes WIN. The LLM can only
        // fill axes the user did not pre-specify in `actionMetadata.basis`.
        const merged: import('@ant/shared').GameArtTier = {
          ...emittedGameArtTier,
          ...existing,
        };
        state.resolvedAction = {
          ...state.resolvedAction,
          basis: { ...state.resolvedAction.basis, gameArtTier: merged },
        };
        console.log(
          `🎨 [GameArtDecompose] gameArtTier applied: ${Object.entries(merged)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}`,
        );
      } else if (decisionTags.violations.length > 0) {
        console.warn(
          `⚠️ [GameArtDecompose] <gameArtTier> violations: ` +
            decisionTags.violations.map(v => v.message).join('; '),
        );
      }
    } catch (e) {
      console.warn(`⚠️ [GameArtDecompose] decision-tag apply skipped:`, e);
    }

    state.jobId = ctx.newJobId;
    state.jobTiming = finalJobTiming;
    state.executionTier = executionTier;
    await saveDecomposeCheckpoint(state, {
      taskQueue: taskQueue.getAll(),
      completedTasks: [],
      completedTasksDetails: [],
    });

    updateKanban(state, null, taskQueue.getAll());

    await recordUserTurnMeta({
      session: state.deps?.session,
      turnId: state.turnId,
      jobId: ctx.newJobId,
      jobType: 'design',
      executionTier,
      nodeLabel: 'GameArtDecompose',
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
