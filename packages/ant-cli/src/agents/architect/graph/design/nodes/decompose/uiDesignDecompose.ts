/**
 * UI Design Decompose
 * 
 * LLM-driven task decomposition for UI design work
 * (ui-tokens.json, ui-assets.json, ui-spec.json).
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../code/state";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../common/graph/llmConfig";
import { logErrorHeader } from "../../../code/nodes/shared/errorHandler";
import {
  parseLLMJsonResponse,
  saveCheckpoint,
  updateKanban,
  safeLogPrompt,
  resolveLLMClient,
  showChatPlaceholder,
  trackTokenUsage,
} from "./helpers";

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
    buildAllSourceDocs,
    buildSourceFileIndex,
    getSourceDocsSize,
    DECOMPOSE_SOURCE_THRESHOLD,
    READ_SOURCE_DOC_TOOL,
    decomposeWithToolLoop,
    handleReadSourceFile,
  } = await import('../docGen/sourceSelector');

  // Hybrid strategy: small → inline, large → tool-use (RAG)
  const sourceDocsSize = getSourceDocsSize(state.sourceDocuments);
  const useToolMode = sourceDocsSize > DECOMPOSE_SOURCE_THRESHOLD;

  let uiContext: string;
  if (useToolMode) {
    console.log(`📊 [UIDecompose] Tool-use mode: ${sourceDocsSize.toLocaleString()} chars > ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
    const fileIndex = buildSourceFileIndex(state.sourceDocuments!);
    const parts = [
      `SOURCE DOCUMENTS (index only — use read_source_doc tool for full content):\n\n${fileIndex}\n\nRead files relevant to UI design decisions.`,
      state.directive ? `DIRECTIVE:\n${state.directive}` : null,
    ].filter(Boolean);
    uiContext = parts.join('\n\n---\n\n');
  } else {
    console.log(`📊 [UIDecompose] Inline mode: ${sourceDocsSize.toLocaleString()} chars <= ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
    const allSourceDocs = buildAllSourceDocs(state.sourceDocuments) || state.prd;
    const parts = [
      allSourceDocs ? `PRD:\n${allSourceDocs}` : null,
      state.directive ? `DIRECTIVE:\n${state.directive}` : null,
    ].filter(Boolean);
    uiContext = parts.length > 0 ? parts.join('\n\n---\n\n') : '';
  }

  const sourceFileNames = state.sourceDocuments ? Object.keys(state.sourceDocuments) : [];
  const isFigmaMode = state.uiDesignSource === 'figma';
  if (isFigmaMode && !sourceFileNames.includes('figma.json')) {
    sourceFileNames.push('figma.json');
  }

  // Render prompt
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  const templateSuffix = isFigmaMode ? 'by-figma' : 'by-ref';
  const decomposeTemplatePath = `design/phases/decompose/base-ui-design-${templateSuffix}`;

  const uiDecomposePrompt = await promptAdapter.render(decomposeTemplatePath, {
    uiContext,
    referenceCount: state.uiReferences?.length || 0,
    assetCount: state.uiAssetsList
      ? Object.values(state.uiAssetsList).reduce((sum, arr) => sum + arr.length, 0)
      : 0,
    jobMode: state.detectionReport?.jobMode || 'generate',
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
  });

  await safeLogPrompt(
    state.context.featurePath,
    state.jobId || state._httpJobId || 'unknown',
    'decompose-uiDesign',
    uiDecomposePrompt.length,
    {
      templatePath: decomposeTemplatePath,
      usedTemplates: [`design/phases/decompose/rules-ui-design-${templateSuffix}`],
    }
  );

  try {
    await showChatPlaceholder();
    const llmToUse = await resolveLLMClient(state);
    if (!llmToUse) throw new Error('LLM client not available');
    
    let textResponse: string;

    if (useToolMode && state.sourceDocuments) {
      const { response, usage } = await decomposeWithToolLoop(
        llmToUse,
        [{ role: 'user', content: uiDecomposePrompt }],
        [READ_SOURCE_DOC_TOOL],
        (name, args) => {
          if (name === 'read_source_doc') {
            return handleReadSourceFile(args.filename, state.sourceDocuments!, args.startLine, args.endLine);
          }
          return `Error: Unknown tool "${name}"`;
        },
        {
          temperature: LLM_TEMPERATURE.DECOMPOSE,
          maxTokens: LLM_MAX_TOKENS.DEFAULT,
          enableThinking: true,
          thinkingBudget: 10000,
        },
      );
      textResponse = response;
      await trackTokenUsage(state, usage);
    } else {
      const result = await llmToUse.invokeWithUsage?.(
        [{ role: 'user', content: uiDecomposePrompt }],
        { temperature: LLM_TEMPERATURE.DECOMPOSE, maxTokens: LLM_MAX_TOKENS.DEFAULT }
      );
      textResponse = result?.content || await llmToUse.invoke([{ role: 'user', content: uiDecomposePrompt }]);
      await trackTokenUsage(state, result?.usage);
    }

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

      taskQueue.push({
        id: task.id,
        name: task.name,
        type: 'doc',
        priority: task.priority,
        description: task.description,
        sourceFiles: sf.length > 0 ? sf : undefined,
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

    // Save checkpoint
    await saveCheckpoint(state, {
      taskQueue: taskQueue.getAll(),
      completedTasks: [],
      completedTasksDetails: [],
      jobId: ctx.newJobId,
      jobTiming: finalJobTiming,
      tokenUsage: (state as any).tokenUsage,
      overrideDirective: state.overrideDirective,
      chatSource: state.chatSource,
    });

    // Update Kanban
    updateKanban(state, null, taskQueue.getAll());

    return {
      ...state,
      taskQueue,
      completedTasks: [],
      completedTasksDetails: [],
      _httpJobId: state._httpJobId,
      jobId: ctx.newJobId,
      jobTiming: finalJobTiming,
    };
  } catch (error: any) {
    logErrorHeader('decompose');
    console.error(error);
    throw error;
  }
}
