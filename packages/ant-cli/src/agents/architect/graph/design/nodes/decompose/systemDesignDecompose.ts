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
 * Known system design document patterns:
 * - system-design.md              (unified)
 * - api-contract.md               (API contract)
 * - fe-system-design.md           (single frontend)
 * - fe-system-design-{pkg}.md     (multi-package frontend)
 * - be-system-design.md           (single backend)
 * - be-system-design-{svc}.md     (multi-service/MSA backend)
 */
const SYSTEM_DESIGN_FILE_PATTERNS = [
  /^system-design\.md$/,
  /^api-contract\.md$/,
  /^fe-system-design(?:-.+)?\.md$/,
  /^be-system-design(?:-.+)?\.md$/,
];

function isSystemDesignFile(fileName: string): boolean {
  return SYSTEM_DESIGN_FILE_PATTERNS.some(p => p.test(fileName));
}

/**
 * Infer document structure from existing file set.
 * Returns documentType and optional service/package names.
 */
function inferDocumentStructure(files: string[]): {
  documentType: 'unified' | 'contract-first' | 'msa-contract-first';
  services: string[];
  fePackages: string[];
} {
  const hasApiContract = files.includes('api-contract.md');

  const feMulti = /^fe-system-design-(.+)\.md$/;
  const beMulti = /^be-system-design-(.+)\.md$/;
  const fePackages = files.map(f => f.match(feMulti)?.[1]).filter(Boolean) as string[];
  const services = files.map(f => f.match(beMulti)?.[1]).filter(Boolean) as string[];

  const hasFe = files.some(f => f.startsWith('fe-system-design'));
  const hasBe = files.some(f => f.startsWith('be-system-design'));

  if (hasApiContract && services.length > 0) {
    return { documentType: 'msa-contract-first', services, fePackages };
  }
  if (hasApiContract || (hasFe && hasBe)) {
    return { documentType: 'contract-first', services: [], fePackages };
  }
  return { documentType: 'unified', services: [], fePackages };
}

// ============================================
// Environment-based Response Normalization
// ============================================

/**
 * Filter existing design files to only those relevant to the detected environment.
 * Prevents cross-tier contamination (e.g., FE directive targeting api-contract.md).
 */
function filterExistingFilesByEnvironment(
  files: string[],
  env: string | undefined
): string[] {
  if (!env || env === 'fullstack') return files;
  if (env === 'frontend') {
    return files.filter(f => f.startsWith('fe-system-design') || f === 'system-design.md');
  }
  if (env === 'backend') {
    return files.filter(f =>
      f.startsWith('be-system-design') || f === 'api-contract.md' || f === 'system-design.md'
    );
  }
  return files;
}

function normalizeResponseForEnvironment(
  response: SystemDesignResponse,
  detectedEnv: string | undefined,
  jobMode?: string,
  existingDesignFiles?: string[]
): SystemDesignResponse {
  // Refactor mode: preserve existing document structure, but only for files relevant to the detected environment
  if (jobMode === 'refactor' && existingDesignFiles && existingDesignFiles.length > 0) {
    const relevantFiles = filterExistingFilesByEnvironment(existingDesignFiles, detectedEnv);

    if (relevantFiles.length === 0) {
      // No existing files match the detected environment → fall through to generate-mode normalization
      console.log(`ℹ️  [SystemDecompose] Refactor mode but no files match env="${detectedEnv}". Falling through to generate.`);
    } else {
      const structure = inferDocumentStructure(relevantFiles);
      response.documentType = structure.documentType;
      if (structure.services.length > 0) {
        response.services = structure.services;
      }
      response.tasks = response.tasks.map(t => {
        if (!relevantFiles.includes(t.targetFile)) {
          return { ...t, targetFile: relevantFiles[0] };
        }
        return t;
      });
      response.targetFiles = [...new Set(response.tasks.map(t => t.targetFile))];
      return response;
    }
  }

  if (detectedEnv === 'frontend') {
    response.documentType = 'unified';
    response.targetFiles = ['fe-system-design.md'];
    response.tasks = response.tasks.map(t => ({ ...t, targetFile: 'fe-system-design.md' }));
    return response;
  }

  if (detectedEnv === 'backend') {
    return normalizeBackendContractFirst(response);
  }
  
  if (detectedEnv !== 'fullstack') return response;
  
  // Fullstack: MSA or contract-first
  if (response.documentType === 'msa-contract-first' && response.services?.length) {
    return normalizeMSA(response);
  }
  
  return normalizeContractFirst(response);
}

function normalizeMSA(response: SystemDesignResponse): SystemDesignResponse {
  const services = response.services!;
  const expectedTargetFiles = [
    'api-contract.md',
    'fe-system-design.md',
    ...services.map(s => `be-system-design-${s}.md`)
  ];
  response.targetFiles = expectedTargetFiles;
  
  const validTargetFiles = new Set(response.targetFiles);
  response.tasks = response.tasks.map(t => {
    if (!validTargetFiles.has(t.targetFile)) {
      return { ...t, targetFile: 'api-contract.md' };
    }
    return t;
  });
  
  const hasApiContract = response.tasks.some(t => t.targetFile === 'api-contract.md');
  const hasFrontend = response.tasks.some(t => t.targetFile === 'fe-system-design.md');
  
  if (!hasApiContract || !hasFrontend || response.tasks.length < services.length + 2) {
    response.tasks = [
      {
        id: 'design-api-contract',
        name: 'Design Document: API Contract (MSA)',
        targetFile: 'api-contract.md',
        exclusive: true,
        priority: 200,
        description: 'Define all endpoints (public, internal, inter-service) with Provider/Consumer metadata. Define async events. MAX 200 lines!'
      },
      {
        id: 'design-fe',
        name: 'Design Document: Frontend System Design',
        targetFile: 'fe-system-design.md',
        parallelGroup: 'frontend',
        priority: 210,
        description: 'Design frontend consuming public API from api-contract.md. MAX 150 lines!'
      },
      ...services.map((service, idx) => ({
        id: `design-be-${service}`,
        name: `Design Document: ${service} Service`,
        targetFile: `be-system-design-${service}.md`,
        targetService: service,
        parallelGroup: `be-${service}`,
        priority: 220 + idx * 10,
        description: `Design ${service} service architecture implementing endpoints from api-contract.md. MAX 120 lines!`
      }))
    ];
  }
  
  return response;
}

/**
 * Backend-only contract-first: api-contract.md + be-system-design.md
 * Separates API interface specification from backend implementation architecture.
 */
function normalizeBackendContractFirst(response: SystemDesignResponse): SystemDesignResponse {
  response.documentType = 'contract-first';
  response.targetFiles = ['api-contract.md', 'be-system-design.md'];
  
  const taskTargets = response.tasks.map(t => t.targetFile);
  const hasRequired = 
    taskTargets.includes('api-contract.md') &&
    taskTargets.includes('be-system-design.md');
  
  if (!hasRequired || response.tasks.length < 2) {
    response.tasks = [
      {
        id: 'design-api-contract',
        name: 'Design Document: API Contract',
        targetFile: 'api-contract.md',
        exclusive: true,
        priority: 200,
        description: 'Define API contract (endpoints, DTOs, error format, auth if any). MAX 120 lines total!'
      },
      {
        id: 'design-be',
        name: 'Design Document: Backend System Design',
        targetFile: 'be-system-design.md',
        parallelGroup: 'backend',
        priority: 220,
        description: 'Design backend architecture implementing api-contract.md (layers, storage, validation, error handling). MAX 200 lines total!'
      }
    ];
  } else {
    // Remove FE tasks and remap invalid targets
    response.tasks = response.tasks
      .filter(t => t.targetFile !== 'fe-system-design.md')
      .map(t => ({
        ...t,
        targetFile: response.targetFiles.includes(t.targetFile) ? t.targetFile : 'api-contract.md'
      }));
  }
  
  return response;
}

function normalizeContractFirst(response: SystemDesignResponse): SystemDesignResponse {
  response.documentType = 'contract-first';
  response.targetFiles = ['api-contract.md', 'fe-system-design.md', 'be-system-design.md'];
  
  const taskTargets = response.tasks.map(t => t.targetFile);
  const hasRequired = 
    taskTargets.includes('api-contract.md') &&
    taskTargets.includes('fe-system-design.md') &&
    taskTargets.includes('be-system-design.md');
  
  if (!hasRequired || response.tasks.length < 3) {
    response.tasks = [
      {
        id: 'design-api-contract',
        name: 'Design Document: API Contract',
        targetFile: 'api-contract.md',
        exclusive: true,
        priority: 200,
        description: 'Define FE↔BE API contract (endpoints/events, DTOs, error format, auth if any). MAX 120 lines total!'
      },
      {
        id: 'design-fe',
        name: 'Design Document: Frontend System Design',
        targetFile: 'fe-system-design.md',
        parallelGroup: 'frontend',
        priority: 220,
        description: 'Design frontend architecture consuming api-contract.md (components, routing, state, loading/error UX, API integration). MAX 180 lines total!'
      },
      {
        id: 'design-be',
        name: 'Design Document: Backend System Design',
        targetFile: 'be-system-design.md',
        parallelGroup: 'backend',
        priority: 240,
        description: 'Design backend architecture implementing api-contract.md (layers, endpoints, storage, validation, error handling). MAX 180 lines total!'
      }
    ];
  } else {
    response.tasks = response.tasks.map(t => ({
      ...t,
      targetFile: response.targetFiles.includes(t.targetFile) ? t.targetFile : 'api-contract.md'
    }));
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
 * Determine expected targetFiles from environment alone (no LLM needed).
 * For refactor mode, prefer existing file names over defaults.
 */
function getTargetFilesForEnvironment(
  env: string | undefined,
  jobMode?: string,
  existingDesignFiles?: string[]
): string[] | null {
  if (jobMode === 'refactor' && existingDesignFiles && existingDesignFiles.length > 0) {
    const relevantFiles = filterExistingFilesByEnvironment(existingDesignFiles, env);
    if (relevantFiles.length > 0) return relevantFiles;
  }
  if (env === 'frontend') return ['fe-system-design.md'];
  if (env === 'backend') return ['api-contract.md', 'be-system-design.md'];
  if (env === 'fullstack') return ['api-contract.md', 'fe-system-design.md', 'be-system-design.md'];
  return null;
}

/**
 * Generate minimum viable tasks from targetFiles.
 * Each targetFile gets exactly one task. api-contract is exclusive, others get parallelGroup.
 */
function generateMinimumTasks(targetFiles: string[]): SystemDesignResponse['tasks'] {
  return targetFiles.map((file, idx) => {
    const baseName = file.replace('.md', '');
    const isApiContract = file === 'api-contract.md';
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
    
    const isApiContract = taskData.targetFile === 'api-contract.md';
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

  // Render prompt
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  const prompt = await promptAdapter.render('design/phases/decompose/base-system-design', {
    spec,
    hasExistingDesign,
    designPreview,
    jobMode,
    existingDesignFiles: existingDesignFiles.length > 0 ? existingDesignFiles : undefined,
    primaryDesignFile: existingDesignFiles.length > 0 ? existingDesignFiles[0] : 'system-design.md',
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
        targetFiles: ['system-design.md'],
        tasks: parsedResponse.tasks.map((task: any) => ({
          ...task,
          targetFile: task.targetFile || 'system-design.md'
        }))
      };
    } else {
      throw new Error('Invalid task breakdown format from LLM');
    }

    // Normalize
    response = normalizeResponseForEnvironment(response, detectedEnv, jobMode, existingDesignFiles);

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

  // All attempts failed → generate minimum tasks from environment
  if (!response) {
    const targetFiles = getTargetFilesForEnvironment(detectedEnv, jobMode, existingDesignFiles);
    if (!targetFiles) {
      // Cannot determine targetFiles → unrecoverable error
      throw new Error(
        `System design decompose failed after ${MAX_ATTEMPTS} attempts and environment is unknown.\n` +
        `Last error: ${lastError?.message}`
      );
    }

    console.warn(
      `⚠️  [SystemDecompose] All ${MAX_ATTEMPTS} attempts failed. ` +
      `Generating minimum tasks for env="${detectedEnv}" → [${targetFiles.join(', ')}]`
    );
    response = {
      documentType: (detectedEnv === 'fullstack' || detectedEnv === 'backend') ? 'contract-first' : 'unified',
      targetFiles,
      tasks: generateMinimumTasks(targetFiles),
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
