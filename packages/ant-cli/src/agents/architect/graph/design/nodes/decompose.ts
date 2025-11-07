import { LLMClient } from "../../../../../core/ports";
import { DesignGraphState, Task, TaskQueue } from "../state";

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
    state.deps.workflowUpdate.enterNode(state._httpTaskId, 'decompose');
  }
  
  const llm = state.deps?.llm as LLMClient;
  
  // ✅ RESUME: Check if we have previous state to restore
  if (state.deps?.session) {
    try {
      const session = await state.deps.session.load(
        state.context.project,
        state.context.featureFolder || 'default'
      );
      
      // Resume if: taskQueue has tasks OR currentTask exists
      if (session.state && 
          session.state.taskQueue && 
          (session.state.taskQueue.length > 0 || session.state.currentTask)) {
        console.log('\n🔄 Resuming from previous session...\n');
        
        // Restore TaskQueue from saved state
        const taskQueue = new TaskQueue();
        session.state.taskQueue.forEach((task: Task) => {
          taskQueue.push(task);
        });
        
        const resumedState: DesignGraphState = {
          ...state,
          taskQueue,
          currentTask: session.state.currentTask,
          completedTasks: session.state.completedTasks || [],
          completedTasksDetails: session.state.completedTasksDetails || [],
          _httpTaskId: state._httpTaskId
        };
        
        console.log(`📊 RESUMING SESSION:`);
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
      _httpTaskId: state._httpTaskId
    };
    
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
    
    const newState = {
      ...state,
      taskQueue,
      completedTasks: [],
      _httpTaskId: state._httpTaskId
    };
    
    // ✅ Update live snapshot via kanbanUpdate port
    console.log(`\n🔍 [Design Decompose] Kanban update check:`);
    console.log(`   _httpTaskId: ${state._httpTaskId || 'undefined'}`);
    console.log(`   kanbanUpdate exists: ${!!state.deps?.kanbanUpdate}`);
    
    if (state._httpTaskId && state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpTaskId,
        null,
        taskQueue.getAll(),
        []
      );
      console.log(`   ✅ Live snapshot updated (${taskQueue.size()} tasks)\n`);
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
      _httpTaskId: state._httpTaskId
    };
    
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

