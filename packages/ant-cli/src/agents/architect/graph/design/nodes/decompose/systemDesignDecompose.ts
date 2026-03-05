/**
 * System Design Decompose
 * 
 * LLM-driven task decomposition for system design work
 * (unified, contract-first, MSA-contract-first).
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../code/state";
import { JobTimingManager } from "../../../../../common/graph/timing/JobTimingManager";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../../../common/graph/llmConfig";
import {
  parseLLMJsonResponse,
  saveCheckpoint,
  updateKanban,
  safeLogPrompt,
  resolveLLMClient,
  showChatPlaceholder,
  trackTokenUsage,
} from "./helpers";
import { resolveDesignTargetFiles } from "../../../../../../core/types/detection";
import type { JobEnvironment, JobMode } from "../../../../../../core/types/detection";

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
  profiles?: Record<string, { language: string; framework?: string }>;
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
  jobMode: JobMode = 'generate'
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

/**
 * Resolve a technology profile for a task based on its targetFile.
 * Two-stage lookup: exact tag match → tier default (be-main / fe-main).
 */
function resolveTaskProfile(
  targetFile: string | undefined,
  profiles?: Record<string, { language: string; framework?: string }>,
): { language: string; framework?: string } | undefined {
  if (!targetFile || !profiles || Object.keys(profiles).length === 0) return undefined;

  const tag = targetFileToTag(targetFile);
  if (!tag) return undefined;
  const tier = tag.split('-')[0]; // "be" or "fe"

  if (profiles[tag]) return profiles[tag];
  const defaultKey = `${tier}-main`;
  if (profiles[defaultKey]) return profiles[defaultKey];

  return undefined;
}

// ============================================
// Task Queue Population
// ============================================

function buildTaskQueue(response: SystemDesignResponse, sourceFileNames: string[] = []): TaskQueue<DesignTask> {
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
    
    const resolvedProfile = resolveTaskProfile(taskData.targetFile, response.profiles);

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
      isLastTaskForDocument: lastTaskIdPerFile.has(taskData.id),
      ...(resolvedProfile && { profile: resolvedProfile }),
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

  if (response.profiles && Object.keys(response.profiles).length > 0) {
    const profileSummary = taskQueue.getAll()
      .filter(t => t.profile)
      .map(t => `${t.id}→${t.profile!.language}${t.profile!.framework ? `/${t.profile!.framework}` : ''}`)
      .join(', ');
    console.log(`🔧 [Decompose] Profiles resolved: ${profileSummary || 'none'}`);
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
    READ_SOURCE_FILE_TOOL,
    decomposeWithToolLoop,
  } = await import('../docGen/sourceSelector');

  // Hybrid strategy: small projects → inline, large projects → tool-use (RAG)
  const sourceDocsSize = getSourceDocsSize(state.sourceDocuments);
  const useToolMode = sourceDocsSize > DECOMPOSE_SOURCE_THRESHOLD;

  let spec: string;
  if (useToolMode) {
    console.log(`📊 [SystemDecompose] Tool-use mode: ${sourceDocsSize.toLocaleString()} chars > ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
    const fileIndex = buildSourceFileIndex(state.sourceDocuments!);
    const specParts = [
      `SOURCE DOCUMENTS (index only — use read_source_file tool for full content):\n\n${fileIndex}\n\n⚠️ Read selectively: only files relevant to architecture decisions and task decomposition. Do NOT read all files.`,
      state.design ? `PREVIOUS DESIGN:\n${state.design.split('\n').slice(0, 50).join('\n')}\n...` : null,
      state.directive ? `DIRECTIVE:\n${state.directive}` : null,
    ].filter(Boolean);
    spec = specParts.join('\n\n---\n\n');
  } else {
    console.log(`📊 [SystemDecompose] Inline mode: ${sourceDocsSize.toLocaleString()} chars <= ${DECOMPOSE_SOURCE_THRESHOLD.toLocaleString()} threshold`);
    const allSourceDocs = buildAllSourceDocs(state.sourceDocuments) || state.prd;
    const specParts = [
      allSourceDocs ? `PRD:\n${allSourceDocs}` : null,
      state.design ? `PREVIOUS DESIGN:\n${state.design}` : null,
      state.directive ? `DIRECTIVE:\n${state.directive}` : null
    ].filter(Boolean);
    spec = specParts.join('\n\n---\n\n');
  }

  const hasExistingDesign = Boolean(state.design && state.design.trim().length > 0);
  const designPreview = state.design ? state.design.split('\n').slice(0, 50).join('\n') + '\n...' : '';

  // Extract existing system design file names (pattern-filtered, not all .md)
  const existingDesignFiles = state.existingDesignDocs
    ? Object.keys(state.existingDesignDocs).filter(isSystemDesignFile)
    : [];
  const jobMode = state.detectionReport?.jobMode || 'generate';
  const resolvedTargetFiles = state.detectionReport?.targetFiles;
  const detectedEnv = state.detectionReport?.environment;

  // For prompt: use resolvedTargetFiles as the authority for file constraints
  const promptExistingFiles = jobMode === 'refactor'
    ? (resolvedTargetFiles || (existingDesignFiles.length > 0 ? existingDesignFiles : undefined))
    : (existingDesignFiles.length > 0 ? existingDesignFiles : undefined);
  const promptPrimaryFile = resolvedTargetFiles?.[0]
    || (existingDesignFiles.length > 0 ? existingDesignFiles[0] : 'be-system-main.md');

  const sourceFileNames = state.sourceDocuments ? Object.keys(state.sourceDocuments) : [];

  // Render prompt
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  const prompt = await promptAdapter.render('design/phases/decompose/base-system-design', {
    spec,
    hasExistingDesign,
    designPreview,
    jobMode,
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
      templatePath: 'design/phases/decompose/base-system-design',
      usedTemplates: ['design/phases/decompose/rules-system-design'],
      injectedVariables: {
        spec: spec ? `[${spec.length} chars]` : undefined,
        hasExistingDesign,
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

  const MAX_ATTEMPTS = 2;

  /**
   * Single attempt: LLM call → parse → normalize → validate
   * Small projects: single-turn invokeWithUsage (fast)
   * Large projects: multi-turn stream with read_source_file tool (RAG)
   */
  async function attemptDecompose(): Promise<SystemDesignResponse> {
    let textResponse: string;

    if (useToolMode && state.sourceDocuments) {
      const { response, usage } = await decomposeWithToolLoop(
        llmToUse,
        [{ role: 'user', content: prompt }],
        [READ_SOURCE_FILE_TOOL],
        (name, args) => {
          if (name === 'read_source_file') {
            const content = state.sourceDocuments![args.filename];
            if (!content) {
              const available = Object.keys(state.sourceDocuments!).join(', ');
              return `Error: File "${args.filename}" not found. Available: ${available}`;
            }
            return content;
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
        [{ role: 'user', content: prompt }],
        { temperature: LLM_TEMPERATURE.DECOMPOSE, maxTokens: LLM_MAX_TOKENS.DEFAULT }
      );
      textResponse = result?.content || await llmToUse.invoke([{ role: 'user', content: prompt }]);
      await trackTokenUsage(state, result?.usage);
    }

    // Parse
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

    // Normalize: validate against resolved targets (single path for all environments)
    const effectiveResolvedFiles = resolvedTargetFiles
      || resolveDesignTargetFiles(detectedEnv as JobEnvironment, jobMode as JobMode, existingDesignFiles).targetFiles;
    response = validateAndFixTargetFiles(response, effectiveResolvedFiles, detectedEnv, jobMode as JobMode);

    // Validate: every targetFile must have at least one task.
    // In refactor mode, targetFiles were already narrowed to LLM's selection in
    // validateAndFixTargetFiles, so this validates the narrowed set.
    const { valid, uncovered } = validateTaskCoverage(response);
    if (!valid) {
      throw new Error(`Task coverage incomplete: no tasks for [${uncovered.join(', ')}]`);
    }

    return response;
  }

  // ━━━ Attempt loop: try up to MAX_ATTEMPTS, then fall back to minimum tasks ━━━
  let response: SystemDesignResponse | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      response = await attemptDecompose();
      break; // success
    } catch (error) {
      lastError = error as Error;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`⚠️  [SystemDecompose] Attempt ${attempt} failed: ${lastError.message}. Retrying...`);
      }
    }
  }

  // All attempts failed → generate minimum tasks from resolvedTargetFiles or environment
  if (!response) {
    const fallbackFiles = resolvedTargetFiles
      || resolveDesignTargetFiles(detectedEnv as JobEnvironment, jobMode as JobMode, existingDesignFiles).targetFiles;
    if (!fallbackFiles) {
      throw new Error(
        `System design decompose failed after ${MAX_ATTEMPTS} attempts and environment is unknown.\n` +
        `Last error: ${lastError?.message}`
      );
    }

    console.warn(
      `⚠️  [SystemDecompose] All ${MAX_ATTEMPTS} attempts failed. ` +
      `Generating minimum tasks for env="${detectedEnv}" → [${fallbackFiles.join(', ')}]`
    );
    response = {
      documentType: (detectedEnv === 'fullstack' || detectedEnv === 'backend') ? 'contract-first' : 'unified',
      targetFiles: fallbackFiles,
      tasks: generateMinimumTasks(fallbackFiles),
    };
  }

  console.log(`✅ System decompose: ${response.documentType}, ${response.tasks.length} tasks → [${response.targetFiles.join(', ')}]`);

  // Build task queue
  const taskQueue = buildTaskQueue(response, sourceFileNames);

  // Log decompose result
  await safeLogPrompt(
    state.context.featurePath,
    ctx.newJobId,
    'decompose-systemDesign-result',
    JSON.stringify(response).length,
    {
      templatePath: 'design/phases/decompose/base-system-design',
      injectedVariables: {
        documentType: response.documentType,
        services: response.services || [],
        profiles: response.profiles || {},
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
  const estimatingTokenUsage = (state as any).tokenUsage
    ? { ...(state as any).tokenUsage }
    : undefined;
  if (estimatingTokenUsage && state.deps?.kanbanUpdate?.setEstimatingTokenUsage) {
    state.deps.kanbanUpdate.setEstimatingTokenUsage(estimatingTokenUsage);
  }

  // Reset task-level token usage (will be used by first task in plan node)
  const { resetTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
  resetTaskTokenUsage(state as any);

  // Finalize estimating phase
  const phaseBreakdown = { ...(state._phaseTimings || {}), decompose: Date.now() - ctx.phaseStart };
  const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(ctx.newJobTiming, ctx.estimatingStartTime, phaseBreakdown);
  if (state.deps?.kanbanUpdate?.setJobTiming) {
    state.deps.kanbanUpdate.setJobTiming(finalJobTiming);
  }

  // Save checkpoint (no currentTask yet — plan node will pop first task)
  await saveCheckpoint(state, {
    taskQueue: taskQueue.getAll(),
    completedTasks: [],
    completedTasksDetails: [],
    jobId: ctx.newJobId,
    jobTiming: finalJobTiming,
    tokenUsage: (state as any).tokenUsage,
    estimatingTokenUsage,
  });

  // Update Kanban (tasks in queue, no in-progress yet)
  updateKanban(state, null, taskQueue.getAll());

  return {
    ...state,
    taskQueue,
    currentTask: undefined,
    completedTasks: [],
    _httpJobId: state._httpJobId,
    jobId: ctx.newJobId,
    jobTiming: finalJobTiming,
    _estimatingTokenUsage: estimatingTokenUsage,
  } as any;
}
