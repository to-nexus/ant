import { LLMClient } from "../../../../../core/ports";
import { DesignGraphState, Task, TaskQueue } from "../state";
import { JobTimingManager } from "../../common/timing/JobTimingManager";

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
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpTaskId, 'decompose', taskInfo);
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
        const taskQueue = new TaskQueue();
        session.state.taskQueue.forEach((task: Task) => {
          taskQueue.push(task);
        });
        
        // ✨ Restore or initialize jobId and jobTiming
        const existingJobId = session.state.jobId || state._httpTaskId || 'unknown-job';
        const { jobId, jobTiming: resumedJobTiming } = JobTimingManager.resumeJob(existingJobId, session.state.jobTiming);
        
        const resumedState: DesignGraphState = {
          ...state,
          taskQueue,
          currentTask: session.state.currentTask,
          completedTasks: session.state.completedTasks || [],
          completedTasksDetails: session.state.completedTasksDetails || [],
          _httpTaskId: state._httpTaskId,
          jobId,
          jobTiming: resumedJobTiming
        } as any;
        
        console.log(`📊 RESUMING DESIGN SESSION:`);
        console.log(`   ✅ ${resumedState.completedTasks?.length || 0} task(s) completed`);
        if (resumedState.currentTask) {
          console.log(`   🔄 Current task: "${resumedState.currentTask.name}"`);
        }
        console.log(`   📋 ${taskQueue.size()} task(s) in queue\n`);
        
        // ✅ Update live snapshot via kanbanUpdate port
        console.log(`🔍 [Design Decompose Resume] Kanban update check:`);
        console.log(`   _httpTaskId: ${state._httpTaskId || 'undefined'}`);
        console.log(`   kanbanUpdate exists: ${!!state.deps?.kanbanUpdate}`);
        
        if (state._httpTaskId && state.deps?.kanbanUpdate) {
          const completedTasks = resumedState.completedTasksDetails || [];
          const queueTasks = taskQueue.getAll();
          
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpTaskId,
            resumedState.currentTask || null,
            queueTasks,
            completedTasks
          );
          console.log(`   ✅ Live snapshot updated (${taskQueue.size()} tasks)\n`);
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
  const { jobId: newJobId, jobTiming: newJobTiming, estimatingStartTime } = JobTimingManager.initializeNewJob(state._httpTaskId!);
  
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
            completedTasksDetails: preloadedCompletedTasks
          }
        }
      );
      console.log(`💾 [Design Decompose] Initial jobTiming saved to session\n`);
    } catch (error) {
      console.warn(`⚠️  [Design Decompose] Failed to save initial jobTiming:`, error);
    }
  }
  
  // ✅ NOW send "estimating started" signal with preloaded completed tasks
  if (state._httpTaskId && state.deps?.kanbanUpdate) {
    console.log(`\n🎬 [Design Decompose] Signaling estimating started...`);
    console.log(`   Preserving ${preloadedCompletedTasks.length} completed tasks`);
    
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpTaskId,
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
    const defaultTask: Task = {
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
      _httpTaskId: state._httpTaskId,
      jobId: newJobId,
      jobTiming: newJobTiming
    } as any;
    
    // ✅ Update live snapshot
    console.log(`\n🔍 [Design Decompose Default] Kanban update check:`);
    console.log(`   _httpTaskId: ${state._httpTaskId || 'undefined'}`);
    console.log(`   kanbanUpdate exists: ${!!state.deps?.kanbanUpdate}`);
    
    if (state._httpTaskId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpTaskId,
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
  const hasExistingCode = Boolean(state.code && state.code.trim().length > 0);
  const designPreview = state.design ? state.design.split('\n').slice(0, 50).join('\n') + '\n...' : '';
  const codePreview = state.code ? state.code.split('\n').slice(0, 20).join('\n') + '\n...' : '';
  
  // ✅ Use FilePromptAdapter for design decompose template
  const FilePromptAdapter = await import('../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  
  // Render template with variables
  const prompt = await promptAdapter.render('design/phases/decompose/base', {
    spec,
    hasExistingDesign,
    hasExistingCode,
    designPreview,
    codePreview
  });

  try {
    console.log('🤖 Analyzing design requirements...\n');
    
    // Call LLM with structured output
    let response: { tasks: Array<{ id: string; name: string; description: string; priority: number }> };
    
    if (llm.invokeStructured) {
      response = await llm.invokeStructured(
        [{ role: 'user', content: prompt }],
        {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  priority: { type: 'number' }
                },
                required: ['id', 'name', 'description', 'priority']
              }
            }
          },
          required: ['tasks']
        },
        'design_task_decomposition'
      );
    } else {
      // Fallback: parse JSON from text response
      const textResponse = await llm.invoke([{ role: 'user', content: prompt }]);
      const jsonMatch = textResponse.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not parse task breakdown from LLM response');
      }
      response = JSON.parse(jsonMatch[0]);
    }
    
    // Create TaskQueue and populate
    const taskQueue = new TaskQueue();
    
    for (const taskData of response.tasks) {
      const task: Task = {
        id: taskData.id,
        name: taskData.name,
        type: 'feature',
        priority: taskData.priority || 250,
        description: taskData.description,
        completed: false
      };
      
      taskQueue.push(task);
    }
    
    console.log(`\n✅ Task breakdown complete:`);
    console.log(`   📋 Total tasks: ${taskQueue.size()}\n`);
    
    // Print task summary
    const tasks = taskQueue.getAll();
    tasks.forEach((task, index) => {
      console.log(`   ${index + 1}. ${task.name}`);
      console.log(`      ${task.description}`);
      console.log(`      Priority: ${task.priority}\n`);
    });
    
    // ✅ CRITICAL: Pop first task and set as currentTask immediately
    const firstTask = taskQueue.pop();
    if (!firstTask) {
      throw new Error('No tasks in queue after decompose');
    }
    
    // ✨ Start timing for the first task
    const { TaskTimingHelper } = await import('../../code/state');
    console.log(`⏱️  Starting timer for first task: ${firstTask.name}`);
    const currentTask = TaskTimingHelper.startTask(firstTask);
    
    // ✨ Calculate estimating duration
    const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(newJobTiming, estimatingStartTime);
    
    const newState = {
      ...state,
      taskQueue,
      currentTask, // ✅ Set first task as current
      completedTasks: [],
      _httpTaskId: state._httpTaskId,
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
    console.log(`   _httpTaskId: ${state._httpTaskId || 'undefined'}`);
    console.log(`   kanbanUpdate exists: ${!!state.deps?.kanbanUpdate}`);
    console.log(`   First task: ${currentTask.name}`);
    
    if (state._httpTaskId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpTaskId,
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
    const defaultTask: Task = {
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
      _httpTaskId: state._httpTaskId,
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
    console.log(`   _httpTaskId: ${state._httpTaskId || 'undefined'}`);
    console.log(`   kanbanUpdate exists: ${!!state.deps?.kanbanUpdate}`);
    
    if (state._httpTaskId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpTaskId,
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

