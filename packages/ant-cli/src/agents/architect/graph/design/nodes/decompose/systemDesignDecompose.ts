/**
 * System Design Decompose
 * 
 * LLM-driven task decomposition for system design work
 * (unified, contract-first, MSA-contract-first).
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../../types/task";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../common/graph/llmConfig";
import { ARTIFACT_PREFIX } from '@ant/shared';
import { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { updateKanban } from "./kanbanUpdate";
import { resolveLLMClient, showChatPlaceholder } from "./llmClient";
import { applyEstimatingUsage } from "../../../../../common/graph/llmHelpers";
import { parseLLMJsonResponse } from "../../utils/jsonResponseParser";
import { safeLogPrompt } from "../../utils/promptLog";
import { saveDecomposeCheckpoint } from "../../session/checkpoint";
import { resolveDesignTargetFiles } from "../../../../../../core/types/detection";
import { BOUNDARY, type Mode, buildTechTier, type Stack, type TechTierConfig, resolveTaskTechTiers, type PackageTierEntry } from "@ant/shared";
import { parseExecutionTierTag, coerceExecutionTier, recordUserTurnMeta, ExecutionTierId } from "../../../../../../core/executionTier";

interface DecomposeContext {
  phaseStart: number;
  newJobId: string;
  newJobTiming: any;
  estimatingStartTime: string;
}

// ============================================
// Response Type
// ============================================

interface SystemDesignResponse {
  documentType: 'unified' | 'contract-first' | 'msa-contract-first';
  services?: string[];
  fePackages?: string[];
  targetFiles: string[];
  techTier?: { stack: string; language: string; framework?: string };
  packageTiers?: Record<string, PackageTierEntry>;
  tasks: Array<{
    id: string;
    name: string;
    targetFile: string;
    targetService?: string;
    description: string;
    priority: number;
    exclusive?: boolean;
    parallelGroup?: string;
    assignedSections?: string[];
  }>;
  references?: Array<{
    project: string;
    branch?: string;
    reason?: string;
  }>;
}

// ============================================
// System Design File Pattern Recognition
// ============================================

/**
 * Known system design document patterns (unified naming):
 * - api-contract-{name}.md
 * - fe-system-{name}.md
 * - be-system-{name}.md
 */
const SYSTEM_DESIGN_FILE_PATTERNS = [
  /^api-contract-.+\.md$/,
  /^fe-system-.+\.md$/,
  /^be-system-.+\.md$/,
];

function isSystemDesignFile(fileName: string): boolean {
  return SYSTEM_DESIGN_FILE_PATTERNS.some(p => p.test(fileName));
}

// ============================================
// Resolved TargetFiles Validation (Single Source of Truth)
// ============================================

/**
 * Validate and fix LLM response against resolvedTargetFiles.
 * Single normalization path for ALL environments and architectures.
 *
 * Flow: MSA expansion → task remap → documentType inference → coverage check.
 *
 * MSA expansion (both FE and BE):
 *   be-system-main.md → be-system-{service}.md  (when response.services exists)
 *   fe-system-main.md → fe-system-{package}.md  (when response.fePackages exists)
 *   api-contract-main.md → api-contract-{service}.md  (when response.services exists)
 */
function validateAndFixTargetFiles(
  response: SystemDesignResponse,
  resolvedTargetFiles: string[],
  _detectedEnv: string | undefined,
  jobMode: Mode = 'generate'
): SystemDesignResponse {
  // Step 1: MSA expansion FIRST (before any task validation)
  // Replaces -main.md with per-service/package files when MSA is detected
  let effectiveTargetFiles = [...resolvedTargetFiles];

  if (response.services?.length) {
    effectiveTargetFiles = effectiveTargetFiles.flatMap(f =>
      f === 'be-system-main.md'
        ? response.services!.map(s => `be-system-${s}.md`)
        : f === 'api-contract-main.md'
          ? response.services!.map(s => `api-contract-${s}.md`)
          : [f]
    );
  }

  if (response.fePackages?.length) {
    effectiveTargetFiles = effectiveTargetFiles.flatMap(f =>
      f === 'fe-system-main.md'
        ? response.fePackages!.map(p => `fe-system-${p}.md`)
        : [f]
    );
  }

  response.targetFiles = effectiveTargetFiles;

  // Step 2: Filter tasks outside resolved targets (drop instead of remap)
  const validFiles = new Set(effectiveTargetFiles);
  const originalTaskCount = response.tasks.length;
  response.tasks = response.tasks.filter(t => {
    if (validFiles.has(t.targetFile)) return true;
    if (t.targetService) {
      const beFile = `be-system-${t.targetService}.md`;
      if (validFiles.has(beFile)) { t.targetFile = beFile; return true; }
      const feFile = `fe-system-${t.targetService}.md`;
      if (validFiles.has(feFile)) { t.targetFile = feFile; return true; }
    }
    return false;
  });
  if (response.tasks.length < originalTaskCount) {
    console.warn(
      `⚠️  [validateAndFixTargetFiles] Filtered ${originalTaskCount - response.tasks.length} task(s) ` +
      `targeting files outside resolved targets [${effectiveTargetFiles.join(', ')}]`
    );
  }

  // Step 3 (refactor only): Narrow targetFiles to only what the LLM chose to modify.
  // In refactor mode the LLM intentionally targets a subset of files — respect that
  // instead of forcing coverage on all resolved files.
  if (jobMode === 'refactor' && response.tasks.length > 0) {
    const llmTargetedFiles = [...new Set(response.tasks.map(t => t.targetFile))];
    if (llmTargetedFiles.length < effectiveTargetFiles.length) {
      console.log(
        `ℹ️  [validateAndFixTargetFiles] Refactor mode: narrowing targetFiles from ` +
        `[${effectiveTargetFiles.join(', ')}] → [${llmTargetedFiles.join(', ')}]`
      );
      effectiveTargetFiles = llmTargetedFiles;
      response.targetFiles = effectiveTargetFiles;
    }
  }

  // Step 4: documentType inference
  const hasMSA = (response.services?.length ?? 0) > 0 || (response.fePackages?.length ?? 0) > 0;
  const hasApiContract = effectiveTargetFiles.some(f => f.startsWith('api-contract-'));
  if (hasMSA) {
    response.documentType = 'msa-contract-first';
  } else if (effectiveTargetFiles.length === 1 && !hasApiContract) {
    response.documentType = 'unified';
  } else if (hasApiContract) {
    response.documentType = 'contract-first';
  }

  // Step 5: Coverage check — generate mode only.
  // In refactor mode, Step 3 already narrowed targetFiles to the LLM's selection,
  // so forcing tasks for uncovered files would re-introduce the files we just trimmed.
  if (jobMode !== 'refactor') {
    const coveredFiles = new Set(response.tasks.map(t => t.targetFile));
    const uncovered = effectiveTargetFiles.filter(f => !coveredFiles.has(f));
    if (uncovered.length > 0) {
      response.tasks.push(...generateMinimumTasks(uncovered));
    }
  }

  return response;
}

// ============================================
// Validation & Recovery
// ============================================

/**
 * Universal validation: every targetFile must have at least one task with that targetFile.
 */
function validateTaskCoverage(response: SystemDesignResponse): { valid: boolean; uncovered: string[] } {
  const coveredFiles = new Set(response.tasks.map(t => t.targetFile));
  const uncovered = response.targetFiles.filter(f => !coveredFiles.has(f));
  return { valid: uncovered.length === 0, uncovered };
}

/**
 * Generate minimum viable tasks from targetFiles.
 * Each targetFile gets exactly one task with parallelGroup set to baseName.
 */
function generateMinimumTasks(targetFiles: string[]): SystemDesignResponse['tasks'] {
  return targetFiles.map((file, idx) => {
    const baseName = file.replace('.md', '');
    return {
      id: `design-${baseName}`,
      name: `Design Document: ${baseName}`,
      targetFile: file,
      priority: 200 + idx * 20,
      description: `Generate ${file} design document based on requirements.`,
      parallelGroup: baseName,
    };
  });
}

// ============================================
// Profile Resolution
// ============================================

/**
 * Convert a design targetFile to a normalized tag using Code Job `packages` convention.
 * e.g. "be-system-auth.md" → "be-auth", "api-contract-main.md" → "be-main"
 */
function targetFileToTag(targetFile: string): string | undefined {
  const match = targetFile.match(/^(be-system|fe-system|api-contract)-(.+)\.md$/);
  if (!match) return undefined;
  const [, prefix, name] = match;
  const tier = prefix === 'fe-system' ? 'fe' : 'be';
  return `${tier}-${name}`;
}

// ============================================
// Task Queue Population
// ============================================

function buildTaskQueue(response: SystemDesignResponse, sourceFileNames: string[] = [], graphTechTier: import('@ant/shared').TechTier): TaskQueue<DesignTask> {
  const taskQueue = new TaskQueue<DesignTask>();
  
  // Pre-compute isLastTaskForDocument per targetFile group
  const tasksByFile = new Map<string, typeof response.tasks>();
  for (const taskData of response.tasks) {
    const file = taskData.targetFile;
    if (!tasksByFile.has(file)) tasksByFile.set(file, []);
    tasksByFile.get(file)!.push(taskData);
  }
  const lastTaskIdPerFile = new Set<string>();
  for (const tasks of tasksByFile.values()) {
    const sorted = [...tasks].sort((a, b) => (a.priority || 250) - (b.priority || 250));
    if (sorted.length > 0) lastTaskIdPerFile.add(sorted[sorted.length - 1].id);
  }
  
  for (const taskData of response.tasks) {
    if (!response.targetFiles.includes(taskData.targetFile)) {
      taskData.targetFile = response.targetFiles[0];
    }
    
    const exclusive = typeof taskData.exclusive === 'boolean' ? taskData.exclusive : undefined;
    const parallelGroup = !exclusive && typeof taskData.parallelGroup === 'string'
      ? taskData.parallelGroup
      : undefined;
    
    const tag = targetFileToTag(taskData.targetFile);
    const packages = tag ? [tag] : undefined;
    const taskTechTiers = resolveTaskTechTiers(packages, graphTechTier, response.packageTiers);

    taskQueue.push({
      id: taskData.id,
      name: taskData.name,
      type: 'doc',
      priority: taskData.priority || 250,
      description: taskData.description,
      targetFile: taskData.targetFile,
      targetService: taskData.targetService,
      assignedSections: taskData.assignedSections,
      sourceFiles: Array.isArray((taskData as any).sourceFiles) ? (taskData as any).sourceFiles : undefined,
      include: [ARTIFACT_PREFIX.SOURCES],
      artifactPolicy: {
        refs: [ARTIFACT_PREFIX.SOURCES],
      },
      isLastTaskForDocument: lastTaskIdPerFile.has(taskData.id),
      packages,
      techTiers: taskTechTiers,
      exclusive: exclusive || undefined,
      parallelGroup,
      completed: false
    } as DesignTask);
  }

  if (sourceFileNames.length > 0) {
    for (const task of taskQueue.getAll()) {
      if (!task.sourceFiles || task.sourceFiles.length === 0) {
        console.warn(`⚠️ [Decompose] task "${task.id}" missing sourceFiles`);
      }
    }
  }

  if (response.packageTiers && Object.keys(response.packageTiers).length > 0) {
    const tierSummary = taskQueue.getAll()
      .filter(t => t.techTiers?.length)
      .map(t => `${t.id}→${t.techTiers!.map(tier => `${tier.language}${tier.framework ? `/${tier.framework}` : ''}`).join('+')}`)
      .join(', ');
    console.log(`🔧 [Decompose] TechTiers resolved: ${tierSummary || 'none'}`);
  }
  
  return taskQueue;
}

// ============================================
// Main Export
// ============================================

/**
 * Handle system design decomposition via LLM.
 */
export async function decomposeSystemDesign(
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

  const pool = new ArtifactPoolView(state.artifacts || []);
  const sourceRecord = pool.sourcesAsRecord();

  // Hybrid strategy: small projects → inline, large projects → tool-use (RAG)
  const sourceDocsSize = pool.sourcesSize();
  const useToolMode = sourceDocsSize > DECOMPOSE_SOURCE_THRESHOLD;

  const designContent = pool.firstDesignContent();
  let spec: string;
  if (useToolMode) {
    console.log(`📊 [SystemDecompose] Tool-use mode: ${sourceDocsSize.toLocaleString()} chars > ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
    const fileIndex = buildSourceFileIndex(sourceRecord);
    const specParts = [
      `SOURCE DOCUMENTS (index only — use read_source_doc tool for full content):\n\n${fileIndex}\n\nRead files relevant to architecture decisions, service boundaries, and task decomposition. Prioritize files about service decomposition, bounded contexts, and domain boundaries — these determine MSA detection.`,
      designContent ? `PREVIOUS DESIGN:\n${designContent.split('\n').slice(0, 50).join('\n')}\n...` : null,
      state.directive ? `DIRECTIVE:\n${state.directive}` : null,
    ].filter(Boolean);
    spec = specParts.join('\n\n---\n\n');
  } else {
    console.log(`📊 [SystemDecompose] Inline mode: ${sourceDocsSize.toLocaleString()} chars <= ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
    const allSourceDocs = buildAllSourceDocs(sourceRecord);
    const specParts = [
      allSourceDocs ? `SOURCE DOCUMENTS:\n${allSourceDocs}` : null,
      designContent ? `PREVIOUS DESIGN:\n${designContent}` : null,
      state.directive ? `DIRECTIVE:\n${state.directive}` : null
    ].filter(Boolean);
    spec = specParts.join('\n\n---\n\n');
  }

  // Extract existing system design file names (pattern-filtered, not all .md).
  // Used as a refactor-mode filename constraint only — the document CONTENT
  // is already injected via role-annotated pool sections (ArtifactPipeline),
  // so no separate "existing design preview" block is needed here.
  const existingDesignFiles = state.existingDesignDocs
    ? Object.keys(state.existingDesignDocs).filter(isSystemDesignFile)
    : [];
  const jobMode = state.resolvedAction?.mode || 'generate';
  const resolvedTargetFiles = state.resolvedAction?.target;
  const detectedEnv: Stack = state.resolvedAction?.intent?.includes('-fe') ? 'frontend' : state.resolvedAction?.intent?.includes('-be') ? 'backend' : 'fullstack';

  // For prompt: use resolvedTargetFiles as the authority for file constraints
  const promptExistingFiles = jobMode === 'refactor'
    ? (resolvedTargetFiles || (existingDesignFiles.length > 0 ? existingDesignFiles : undefined))
    : (existingDesignFiles.length > 0 ? existingDesignFiles : undefined);
  const promptPrimaryFile = resolvedTargetFiles?.[0]
    || (existingDesignFiles.length > 0 ? existingDesignFiles[0] : 'be-system-main.md');

  const sourceFileNames = pool.sourceFileNames();

  // Render prompt
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  const prompt = await promptAdapter.render('jobs/design/nodes/decompose/variants/system-design/base', {
    spec,
    detectedMode: jobMode,
    existingDesignFiles: promptExistingFiles,
    primaryDesignFile: promptPrimaryFile,
    environment: detectedEnv,
    resolvedTargetFiles,
    sourceFileNames: sourceFileNames.length > 0 ? sourceFileNames : undefined,
  });

  await safeLogPrompt(
    state.context.featurePath,
    state.jobId || state._httpJobId || 'unknown',
    'decompose-systemDesign',
    prompt.length,
    {
      templatePath: 'jobs/design/nodes/decompose/variants/system-design/base',
      usedTemplates: ['jobs/design/nodes/decompose/variants/system-design/rules'],
      injectedVariables: {
        spec: spec ? `[${spec.length} chars]` : undefined,
        hasSystemDesignRef: pool.hasSystemDesignRef(),
        environment: detectedEnv,
        resolvedTargetFiles,
        useToolMode,
        sourceDocsSize,
      },
    }
  );

  await showChatPlaceholder();
  const maybeLlm = await resolveLLMClient(state);
  if (!maybeLlm) throw new Error('LLM client not available');
  const llmToUse = maybeLlm;

  // Per-flow decompose call index (main + repair share this counter so
  // token debug log entries are ordered 0 → 1 → 2 ... within one job.)
  let callIdx = 0;

  /**
   * Call LLM to get raw text response.
   * Small projects: single-turn invokeWithUsage (fast)
   * Large projects: multi-turn stream with read_source_doc tool (RAG)
   */
  async function callLLM(): Promise<string> {
    if (useToolMode && pool.hasSources()) {
      const { response, usage } = await decomposeWithToolLoop(
        llmToUse,
        [{ role: 'user', content: prompt }],
        [READ_SOURCE_DOC_TOOL],
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
        },
      );
      applyEstimatingUsage(state, 'decompose', usage, { subNode: 'system', callIndex: callIdx++, promptChars: prompt.length });
      return response;
    } else {
      const result = await llmToUse.invokeWithUsage?.(
        [{ role: 'user', content: prompt }],
        { temperature: LLM_TEMPERATURE.DECOMPOSE, maxTokens: LLM_MAX_TOKENS.DEFAULT }
      );
      const textResponse = result?.content || await llmToUse.invoke([{ role: 'user', content: prompt }]);
      applyEstimatingUsage(state, 'decompose', result?.usage, { subNode: 'system', callIndex: callIdx++, promptChars: prompt.length });
      return textResponse;
    }
  }

  /**
   * Parse raw LLM response → normalize against resolved targets → validate coverage.
   */
  function parseAndValidate(textResponse: string): SystemDesignResponse {
    const parsedResponse = parseLLMJsonResponse(textResponse);
    let response: SystemDesignResponse;

    if (parsedResponse.documentType && parsedResponse.targetFiles && parsedResponse.tasks) {
      response = parsedResponse;
    } else if (parsedResponse.tasks) {
      response = {
        documentType: 'unified',
        targetFiles: ['be-system-main.md'],
        ...(parsedResponse.profiles && { profiles: parsedResponse.profiles }),
        tasks: parsedResponse.tasks.map((task: any) => ({
          ...task,
          targetFile: task.targetFile || 'be-system-main.md'
        }))
      };
    } else {
      throw new Error('Invalid task breakdown format from LLM');
    }

    const intentId = state.resolvedAction?.intent || 'gen-sys-full';
    const effectiveResolvedFiles = resolvedTargetFiles
      || resolveDesignTargetFiles(intentId, jobMode as Mode, existingDesignFiles).targetFiles;
    response = validateAndFixTargetFiles(response, effectiveResolvedFiles, detectedEnv, jobMode as Mode);

    const { valid, uncovered } = validateTaskCoverage(response);
    if (!valid) {
      throw new Error(`Task coverage incomplete: no tasks for [${uncovered.join(', ')}]`);
    }

    return response;
  }

  /**
   * Repair call: send raw response + error feedback back to LLM for JSON correction.
   */
  async function repairCall(rawResponse: string, errorMessage: string): Promise<string> {
    const truncated = rawResponse.length > 4000
      ? rawResponse.slice(0, 4000) + '\n...[truncated]'
      : rawResponse;

    const repairMessages = [
      { role: 'user' as const, content: prompt },
      { role: 'assistant' as const, content: truncated },
      { role: 'user' as const, content:
        `Your previous response could not be parsed as valid JSON.\n\n` +
        `Error: ${errorMessage}\n\n` +
        `Please output ONLY the corrected JSON wrapped in <decompose> tags. No markdown fences, no explanations.`
      },
    ];

    const result = await llmToUse.invokeWithUsage?.(
      repairMessages,
      { temperature: LLM_TEMPERATURE.DECOMPOSE, maxTokens: LLM_MAX_TOKENS.DEFAULT }
    );
    const textResponse = result?.content || await llmToUse.invoke(repairMessages);
    applyEstimatingUsage(state, 'decompose', result?.usage, { subNode: 'system-repair', callIndex: callIdx++, promptChars: prompt.length });
    return textResponse;
  }

  // ━━━ Main flow: LLM call → parse → repair if needed → fail if all fail ━━━
  let response: SystemDesignResponse | null = null;
  let lastError: Error | null = null;

  let rawResponse: string | undefined;
  try {
    rawResponse = await callLLM();
  } catch (error) {
    lastError = error as Error;
    console.error(`❌ [SystemDecompose] LLM call failed: ${lastError.message}`);
  }

  if (rawResponse) {
    try {
      response = parseAndValidate(rawResponse);
    } catch (parseError) {
      lastError = parseError as Error;
      console.warn(`⚠️  [SystemDecompose] Parse failed: ${lastError.message}. Sending repair call...`);

      try {
        const repairedRaw = await repairCall(rawResponse, lastError.message);
        response = parseAndValidate(repairedRaw);
      } catch (repairError) {
        lastError = repairError as Error;
        console.error(`❌ [SystemDecompose] Repair call also failed: ${lastError.message}`);
      }
    }
  }

  if (!response) {
    throw new Error(
      `[SystemDecompose] Task decomposition failed. Last error: ${lastError?.message}`
    );
  }

  console.log(`✅ System decompose: ${response.documentType}, ${response.tasks.length} tasks → [${response.targetFiles.join(', ')}]`);

  // ExecutionTier: LLM SSOT — `<executionTier>N</executionTier>` emitted
  // outside the `<decompose>` JSON. Missing tag degrades to Tier 0 Reflex
  // (safe default — see core/executionTier/parseExecutionTierTag.ts).
  const executionTier = coerceExecutionTier(
    parseExecutionTierTag(rawResponse),
    'SystemDecompose',
  );
  console.log(`🧭 [SystemDecompose] executionTier=${executionTier}`);

  // Build graph-level TechTier: prefer LLM-provided techTier, fallback to detected stack
  const graphTechTier = response.techTier
    ? buildTechTier({ language: response.techTier.language, framework: response.techTier.framework }, (response.techTier.stack as Stack) || detectedEnv)
    : buildTechTier(undefined, detectedEnv);
  console.log(`✅ TechTier: stack=${graphTechTier.stack || detectedEnv}, language=${graphTechTier.language}, framework=${graphTechTier.framework || 'none'}`);

  // Sync to RAC basis.techTier (TechTierConfig) so getTechTier(state) returns it
  const tierKey = graphTechTier.stack === 'fullstack' ? undefined : graphTechTier.stack;
  const basisTechTierConfig: TechTierConfig = {
    stack: graphTechTier.stack,
    ...(tierKey === 'frontend' || graphTechTier.stack === 'fullstack'
      ? { frontend: { ...graphTechTier, stack: 'frontend' as const } } : {}),
    ...(tierKey === 'backend' || graphTechTier.stack === 'fullstack'
      ? { backend: { ...graphTechTier, stack: 'backend' as const } } : {}),
    ...(!tierKey && graphTechTier.stack !== 'fullstack'
      ? { frontend: graphTechTier } : {}),
  };
  state.resolvedAction = {
    ...state.resolvedAction!,
    basis: { ...state.resolvedAction?.basis, techTier: basisTechTierConfig },
  };

  // Build task queue
  const taskQueue = buildTaskQueue(response, sourceFileNames, graphTechTier);

  // Log decompose result
  await safeLogPrompt(
    state.context.featurePath,
    ctx.newJobId,
    'decompose-systemDesign-result',
    JSON.stringify(response).length,
    {
      templatePath: 'jobs/design/nodes/decompose/variants/system-design/base',
      injectedVariables: {
        documentType: response.documentType,
        services: response.services || [],
        packageTiers: response.packageTiers || {},
        targetFiles: response.targetFiles,
        taskCount: response.tasks.length,
        tasks: response.tasks.map(t => ({ id: t.id, name: t.name, targetFile: t.targetFile, priority: t.priority }))
      },
    }
  );

  if (taskQueue.size() === 0) {
    throw new Error('No tasks in queue after decompose');
  }

  // Snapshot estimating phase token usage
  const estimatingTokenUsage = state.tokenUsage
    ? { ...state.tokenUsage }
    : undefined;
  if (estimatingTokenUsage && state.deps?.kanbanUpdate?.setEstimatingTokenUsage) {
    state.deps.kanbanUpdate.setEstimatingTokenUsage(estimatingTokenUsage);
  }

  // Reset task-level token usage (will be used by first task in plan node)
  const { resetTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
  resetTaskTokenUsage(state);

  // Finalize estimating phase
  const phaseBreakdown = { ...(state._phaseTimings || {}), decompose: Date.now() - ctx.phaseStart };
  const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(ctx.newJobTiming, ctx.estimatingStartTime, phaseBreakdown);
  if (state.deps?.kanbanUpdate?.setJobTiming) {
    state.deps.kanbanUpdate.setJobTiming(finalJobTiming);
  }

  state.jobId = ctx.newJobId;
  state.jobTiming = finalJobTiming;
  state._estimatingTokenUsage = estimatingTokenUsage;
  state.executionTier = executionTier;
  await saveDecomposeCheckpoint(state, {
    taskQueue: taskQueue.getAll(),
    completedTasks: [],
    completedTasksDetails: [],
  });

  // Update Kanban (tasks in queue, no in-progress yet)
  updateKanban(state, null, taskQueue.getAll());

  await recordUserTurnMeta({
    session: state.deps?.session,
    turnId: state.turnId,
    jobId: ctx.newJobId,
    jobType: 'design',
    executionTier,
    nodeLabel: 'SystemDecompose',
  });

  return {
    ...state,
    taskQueue,
    currentTask: undefined,
    completedTasks: [],
    _httpJobId: state._httpJobId,
    jobId: ctx.newJobId,
    jobTiming: finalJobTiming,
    _estimatingTokenUsage: estimatingTokenUsage,
    executionTier,
    boundary: BOUNDARY.HEAVYWEIGHT,
  } as any;
}
