/**
 * Plan Node (COMPLETE REFACTORING)
 * 
 * Responsibilities:
 * 1. Pop next task from queue
 * 2. Generate task-specific keywords (LLM)
 * 3. Search Vector DB with keywords (task-specific RAG)
 * 4. Load reference projects (if needed)
 * 5. Update state with codeContext, referenceContexts
 */

import { LLMClient } from "../../../../../../core/ports";
import { ArchitectGraphState, Task, TASK_PRIORITIES } from "../../state";
import { extractErrorDetails, createErrorViolation } from "../shared/errorHandler";

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;

  const enforcementReason = state.enforcementReason;
  const isRetry = Boolean(enforcementReason);
  
  let nextTask: Task | undefined;
  
  if (isRetry && state.currentTask) {
    nextTask = state.currentTask;
    console.log(`\n🔄 [Plan] Retry task: ${nextTask.name} (attempt ${(state.retries || 0) + 1}/${state.maxRetries})\n`);
  } else {
    nextTask = state.taskQueue?.pop();
    
    if (!nextTask) {
      throw new Error('[Plan] No tasks in queue');
    }
    
    console.log(`\n📋 [Plan] Next task: ${nextTask.name}\n`);
    
    // ✅ CRITICAL: Start timing for the task
    const { TaskTimingHelper } = await import('../../state');
    console.log(`⏱️  Starting timer for task: ${nextTask.name}`);
    nextTask = TaskTimingHelper.startTask(nextTask);
    
    // ✅ CRITICAL: Update Kanban snapshot when task starts
    if (state._httpJobId && state.deps?.kanbanUpdate) {
      console.log(`\n🔥 [Plan] Updating Kanban → task started`);
      console.log(`   Current: ${nextTask.name}`);
      console.log(`   Remaining in queue: ${state.taskQueue?.size() || 0}\n`);
      
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        nextTask,                              // ✅ Show current task as in-progress
        state.taskQueue?.getAll() || [],      // ✅ Remaining queue
        state.completedTasksDetails || [],
        state.recursionCount,
        state.recursionLimit
      );
    }
  }
  
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = {
      id: nextTask.id,
      name: nextTask.name,
      type: nextTask.type,
      description: nextTask.description,
      priority: nextTask.priority
    };
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'plan',
      taskInfo,
      undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: LLM generates task-specific keywords
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let taskKeywords: { codebase: string[]; references: Map<string, string[]> } = {
    codebase: [],
    references: new Map()
  };
  
  if (llm && nextTask.type !== 'setup') {
    console.log(`🔑 [Plan] Generating search keywords...`);
    taskKeywords = await generateTaskKeywords(llm, nextTask, state);
    console.log(`   ✅ Codebase keywords: ${taskKeywords.codebase.join(', ')}`);
    if (taskKeywords.references.size > 0) {
      taskKeywords.references.forEach((kws, proj) => {
        console.log(`   ✅ Reference [${proj}]: ${kws.join(', ')}`);
      });
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Vector DB Search (task-specific)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let projectCodeContext: any = undefined;
  let referenceCodeContexts: any[] = [];
  
  if (taskKeywords.codebase.length > 0) {
    const retriever = state.deps?.retriever;
    const vectorDB = state.deps?.vectorDB;
    const git = state.deps?.git;
    
    if (retriever && vectorDB) {
      console.log(`🔍 [Plan] Searching main codebase...`);
      
      const searchQuery = taskKeywords.codebase.join(' ');
      const searchResult = await retriever.retrieve(
        searchQuery,
        state.context.workingDir,
        { vectorDB, git },
        {
          project: state.context.project,
          maxTokens: 30000,
          maxFiles: 8,
          mode: state.mode || 'refactor'
        }
      );
      
      projectCodeContext = {
        filePaths: searchResult.files?.map((f: any) => typeof f === 'string' ? f : f.path) || [],
        files: extractFilesFromCode(searchResult.code),
        stats: searchResult.stats,
        source: 'plan' as const
      };
      
      // ✅ Log retrieved files for debugging
      console.log(`   ✅ Found ${projectCodeContext.stats.filesLoaded} files:`);
      if (projectCodeContext.filePaths.length > 0) {
        projectCodeContext.filePaths.forEach((f: string) => console.log(`      📄 ${f}`));
      }
      
      // ✅ Debug: Check if file contents were extracted
      console.log(`   📦 Extracted ${projectCodeContext.files.length} file contents for prompt`);
      if (projectCodeContext.files.length === 0 && projectCodeContext.filePaths.length > 0) {
        console.warn(`   ⚠️  WARNING: File paths found but no contents extracted!`);
        console.warn(`   ⚠️  This means LLM will NOT see the file contents!`);
      }
      
      if (git) {
        const { generateGitDiffSummary } = require('../../../../../../core/codebase/GitDiffSummary');
        projectCodeContext.gitDiff = await generateGitDiffSummary(git, state.context.workingDir, projectCodeContext.filePaths);
      }
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // STEP 3: Reference projects
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (state.referenceRequests && state.referenceRequests.length > 0) {
        referenceCodeContexts = await loadReferenceContexts(
          state,
          taskKeywords,
          retriever,
          vectorDB,
          git
        );
      }
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: Generate task plan (planText)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let planText = '';
  
  // ✅ Determine if this task type REQUIRES a plan
  const requiresPlan = 
    nextTask.priority !== TASK_PRIORITIES.FINAL_VERIFICATION &&  
    nextTask.type !== 'explain';
  
  if (!requiresPlan) {
    // These task types explicitly don't need plans
    if (nextTask.priority === TASK_PRIORITIES.FINAL_VERIFICATION) {
      console.log(`   ⊖ Final verification task - no plan needed (build & validate only)`);
    } else if (nextTask.type === 'explain') {
      console.log(`   ⊖ Explain task - no plan needed (no code changes)`);
    }
    planText = '';  // Explicitly empty (not needed for these task types)
    
  } else {
    // ✅ Plan is REQUIRED for this task type
    if (!llm) {
      throw new Error(
        `[Plan] LLM client is required to generate plan for ${nextTask.type} task, ` +
        `but not available in state.deps. Task: "${nextTask.name}"`
      );
    }
    
    console.log(`📋 [Plan] Generating task plan for ${nextTask.type} task...`);
    
    // ✅ This will throw if plan generation fails - that's correct behavior!
    planText = await generateTaskPlan(
      llm,
      nextTask,
      state.design,
      projectCodeContext,
      state
    );
    
    console.log(`   ✅ Plan generated (${planText.length} chars)`);
    
    // ✅ Log warning if plan seems suspiciously short
    if (planText.length < 100) {
      console.warn(
        `   ⚠️  Warning: Plan is suspiciously short (${planText.length} chars). ` +
        `This may indicate low-quality planning.`
      );
    }
  }
  
  const shouldClearEnforcement = !isRetry;
  
  try {
    const updatedState = { 
      ...state,
      currentTask: nextTask,
      projectCodeContext,
      referenceCodeContexts,
      planText,  // ✅ Add generated execution plan
      retries: shouldClearEnforcement ? 0 : state.retries,
      enforcementReason: shouldClearEnforcement ? null : state.enforcementReason,
      completedTasksDetails: state.completedTasksDetails || [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
    
    const { saveCheckpoint } = await import('../checkpoint');
    await saveCheckpoint(updatedState);
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan');
    }
    
    return updatedState;
  } catch (error) {
    console.error('❌ [Plan] Error:', error);
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan');
    }
    
    throw error;
  }
}

async function generateTaskPlan(
  llm: LLMClient,
  task: Task,
  designDoc: string | undefined,
  projectCodeContext: any,
  state: ArchitectGraphState
): Promise<string> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    throw new Error(
      `[Plan] PromptEngine not available - cannot generate task plan for "${task.name}". ` +
      `This is required for ${task.type} tasks.`
    );
  }
  
  try {
    const prompt = await promptEngine.buildTaskPlanPrompt(
      task,
      designDoc,
      projectCodeContext
    );
    
    const response = await llm.invoke([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.3,
      maxTokens: 1500
    });
    
    const planText = response.trim();
    
    // ✅ Validation: Plan must have meaningful content
    if (!planText || planText.length < 50) {
      throw new Error(
        `[Plan] Generated plan is too short or empty (${planText.length} chars). ` +
        `This indicates LLM failure or insufficient context.\n` +
        `Task: "${task.name}" (${task.type})\n` +
        `Description: ${task.description.substring(0, 100)}...`
      );
    }
    
    return planText;
    
  } catch (error) {
    // ✅ Re-throw with context for better debugging
    if (error instanceof Error) {
      if (error.message.startsWith('[Plan]')) {
        throw error; // Already formatted
      }
      throw new Error(
        `[Plan] Task plan generation failed for "${task.name}":\n` +
        `  Task type: ${task.type}\n` +
        `  Error: ${error.message}\n` +
        `  Description: ${task.description.substring(0, 100)}...`
      );
    }
    throw error;
  }
}

async function generateTaskKeywords(
  llm: LLMClient,
  task: Task,
  state: ArchitectGraphState
): Promise<{
  codebase: string[];
  references: Map<string, string[]>;
}> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    console.warn('[Plan] PromptEngine not available, using fallback keywords');
    return {
      codebase: task.name.toLowerCase().split(' ').filter(w => w.length > 3),
      references: new Map()
    };
  }
  
  const prompt = await promptEngine.buildTaskKeywordsPrompt(
    { name: task.name, description: task.description },
    state.profile,
    state.mode || 'unknown',
    state.referenceRequests
  );

  try {
    const response = await llm.invoke([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.3,
      maxTokens: 800
    });
    
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) ||
                      response.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      
      const references = new Map<string, string[]>();
      if (parsed.references) {
        for (const [project, keywords] of Object.entries(parsed.references)) {
          if (Array.isArray(keywords)) {
            references.set(project, keywords);
          }
        }
      }
      
      return {
        codebase: parsed.codebase || [],
        references
      };
    }
  } catch (error) {
    console.warn(`⚠️  Keyword generation failed:`, error);
  }
  
  return {
    codebase: task.name.toLowerCase().split(' ').filter(w => w.length > 3),
    references: new Map()
  };
}

function extractFilesFromCode(code: string): Array<{path: string; content: string}> {
  const files: Array<{path: string; content: string}> = [];
  const fileSections = code.split(/\n\n---\n\n/);
  
  for (const section of fileSections) {
    const match = section.match(/^FILE:\s*([^\n]+)\n([\s\S]*)/);
    if (match) {
      files.push({
        path: match[1].trim(),
        content: match[2]
      });
    }
  }
  
  return files;
}

async function loadReferenceContexts(
  state: ArchitectGraphState,
  taskKeywords: { codebase: string[]; references: Map<string, string[]> },
  retriever: any,
  vectorDB: any,
  git: any
): Promise<any[]> {
  const contexts: any[] = [];
  
  if (!state.referenceRequests || state.referenceRequests.length === 0) {
    return contexts;
  }
  
  if (!taskKeywords.references || taskKeywords.references.size === 0) {
    return contexts;
  }
  
  const workspaceResolver = state.deps?.workspaceResolver;
  if (!workspaceResolver) {
    return contexts;
  }
  
  for (const ref of state.referenceRequests) {
    const keywords = taskKeywords.references.get(ref.project);
    if (!keywords || keywords.length === 0) {
      console.log(`   ⊖ No keywords for reference [${ref.project}], skipping`);
      continue;
    }
    
    try {
      const userContext = {
        userId: state.context.userId || 'local',
        organizationId: state.context.organizationId || 'local',
        workspacePath: ''
      };
      
      const refProjectPath = workspaceResolver.getProjectPath(userContext, ref.project);
      const refCodebasePath = require('path').join(refProjectPath, 'codebase');
      
      const refQuery = keywords.join(' ');
      console.log(`🔍 [Plan] Searching reference [${ref.project}] with: ${keywords.join(', ')}`);
      
      const refResult = await retriever.retrieve(
        refQuery,
        refCodebasePath,
        { vectorDB, git },
        {
          project: ref.project,
          maxTokens: 15000,
          maxFiles: 5,
          mode: 'refactor'
        }
      );
      
      contexts.push({
        project: ref.project,
        branch: ref.branch,
        files: extractFilesFromCode(refResult.code),
        stats: refResult.stats
      });
      
      console.log(`   ✅ Reference [${ref.project}]: ${refResult.stats.filesLoaded} files`);
    } catch (error) {
      console.warn(`⚠️  Failed to load reference [${ref.project}]:`, error);
    }
  }
  
  return contexts;
}

