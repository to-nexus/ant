import { LLMClient } from "../../../../../../core/ports";
import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { TaskQueue } from "../../../code/state";
import { JobTimingManager } from "../../../common/timing/JobTimingManager";
import { extractErrorDetails, logErrorHeader } from "../../../code/nodes/shared/errorHandler";

/**
 * Decompose Node for Design
 * 
 * Breaks down design requirements into tasks (usually just one: "Create Design Document")
 * Unlike code, design is typically a single coherent document, so we don't expect
 * complex task decomposition. However, we use the same pattern for consistency.
 * 
 * Key differences from code decompose:
 * - No final verification task
 * - Usually results in a single task
 * - Simpler prompt
 */
export async function decompose(state: DesignGraphState): Promise<DesignGraphState> {
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'decompose', taskInfo);
  }
  
  const llm = state.deps?.llm as LLMClient;
  
  // ✅ CRITICAL: Load session FIRST to get completedTasksDetails before signaling
  let preloadedCompletedTasks: any[] = [];
  if (state.deps?.session) {
    try {
      const session = await state.deps.session.load(
        state.context.project,
        state.context.featureFolder || 'default',
        'design'  // ✅ Specify job type
      );
      
      // ✅ Extract completed tasks for "estimating started" signal
      if (session.state?.completedTasksDetails) {
        preloadedCompletedTasks = session.state.completedTasksDetails;
        console.log(`\n📦 Preloaded ${preloadedCompletedTasks.length} completed tasks from session\n`);
      }
      
      // Resume if: taskQueue has tasks OR currentTask exists
      if (session.state && 
          session.state.taskQueue && 
          (session.state.taskQueue.length > 0 || session.state.currentTask)) {
        console.log('\n🔄 Resuming from previous design session...\n');
        
        // Restore TaskQueue from saved state
        const taskQueue = new TaskQueue<DesignTask>();
        session.state.taskQueue.forEach((task: DesignTask) => {
          taskQueue.push(task);
        });
        
        // ✨ Restore or initialize jobId and jobTiming
        const existingJobId = session.state.jobId || state._httpJobId || 'unknown-job';
        const { jobId, jobTiming: resumedJobTiming } = JobTimingManager.resumeJob(existingJobId, session.state.jobTiming);
        
        // ✅ Build merged directive from directives array (newest first = highest priority)
        let mergedDirective = state.directive;
        if (session.state.directives && session.state.directives.length > 0) {
          console.log(`\n📝 Merging ${session.state.directives.length} directive(s) (newest first):`);
          session.state.directives.forEach((dir: string, idx: number) => {
            console.log(`   ${idx + 1}. ${dir.substring(0, 60)}...`);
          });
          
          // ✅ Structure directives with context (newest = highest priority)
          if (session.state.directives.length === 1) {
            mergedDirective = session.state.directives[0];
          } else {
            // Multiple directives: label them clearly
            const [initial, ...feedbacks] = session.state.directives.slice().reverse(); // oldest first for labeling
            const parts = [`[Initial Request]\n${initial}`];
            
            feedbacks.forEach((feedback, idx) => {
              parts.push(`[Additional Feedback ${idx + 1}]\n${feedback}`);
            });
            
            // Join with clear separators (newest feedback last = most visible to LLM)
            mergedDirective = parts.join('\n\n---\n\n');
            console.log(`   ✅ Structured ${session.state.directives.length} directive(s) with labels\n`);
          }
        }
        
        const resumedState: DesignGraphState = {
          ...state,
          taskQueue,
          currentTask: session.state.currentTask,
          completedTasks: session.state.completedTasks || [],
          completedTasksDetails: session.state.completedTasksDetails || [],
          _httpJobId: state._httpJobId,
          jobId,
          jobTiming: resumedJobTiming,
          directive: mergedDirective,  // ✅ Merged directives (newest first)
          overrideDirective: session.state.overrideDirective,  // ✅ Restore chat-initiated directive
          chatSource: session.state.chatSource,  // ✅ Restore chat source flag
          files: session.state.files || [],  // ✅ Restore generated files (unified approach)
          filesToDelete: session.state.filesToDelete || [],
          interruption: undefined  // ✅ CRITICAL: Clear interruption when resuming (job is now running again)
        } as any;
        
        // ✅ Restore buffer from disk for interruption recovery
        try {
          const { StreamBufferManager } = await import('../../../../../../core/streaming/buffer/StreamBufferManager');
          const featurePath = state.deps?.workspaceResolver?.getFeaturePath(
            { userId: state.context.userId || 'local', organizationId: state.context.organizationId || 'local', workspacePath: '' },
            state.context.project,
            state.context.featureFolder
          ) || state.context.featurePath || '';
          const projectPath = featurePath.replace(`/features/${state.context.featureFolder}`, '');
          const bufferManager = new StreamBufferManager(projectPath, state.context.featureFolder, 'design', jobId);
          
          const savedBuffers = bufferManager.loadBuffersFromDisk();
          if (savedBuffers.size > 0) {
            console.log(`\n🔄 [Resume] Loaded ${savedBuffers.size} buffer(s) from disk for recovery`);
            // Buffer will be used by execute node automatically
          }
        } catch (error) {
          console.warn(`⚠️  [Resume] Failed to restore buffers (non-critical):`, error);
        }
        
        console.log(`📊 RESUMING DESIGN SESSION:`);
        console.log(`   ✅ ${resumedState.completedTasks?.length || 0} task(s) completed`);
        if (resumedState.currentTask) {
          console.log(`   🔄 Current task: "${resumedState.currentTask.name}"`);
        }
        console.log(`   📋 ${taskQueue.size()} task(s) in queue`);
        console.log(`   📄 Generated files: ${resumedState.files?.length || 0} restored\n`);
        
        // ✅ Update live snapshot via kanbanUpdate port
        console.log(`🔍 [Design Decompose Resume] Kanban update check:`);
        console.log(`   _httpJobId: ${state._httpJobId || 'undefined'}`);
        console.log(`   kanbanUpdate exists: ${!!state.deps?.kanbanUpdate}`);
        
        if (state._httpJobId && state.deps?.kanbanUpdate) {
          const completedTasks = resumedState.completedTasksDetails || [];
          const queueTasks = taskQueue.getAll();
          
          // ✅ CRITICAL: Get recursionCount and recursionLimit from resumed state
          const recursionCount = session.state.recursionCount || 0;
          const MIN_RECURSION_LIMIT = 5;
          const envLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
          const recursionLimit = (isNaN(envLimit) || envLimit < MIN_RECURSION_LIMIT) 
            ? MIN_RECURSION_LIMIT 
            : envLimit;
          
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpJobId,
            resumedState.currentTask || null,
            queueTasks,
            completedTasks,
            recursionCount,  // ✅ Pass recursion tracking
            recursionLimit   // ✅ Pass recursion limit
          );
          console.log(`🔄 [Design Decompose Resume] Live snapshot updated via PORT`);
          console.log(`   JobId: ${state._httpJobId}`);
          console.log(`   CurrentTask: ${resumedState.currentTask?.name || 'none'}`);
          console.log(`   Queue: ${taskQueue.size()} tasks`);
          console.log(`   Completed: ${completedTasks.length} tasks`);
          console.log(`   Recursion: ${recursionCount}/${recursionLimit}\n`);
        } else {
          console.log(`   ❌ Skipping Kanban update (missing httpTaskId or kanbanUpdate port)\n`);
        }
        
        return resumedState;
      }
    } catch (error) {
      console.log('⚠️  Could not load previous session state, starting fresh');
    }
  }
  
  // ✨ Initialize jobId and jobTiming for NEW job
  const { jobId: newJobId, jobTiming: newJobTiming, estimatingStartTime } = JobTimingManager.initializeNewJob(state._httpJobId!);
  
  // 💾 CRITICAL: Save jobTiming to session IMMEDIATELY so frontend can show timer during estimating
  if (state.deps?.session && state.context.featureFolder) {
    try {
      await state.deps.session.updateArtifacts(
        state.context.project,
        state.context.featureFolder,
        'design',
        {
          state: {
            jobId: newJobId,
            jobTiming: newJobTiming,
            taskQueue: [],
            completedTasks: [],
            completedTasksDetails: preloadedCompletedTasks,
            overrideDirective: state.overrideDirective,  // ✅ Preserve chat directive
            chatSource: state.chatSource  // ✅ Preserve chat source flag
          }
        }
      );
      console.log(`💾 [Design Decompose] Initial jobTiming saved to session\n`);
    } catch (error) {
      console.warn(`⚠️  [Design Decompose] Failed to save initial jobTiming:`, error);
    }
  }
  
  // ✅ NOW send "estimating started" signal with preloaded completed tasks
  if (state._httpJobId && state.deps?.kanbanUpdate) {
    console.log(`\n🎬 [Design Decompose] Signaling estimating started...`);
    console.log(`   Preserving ${preloadedCompletedTasks.length} completed tasks`);
    
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      null,    // no currentTask yet
      [],      // no tasks yet
      preloadedCompletedTasks,  // ✅ Use preloaded completed tasks
      0,       // recursionCount
      undefined // recursionLimit
    );
    console.log(`   ✅ Estimating signal sent\n`);
  }
  
  // Starting fresh - decompose into tasks
  console.log('🆕 Starting new design task - decomposing...\n');
  
  // Prepare spec
  const specParts = [
    state.prd ? `PRD:\n${state.prd}` : null,
    state.design ? `PREVIOUS DESIGN:\n${state.design}` : null,
    state.directive ? `DIRECTIVE:\n${state.directive}` : null
  ].filter(Boolean);
  
  if (specParts.length === 0) {
    console.log('⚠️  No specification provided, creating default task');
    
    // Create a single default task
    const taskQueue = new TaskQueue();
    const defaultTask: DesignTask = {
      id: 'design-doc',
      name: 'Create Design Document',
      type: 'feature',
      priority: 250,
      description: 'Create design document based on requirements',
      completed: false
    };
    
    taskQueue.push(defaultTask);
    
    const newState = {
      ...state,
      taskQueue,
      completedTasks: [],
      _httpJobId: state._httpJobId,
      jobId: newJobId,
      jobTiming: newJobTiming
    } as any;
    
    // ✅ Update live snapshot
    console.log(`\n🔍 [Design Decompose Default] Kanban update check:`);
    console.log(`   _httpJobId: ${state._httpJobId || 'undefined'}`);
    console.log(`   kanbanUpdate exists: ${!!state.deps?.kanbanUpdate}`);
    
    if (state._httpJobId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        null,
        taskQueue.getAll(),
        []
      );
      console.log(`   ✅ Live snapshot updated (1 default task)\n`);
    } else {
      console.log(`   ❌ Skipping Kanban update (missing httpTaskId or kanbanUpdate port)\n`);
    }
    
    return newState;
  }
  
  const spec = specParts.join('\n\n---\n\n');
  
  // Check if this is a new design or evolution/refactor
  const hasExistingDesign = Boolean(state.design && state.design.trim().length > 0);
  const designPreview = state.design ? state.design.split('\n').slice(0, 50).join('\n') + '\n...' : '';
  
  // ✅ Use FilePromptAdapter for design decompose template
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  
  // Render template with variables
  const prompt = await promptAdapter.render('design/phases/decompose/base', {
    spec,
    hasExistingDesign,
    designPreview
  });

  try {
    console.log('🤖 Analyzing design requirements...\n');
    
    // ✅ Show placeholder before LLM call
    const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
    const chatAPI = getChatAPIClient();
    await chatAPI.showChatStatus('placeholder');
    
    // ✅ NEW: Use design decompose-specific model if configured
    let llmToUse = llm;
    if (state.workspaceConfig) {
      const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');
      llmToUse = createLLMClient(
        'architect',
        undefined,
        { jobType: 'design', nodeType: 'decompose' },
        state.workspaceConfig
      );
    }
    
    // Call LLM with structured output
    let response: { 
      documentType: 'unified' | 'contract-first';
      targetFiles: string[];
      tasks: Array<{ 
        id: string; 
        name: string; 
        targetFile: string;
        description: string; 
        priority: number;
      }> 
    };
    
    if (llmToUse.invokeStructured) {
      response = await llmToUse.invokeStructured(
        [{ role: 'user', content: prompt }],
        {
          type: 'object',
          properties: {
            documentType: {
              type: 'string',
              enum: ['unified', 'contract-first'],
              description: 'Document strategy: unified (single system-design.md) or contract-first (api-contract.md, fe-system-design.md, be-system-design.md)'
            },
            targetFiles: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files to create (e.g., ["system-design.md"] or ["api-contract.md", "fe-system-design.md", "be-system-design.md"])'
            },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  targetFile: { 
                    type: 'string',
                    description: 'Target design document: must match one from targetFiles array'
                  },
                  description: { type: 'string' },
                  priority: { type: 'number' }
                },
                required: ['id', 'name', 'targetFile', 'description', 'priority']
              }
            }
          },
          required: ['documentType', 'targetFiles', 'tasks']
        },
        'design_task_decomposition'
      );
    } else {
      // Fallback: parse JSON from text response
      const textResponse = await llmToUse.invoke([{ role: 'user', content: prompt }]);
      const jsonMatch = textResponse.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not parse task breakdown from LLM response');
      }
      const parsedResponse = JSON.parse(jsonMatch[0]);
      
      // ✅ Handle both old format (tasks only) and new format (documentType + targetFiles + tasks)
      if (parsedResponse.documentType && parsedResponse.targetFiles && parsedResponse.tasks) {
        response = parsedResponse;
      } else if (parsedResponse.tasks) {
        // Old format fallback: assume unified mode
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
    }
    
    // ✅ Validate targetFiles consistency
    console.log(`\n📊 Design Strategy: ${response.documentType}`);
    console.log(`📄 Target Files: ${response.targetFiles.join(', ')}`);
    
    // Create TaskQueue and populate
    const taskQueue = new TaskQueue();
    
    for (const taskData of response.tasks) {
      // ✅ Validate targetFile is in targetFiles array
      if (!response.targetFiles.includes(taskData.targetFile)) {
        console.warn(`⚠️  Task "${taskData.name}" has invalid targetFile: ${taskData.targetFile}`);
        console.warn(`   Expected one of: ${response.targetFiles.join(', ')}`);
        console.warn(`   Using default: ${response.targetFiles[0]}`);
        taskData.targetFile = response.targetFiles[0];
      }
      
      const task: DesignTask = {
        id: taskData.id,
        name: taskData.name,
        type: 'feature',
        priority: taskData.priority || 250,
        description: taskData.description,
        targetFile: taskData.targetFile,  // ✅ Use LLM-specified targetFile
        completed: false
      };
      
      taskQueue.push(task);
    }
    
    console.log(`\n✅ Task breakdown complete: ${taskQueue.size()} tasks\n`);
    
    // ✅ CRITICAL: Pop first task and set as currentTask immediately
    const firstTask = taskQueue.pop();
    if (!firstTask) {
      throw new Error('No tasks in queue after decompose');
    }
    
    // ✨ Start timing for the first task
    const { TaskTimingHelper } = await import('../../../code/state');
    console.log(`⏱️  Starting timer for first task: ${firstTask.name}`);
    const currentTask = TaskTimingHelper.startTask(firstTask);
    
    // ✨ Calculate estimating duration
    const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(newJobTiming, estimatingStartTime);
    
    const newState = {
      ...state,
      taskQueue,
      currentTask, // ✅ Set first task as current
      completedTasks: [],
      _httpJobId: state._httpJobId,
      jobId: newJobId,
      jobTiming: finalJobTiming
    } as any;
    
    // ✅ CRITICAL: Save checkpoint immediately after decompose (like code job)
    // This triggers file watcher → SSE broadcast → UI update
    if (state.deps?.session && state.context.featureFolder) {
      try {
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'design',  // ✅ Add job parameter
          {
            state: {
              taskQueue: taskQueue.getAll(),
              completedTasks: [],
              completedTasksDetails: [],
              jobId: newJobId,
              jobTiming: finalJobTiming
            }
          }
        );
        console.log(`💾 [Design Decompose] Checkpoint saved (${taskQueue.size()} tasks)\n`);
      } catch (error) {
        console.warn(`⚠️  [Design Decompose] Failed to save checkpoint:`, error);
      }
    }
    
    // ✅ Update live snapshot with FIRST TASK as current
    // Kanban SSE will be queued on frontend and processed after workflow SSE
    console.log(`\n🔍 [Design Decompose] Kanban update check:`);
    console.log(`   _httpJobId: ${state._httpJobId || 'undefined'}`);
    console.log(`   kanbanUpdate exists: ${!!state.deps?.kanbanUpdate}`);
    console.log(`   First task: ${currentTask.name}`);
    
    if (state._httpJobId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        currentTask, // ✅ Set first task as In Progress
        taskQueue.getAll(),
        []
      );
      console.log(`   ✅ Kanban SSE sent - First task "${currentTask.name}" → In Progress\n`);
    } else {
      console.log(`   ❌ Skipping Kanban update (missing httpTaskId or kanbanUpdate port)\n`);
    }
    
    return newState;
  } catch (error) {
    console.error('❌ Task decomposition failed:', error);
    console.log('⚠️  Falling back to default single task\n');
    
    // Fallback: create single default task
    const taskQueue = new TaskQueue();
    const defaultTask: DesignTask = {
      id: 'design-doc',
      name: 'Create Design Document',
      type: 'feature',
      priority: 250,
      description: 'Create design document based on requirements',
      completed: false
    };
    
    taskQueue.push(defaultTask);
    
    const newState = {
      ...state,
      taskQueue,
      completedTasks: [],
      _httpJobId: state._httpJobId,
      jobId: newJobId,
      jobTiming: newJobTiming
    } as any;
    
    // ✅ CRITICAL: Save checkpoint for fallback too
    if (state.deps?.session && state.context.featureFolder) {
      try {
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'design',  // ✅ Add job parameter
          {
            state: {
              taskQueue: taskQueue.getAll(),
              completedTasks: [],
              completedTasksDetails: [],
              jobId: newJobId,
              jobTiming: newJobTiming
            }
          }
        );
        console.log(`💾 [Design Decompose Fallback] Checkpoint saved (1 task)\n`);
      } catch (error) {
        console.warn(`⚠️  [Design Decompose Fallback] Failed to save checkpoint:`, error);
      }
    }
    
    // ✅ Update live snapshot
    console.log(`\n🔍 [Design Decompose Fallback] Kanban update check:`);
    console.log(`   _httpJobId: ${state._httpJobId || 'undefined'}`);
    console.log(`   kanbanUpdate exists: ${!!state.deps?.kanbanUpdate}`);
    
    if (state._httpJobId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        null,
        taskQueue.getAll(),
        []
      );
      console.log(`   ✅ Live snapshot updated (1 default task)\n`);
    } else {
      console.log(`   ❌ Skipping Kanban update (missing httpTaskId or kanbanUpdate port)\n`);
    }
    
    return newState;
  }
}

