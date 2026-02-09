/**
 * System Design Decompose
 * 
 * LLM-driven task decomposition for system design work
 * (unified, contract-first, MSA-contract-first).
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../code/state";
import { JobTimingManager } from "../../../common/timing/JobTimingManager";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../common/llmConfig";
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
// Environment-based Response Normalization
// ============================================

function normalizeResponseForEnvironment(
  response: SystemDesignResponse,
  detectedEnv: string | undefined
): SystemDesignResponse {
  if (detectedEnv === 'frontend' || detectedEnv === 'backend') {
    response.documentType = 'unified';
    response.targetFiles = ['system-design.md'];
    response.tasks = response.tasks.map(t => ({ ...t, targetFile: 'system-design.md' }));
    return response;
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

  // Render prompt
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  const prompt = await promptAdapter.render('design/phases/decompose/base-system-design', {
    spec,
    hasExistingDesign,
    designPreview,
    jobMode: state.detectionReport?.jobMode || 'generate',
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

  try {
    await showChatPlaceholder();
    const llmToUse = await resolveLLMClient(state);
    if (!llmToUse) throw new Error('LLM client not available');

    // Call LLM
    const result = await llmToUse.invokeWithUsage?.(
      [{ role: 'user', content: prompt }],
      { temperature: LLM_TEMPERATURE.DECOMPOSE, maxTokens: LLM_MAX_TOKENS.DECOMPOSE_SYSTEM }
    );
    const textResponse = result?.content || await llmToUse.invoke([{ role: 'user', content: prompt }]);

    await trackTokenUsage(state, result?.usage);

    // Parse response
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

    // Normalize based on detected environment
    response = normalizeResponseForEnvironment(response, state.detectionReport?.environment);

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

    // Reset task-level token usage (will be used by first task in plan node)
    const { resetTaskTokenUsage } = await import('../../../common/llmHelpers');
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
  } catch (error) {
    console.error('❌ Task decomposition failed:', error);
    throw error;
  }
}
