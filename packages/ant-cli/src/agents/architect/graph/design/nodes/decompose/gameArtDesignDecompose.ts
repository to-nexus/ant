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
import { resolveReviseSubSource, resolveReviseTarget } from "../../_shared/reviseTarget";
import { validateHandoffReviseTargets } from "./handoffTargetGate";
import { buildDesignDiscoveryTools } from "./designDecomposeTools";
import { appendPrdSyncTasks, resolvePrdSyncTargets } from "./prdSync";
import { safeLogPrompt } from "../../utils/promptLog";
import { saveDecomposeCheckpoint } from "../../session/checkpoint";
import { ARTIFACT_PREFIX, BOUNDARY, buildTechTier, type TechTierConfig, GAME_ART_CONCEPT_VARIANTS, GAME_ART_PERSPECTIVE_VARIANTS, getGameArtConceptsWithPerspectives } from "@ant/shared";
import { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { parseExecutionTierTag, coerceExecutionTier, recordUserTurnMeta } from "../../../../../../core/executionTier";

interface DecomposeContext {
  phaseStart: number;
  newJobId: string;
  newJobTiming: any;
}

/**
 * Pick the decompose template variant.
 *
 * - `docFormat === 'handoff'` → `by-handoff` (Claude-Design-style bundle:
 *   gen-game-art-desc producer, or rev-game-art revising a handoff bundle
 *   in place — resolver SSOT: design/_shared/outputFormat.ts)
 * - `gen-game-art-figma` → `by-figma` (Figma MCP-driven catalog generation)
 * - any other entry point → `by-desc` (legacy JSON contract — rev-game-art
 *   on an ant source)
 */
function pickGameArtDesignVariant(
  state: DesignGraphState,
  docFormat: 'json' | 'handoff',
): 'by-figma' | 'by-desc' | 'by-handoff' {
  if (docFormat === 'handoff') return 'by-handoff';
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
    handleReadSourceFile,
  } = await import('../execute/sourceSelector');
  const { callLLMWithToolLoop } = await import('../../../../../common/llm/callLLMWithToolLoop');
  const { buildDecomposeContext } = await import('./buildDecomposeContext');

  const pool = new ArtifactPoolView(state.artifacts || []);
  const sourceRecord = pool.sourcesAsRecord();

  // Role-aware partition. The shared input-context partial replaces the
  // legacy `directiveContext` string with `<sources role="…" doc="PRD">`
  // blocks so the prompt mirrors the RAC-assigned roles instead of
  // flattening everything under a hard-coded "PRD:" header. The plan
  // document is the domain-neutral PRD in every domain.
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
  // Revise: the selected ref sub-source is the SSOT that decides docFormat +
  // variant + output dir (design/_shared/reviseTarget.ts). This fixes the old
  // asymmetry where rev-game-art on a figma ref could never reach `by-figma`.
  // Generate keeps the intent-driven picker.
  const isRevise = state.resolvedAction?.intent === 'rev-game-art';
  const reviseTarget = isRevise
    ? resolveReviseTarget(resolveReviseSubSource(state, 'game-art'), 'game-art')
    : null;
  const { resolveDesignOutputFormat } = await import('../../_shared/outputFormat');
  const docFormat = reviseTarget ? reviseTarget.docFormat : resolveDesignOutputFormat(state, 'game-art');
  const variant = reviseTarget ? reviseTarget.variant : pickGameArtDesignVariant(state, docFormat);
  const isFigmaMode = variant === 'by-figma';
  if (isFigmaMode && !sourceFileNames.includes('figma.json')) {
    sourceFileNames.push('figma.json');
  }

  // Render prompt
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  const decomposeTemplatePath = `jobs/design/nodes/decompose/variants/game-art-design-${variant}/base`;

  // Asset count from the domain-scoped `assetInventory` (populated at resolve
  // via `indexAssetPool`, pointed at `assets/game/` for the game domain).
  const assetCount = state.assetInventory?.count ?? 0;

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
    // Concept ids annotated with supported perspective(s) + the perspective
    // candidate list — the game-art-tier-detection partial uses both to
    // constrain the perspective pick to the chosen concept's support.
    gameArtConceptsWithPerspectives: getGameArtConceptsWithPerspectives(),
    gameArtPerspectiveCandidates: GAME_ART_PERSPECTIVE_VARIANTS.map((v: string) => `\`${v}\``).join(', '),
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

    // Both tool-mode (RAG) and inline-mode go through `callLLMWithToolLoop`
    // — tools is empty in inline-mode so the loop terminates after a single
    // streamed round. The shared path guarantees the streaming Kanban hook
    // fires regardless of source size; the previous `invokeWithUsage` inline
    // branch never gave `XMLStreamParser` any text to scan, so the todo
    // column landed in one burst at stream end.
    // Discovery tools: `read_file` + `list_files`, RAC-gated, available to
    // EVERY design decompose intent (mirrors code decompose). Lets the LLM
    // dereference handoff STUBS during revise and survey bundle structure —
    // `read_source_doc` only reads plan/ sources from an in-memory record.
    const discovery = await buildDesignDiscoveryTools(state);
    const sourceTools = useToolMode && pool.hasSources() ? [READ_SOURCE_DOC_TOOL] : [];
    const tools = [...discovery.tools, ...sourceTools];
    const toolHandler = async (name: string, args: any): Promise<string> => {
      if (name === 'read_source_doc') {
        return handleReadSourceFile(args.filename, sourceRecord, args.startLine, args.endLine);
      }
      const discovered = await discovery.dispatch(name, args);
      if (discovered !== null) return discovered;
      return `Error: Unknown tool "${name}"`;
    };

    // Repair-call — one corrective round on contract mismatch (mirrors
    // systemDesignDecompose.repairCall). Prevents a single off-contract
    // response from crashing the process via the hard parser.
    const repairCall = async (rawResponse: string, errorMessage: string): Promise<string> => {
      const truncated = rawResponse.length > 4000 ? rawResponse.slice(0, 4000) + '\n...[truncated]' : rawResponse;
      const { response: repaired, usage: repairUsage } = await callLLMWithToolLoop(
        llmToUse,
        [
          { role: 'user' as const, content: artDecomposePrompt },
          { role: 'assistant' as const, content: truncated },
          {
            role: 'user' as const,
            content:
              `Your previous response did not match the required contract.\n\n` +
              `Error: ${errorMessage}\n\n` +
              `Re-emit strictly in the contract from the original prompt: ` +
              `\`<executionTier>\` first, then \`<targetFiles>\`, then a \`<tasks>\` block ` +
              `with one \`<task>{json}</task>\` per task. NO markdown fences. ` +
              `NO \`<decompose>\` wrapper. Output the contract only — no other prose.`,
          },
        ],
        [],
        () => `Error: tools are not available in repair mode`,
        {
          temperature: LLM_TEMPERATURE.DECOMPOSE,
          maxTokens: LLM_MAX_TOKENS.DEFAULT,
          enableThinking: true,
          thinkingBudget: 10000,
          state: state as any,
          onTaskParsed: streamingHook.onTaskParsed,
        },
      );
      applyEstimatingUsage(state, 'decompose', repairUsage, { subNode: 'gameArt-repair', promptChars: artDecomposePrompt.length });
      return repaired;
    };

    const { response: streamedResponse, usage } = await callLLMWithToolLoop(
      llmToUse,
      [{ role: 'user', content: artDecomposePrompt }],
      tools,
      toolHandler,
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

    type GameArtDecomposed = {
      strategy?: string;
      targetFiles: string[];
      tasks: Array<{
        id: string;
        name: string;
        targetFile: string;
        description: string;
        priority: number;
        parallelGroup?: string;
        newFile?: boolean;
        removeFiles?: string[];
      }>;
    };

    // Parse + validate + handoff invariants, funnelled so any contract
    // mismatch triggers the single repair round.
    const parseAndValidate = (text: string): { parsed: any; response: GameArtDecomposed } => {
      const parsed = parseLLMJsonResponse(text);
      const resp = parsed as GameArtDecomposed;
      if (!resp.targetFiles || !resp.tasks) {
        throw new Error('Invalid game-art task breakdown format from LLM');
      }
      // Handoff bundle invariants (fail-loud) — mirrors uiDesignDecompose.
      if (docFormat === 'handoff') {
        for (const t of resp.tasks) {
          if (!t.targetFile) {
            throw new Error(`[GameArtDecompose] handoff task "${t.id}" is missing targetFile`);
          }
          if (t.id.startsWith('ui-assets-') || t.id.startsWith('game-art-assets-')) {
            throw new Error(
              `[GameArtDecompose] handoff task id "${t.id}" collides with the ant-JSON asset-validation prefix — use game-art-handoff-*`,
            );
          }
        }
        // Refactor: the on-disk bundle is the layout authority — every
        // targetFile must be an existing bundle path (or a `newFile: true`
        // addition inside the existing directory family).
        validateHandoffReviseTargets({
          tasks: resp.tasks,
          artifacts: state.artifacts || [],
          bundlePrefix: ARTIFACT_PREFIX.GAME_ART_HANDOFF,
          mode: state.resolvedAction?.mode,
          tag: '[GameArtDecompose]',
        });
      }
      return { parsed, response: resp };
    };

    let parsedResponse: any;
    let response: GameArtDecomposed;
    try {
      ({ parsed: parsedResponse, response } = parseAndValidate(textResponse));
    } catch (parseError) {
      console.warn(`⚠️  [GameArtDecompose] Parse failed: ${(parseError as Error).message}. Sending repair call...`);
      streamingHook.reset();
      const repaired = await repairCall(textResponse, (parseError as Error).message);
      textResponse = repaired;
      // Re-parse — throws to the outer catch if the repaired response also fails.
      ({ parsed: parsedResponse, response } = parseAndValidate(textResponse));
    }

    // ExecutionTier: LLM SSOT — `<executionTier>N</executionTier>` emitted
    // BEFORE the JSON output. Missing tag degrades to Tier 0 Reflex.
    // Computed from the FINAL (possibly repaired) response.
    const executionTier = coerceExecutionTier(
      parseExecutionTierTag(textResponse),
      'GameArtDecompose',
    );
    console.log(`🧭 [GameArtDecompose] executionTier=${executionTier}`);

    // Build task queue
    const taskQueue = new TaskQueue<DesignTask>();
    response.tasks.forEach((task) => {
      // Each game-art category task owns its own parallelGroup (one
      // category = one top-level dictionary key, no merge conflict).
      // Tokens is a single task — also unique group.
      const parallelGroup = typeof task.parallelGroup === 'string' ? task.parallelGroup : task.id;

      const sf: string[] = Array.isArray((task as any).sourceFiles) ? [...(task as any).sourceFiles] : [];
      if (isFigmaMode && !sf.includes('figma.json')) sf.push('figma.json');

      // Single injection SSOT — `include`; role inherited from RAC pool.
      // Handoff mode: tasks see the bundle itself (revise-in-place + later
      // stages reading earlier-stage files via the pool refresh). The legacy
      // WS2 §3E observe-only branch (handoff upload → ant JSON catalog) is
      // retired — rev-game-art on a handoff source now revises the bundle in
      // place via the resolver; handoff → ant JSON is the deferred converter
      // intent's job. JSON mode: sources + game-art ant (+ UI ant for
      // cross-surface context; figma workfile in figma mode — game-art figma
      // itself is a Phase 5+ parser hook).
      const includePrefixes: string[] = docFormat === 'handoff'
        ? [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.GAME_ART_HANDOFF]
        : isFigmaMode
          ? [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.GAME_ART_ANT, ARTIFACT_PREFIX.UI_ANT, ARTIFACT_PREFIX.UI_FIGMA]
          : [ARTIFACT_PREFIX.SOURCES, ARTIFACT_PREFIX.GAME_ART_ANT, ARTIFACT_PREFIX.UI_ANT];

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
        // Merge-then-delete carrier (refactor × handoff) — gate-validated.
        ...(Array.isArray(task.removeFiles) && task.removeFiles.length > 0
          ? { removeFiles: task.removeFiles }
          : {}),
        parallelGroup,
        // targetDir is stamped explicitly for handoff (gen + rev) and for
        // ant/figma REVISE (SSOT: reviseTarget). Generate json paths keep the
        // execute-phase `designDirOf` fallback. This makes "ref determines
        // target" a per-task record instead of an implicit filename inference.
        ...(docFormat === 'handoff'
          ? {
              docFormat: 'handoff' as const,
              targetDir: ARTIFACT_PREFIX.GAME_ART_HANDOFF.replace(/\/$/, ''),
            }
          : reviseTarget
            ? { targetDir: reviseTarget.targetDir }
            : {}),
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

    // Cross-intent PRD sync — append a single-owner sync task per validated
    // plan target when the directive asked to keep the PRD in sync (runs LAST).
    appendPrdSyncTasks(taskQueue, resolvePrdSyncTargets((parsedResponse as any).prdSync, pool));

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

      // Persist the settled tier (write-once; explicit wizard values
      // overwrite) so code jobs on this workspace carry it via detect's
      // seedBasisFromWorkspace instead of re-inferring per job.
      if (state.resolvedAction.basis?.gameArtTier) {
        const { persistSettledBasis } = await import(
          '../../../../../../periphery/adapters/config/persistSettledBasis'
        );
        persistSettledBasis(
          { gameArtTier: state.resolvedAction.basis.gameArtTier },
          { explicit: { gameArtTier: state.actionMetadata?.basis?.gameArtTier } },
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
