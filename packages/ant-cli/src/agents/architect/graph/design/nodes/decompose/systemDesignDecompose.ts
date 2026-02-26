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
  tasks: Array<{
    id: string;
    name: string;
    targetFile: string;
    targetService?: string;
    description: string;
    priority: number;
    exclusive?: boolean;
    parallelGroup?: string;
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
  _detectedEnv: string | undefined
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

  // Step 2: Validate/remap tasks against effective targets
  const validFiles = new Set(effectiveTargetFiles);
  response.tasks = response.tasks.map(t => {
    if (validFiles.has(t.targetFile)) return t;
    if (t.targetService) {
      const beFile = `be-system-${t.targetService}.md`;
      if (validFiles.has(beFile)) return { ...t, targetFile: beFile };
      const feFile = `fe-system-${t.targetService}.md`;
      if (validFiles.has(feFile)) return { ...t, targetFile: feFile };
    }
    return { ...t, targetFile: effectiveTargetFiles[0] };
  });

  // Step 3: documentType inference
  const hasMSA = (response.services?.length ?? 0) > 0 || (response.fePackages?.length ?? 0) > 0;
  const hasApiContract = effectiveTargetFiles.some(f => f.startsWith('api-contract-'));
  if (hasMSA) {
    response.documentType = 'msa-contract-first';
  } else if (effectiveTargetFiles.length === 1 && !hasApiContract) {
    response.documentType = 'unified';
  } else if (hasApiContract) {
    response.documentType = 'contract-first';
  }

  // Step 4: Coverage check (unified for all cases)
  const coveredFiles = new Set(response.tasks.map(t => t.targetFile));
  const uncovered = effectiveTargetFiles.filter(f => !coveredFiles.has(f));
  if (uncovered.length > 0) {
    response.tasks.push(...generateMinimumTasks(uncovered));
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
 * Each targetFile gets exactly one task. api-contract is exclusive, others get parallelGroup.
 */
function generateMinimumTasks(targetFiles: string[]): SystemDesignResponse['tasks'] {
  return targetFiles.map((file, idx) => {
    const baseName = file.replace('.md', '');
    const isApiContract = file.startsWith('api-contract-');
    return {
      id: `design-${baseName}`,
      name: `Design Document: ${baseName}`,
      targetFile: file,
      priority: 200 + idx * 20,
      description: `Generate ${file} design document based on requirements.`,
      ...(isApiContract ? { exclusive: true } : { parallelGroup: baseName }),
    };
  });
}

// ============================================
// Task Queue Population
// ============================================

function buildTaskQueue(response: SystemDesignResponse): TaskQueue<DesignTask> {
  const taskQueue = new TaskQueue<DesignTask>();
  
  for (const taskData of response.tasks) {
    // Validate targetFile
    if (!response.targetFiles.includes(taskData.targetFile)) {
      taskData.targetFile = response.targetFiles[0];
    }
    
    const isApiContract = taskData.targetFile.startsWith('api-contract-');
    const exclusive = typeof taskData.exclusive === 'boolean' ? taskData.exclusive : (isApiContract || undefined);
    const parallelGroup = !exclusive && typeof taskData.parallelGroup === 'string'
      ? taskData.parallelGroup
      : undefined;
    
    taskQueue.push({
      id: taskData.id,
      name: taskData.name,
      type: 'doc',
      priority: taskData.priority || 250,
      description: taskData.description,
      targetFile: taskData.targetFile,
      targetService: taskData.targetService,
      exclusive: exclusive || undefined,
      parallelGroup,
      completed: false
    } as DesignTask);
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
  // Build spec
  const specParts = [
    state.prd ? `PRD:\n${state.prd}` : null,
    state.design ? `PREVIOUS DESIGN:\n${state.design}` : null,
    state.directive ? `DIRECTIVE:\n${state.directive}` : null
  ].filter(Boolean);
  const spec = specParts.join('\n\n---\n\n');
  const hasExistingDesign = Boolean(state.design && state.design.trim().length > 0);
  const designPreview = state.design ? state.design.split('\n').slice(0, 50).join('\n') + '\n...' : '';

  // Extract existing system design file names (pattern-filtered, not all .md)
  const existingDesignFiles = state.existingDesignDocs
    ? Object.keys(state.existingDesignDocs).filter(isSystemDesignFile)
    : [];
  const jobMode = state.detectionReport?.jobMode || 'generate';
  const resolvedTargetFiles = state.detectionReport?.targetFiles;

  // For prompt: use resolvedTargetFiles as the authority for file constraints
  const promptExistingFiles = jobMode === 'refactor'
    ? (resolvedTargetFiles || (existingDesignFiles.length > 0 ? existingDesignFiles : undefined))
    : (existingDesignFiles.length > 0 ? existingDesignFiles : undefined);
  const promptPrimaryFile = resolvedTargetFiles?.[0]
    || (existingDesignFiles.length > 0 ? existingDesignFiles[0] : 'be-system-main.md');

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
      },
    }
  );

  await showChatPlaceholder();
  const maybeLlm = await resolveLLMClient(state);
  if (!maybeLlm) throw new Error('LLM client not available');
  const llmToUse = maybeLlm;

  const detectedEnv = state.detectionReport?.environment;
  const MAX_ATTEMPTS = 2;

  /**
   * Single attempt: LLM call → parse → normalize → validate
   * Throws on any failure (parse error, validation error).
   */
  async function attemptDecompose(): Promise<SystemDesignResponse> {
    const result = await llmToUse.invokeWithUsage?.(
      [{ role: 'user', content: prompt }],
      { temperature: LLM_TEMPERATURE.DECOMPOSE, maxTokens: LLM_MAX_TOKENS.DEFAULT }
    );
    const textResponse = result?.content || await llmToUse.invoke([{ role: 'user', content: prompt }]);

    await trackTokenUsage(state, result?.usage);

    // Parse
    const parsedResponse = parseLLMJsonResponse(textResponse);
    let response: SystemDesignResponse;

    if (parsedResponse.documentType && parsedResponse.targetFiles && parsedResponse.tasks) {
      response = parsedResponse;
    } else if (parsedResponse.tasks) {
      response = {
        documentType: 'unified',
        targetFiles: ['be-system-main.md'],
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
    response = validateAndFixTargetFiles(response, effectiveResolvedFiles, detectedEnv);

    // Validate: every targetFile must have at least one task
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
  const taskQueue = buildTaskQueue(response);

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
