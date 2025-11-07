import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState, Task, TaskQueue } from "../state";

/**
 * Decompose Node
 * 
 * Meta-level planning: Break the overall task into executable tasks
 * This runs ONCE at the beginning to create the initial task queue.
 * 
 * ✅ RESUME SUPPORT: If previous state exists in session, restore it instead of decomposing
 * 
 * Responsibilities:
 * 1. Check for existing session state (for resuming after recursion limit)
 * 2. If state exists → restore task queue and continue
 * 3. If no state → analyze spec and create new task queue
 * 4. Store feature tasks for completion tracking
 */
export async function decompose(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  
  // ✅ Workflow instrumentation: Enter node with LLM info
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    
    // ✅ Extract LLM info from GenericLLMClient
    const llmInfo = (llm as any)?.provider && (llm as any)?.modelName ? {
      provider: (llm as any).provider,
      model: (llm as any).modelName
    } : undefined;
    
    state.deps.workflowUpdate.enterNode(state._httpTaskId, 'decompose', taskInfo, llmInfo);
  }
  
  // ✅ CRITICAL: Load session FIRST to get completedTasksDetails before signaling
  let preloadedCompletedTasks: any[] = [];
  if (state.deps?.session) {
    try {
      const session = await state.deps.session.load(
        state.context.project,
        state.context.featureFolder || 'default'
      );
      
      // ✅ Extract completed tasks for "estimating started" signal
      if (session.state?.completedTasksDetails) {
        preloadedCompletedTasks = session.state.completedTasksDetails;
        console.log(`\n📦 Preloaded ${preloadedCompletedTasks.length} completed tasks from session\n`);
      }
      
      // ✅ Resume if: taskQueue has tasks OR currentTask exists (task in progress)
      if (session.state && 
          session.state.taskQueue && 
          (session.state.taskQueue.length > 0 || session.state.currentTask)) {
        console.log('\n🔄 Resuming from previous session...\n');
        
        // ✅ CRITICAL: Reload codebase from actual disk to detect file deletions
        const gitPort = state.deps?.git;
        let reloadedCode = state.code;
        let shouldResetAndDecompose = false;  // Flag to trigger decomposition
        
        if (gitPort) {
          console.log('📂 Reloading current codebase from disk...');
          
          try {
            const allFiles = await gitPort.listFiles('', [
              'node_modules', 'dist', 'build', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.git',
              '*.test.ts', '*.test.tsx', '*.spec.ts', '*.spec.tsx'
            ]);
            
            const fileContents: string[] = [];
            let totalTokens = 0;
            
            for (const file of allFiles.slice(0, 50)) {
              try {
                const content = await gitPort.readFile(file);
                if (content && content.length > 0) {
                  fileContents.push(`=== ${file} ===\n${content}\n`);
                  totalTokens += Math.ceil(content.length / 4);
                  if (totalTokens > 100000) break;
                }
              } catch (error) {
                // Skip files that can't be read
              }
            }
            
            reloadedCode = fileContents.join('\n');
            console.log(`   ✅ Reloaded ${fileContents.length} files (~${totalTokens} tokens) from disk\n`);
            
            // ✅ Detect full project deletion (not partial edits)
            const hasCompletedTasks = session.state.completedTasks && session.state.completedTasks.length > 0;
            const hasNoFiles = fileContents.length === 0;
            
            if (hasCompletedTasks && hasNoFiles) {
              // 🚨 All files deleted - reset and decompose
              console.log('⚠️  All project files have been deleted');
              console.log(`   Session shows ${session.state.completedTasks?.length || 0} completed task(s) but 0 files exist`);
              console.log('🔄 Treating as NEW PROJECT - will decompose into tasks\n');
              
              // Set flag and reset state
              shouldResetAndDecompose = true;
              state = {
                ...state,
                code: "",
                completedTasks: [],
                retries: 0,
                previousAttempts: [],
                enforcementHistory: [],
                lastViolations: [],
                previousFileCount: 0,
                resolvedCategories: []
              };
            } else {
              // Normal resume - update code
              state = { ...state, code: reloadedCode };
            }
          } catch (error) {
            console.warn(`⚠️  Could not reload files: ${error}`);
          }
        }
        
        // If reset detected, skip queue restoration and fall through to decomposition
        if (shouldResetAndDecompose) {
          // Fall through to line 71 (decomposition logic)
        } else {
          // Normal resume - restore queue and return
        
        // Restore TaskQueue from saved state
        const taskQueue = new TaskQueue();
        session.state.taskQueue.forEach((task: Task) => {
          taskQueue.push(task);
        });
        
        // Restore featureTasks map
        const featureTasks = new Map<string, Task>();
        session.state.taskQueue.forEach((task: Task) => {
          if (task.type === 'feature') {
            featureTasks.set(task.id, task);
          }
        });
        
        // Calculate task type breakdown (including currentTask if exists)
        const tasksByType = {
          setup: 0,
          feature: 0,
          error: 0,
          final: 0
        };
        
        // Count tasks in queue
        taskQueue.getAll().forEach(task => {
          if (task.priority === 1000) {
            tasksByType.final++;
          } else if (task.type === 'error') {
            tasksByType.error++;
          } else if (task.type === 'setup') {
            tasksByType.setup++;
          } else if (task.type === 'feature') {
            tasksByType.feature++;
          }
        });
        
        // Add currentTask to count (if it exists - task in progress)
        if (session.state.currentTask) {
          const currentTask = session.state.currentTask;
          if (currentTask.priority === 1000) {
            tasksByType.final++;
          } else if (currentTask.type === 'error') {
            tasksByType.error++;
          } else if (currentTask.type === 'setup') {
            tasksByType.setup++;
          } else if (currentTask.type === 'feature') {
            tasksByType.feature++;
          }
        }
        
        const completedCount = session.state.completedTasks?.length || 0;
        const inProgressCount = session.state.currentTask ? 1 : 0;
        const totalTasks = completedCount + taskQueue.size() + inProgressCount;
        
        console.log(`📊 Resuming existing project:`);
        console.log(`   Progress: ${completedCount}/${totalTasks} tasks (${Math.round(completedCount / totalTasks * 100)}%)`);
        console.log(`   `);
        console.log(`   Setup:   ${tasksByType.setup === 0 ? '✅' : '⬜'} ${tasksByType.setup} remaining`);
        console.log(`   Feature: ${tasksByType.feature === 0 ? '✅' : '⬜'} ${tasksByType.feature} remaining`);
        console.log(`   Error:   ${tasksByType.error === 0 ? '✅' : '⚠️ '} ${tasksByType.error} remaining`);
        console.log(`   Final:   ${tasksByType.final === 0 ? '✅' : '⬜'} ${tasksByType.final} remaining`);
        console.log(``);
        
        const resumedState = {
          ...state,
          taskQueue,
          featureTasks,
          currentTask: session.state.currentTask,  // ✅ Restore currentTask (in-progress task)
          completedTasks: session.state.completedTasks || [],
          completedTasksDetails: session.state.completedTasksDetails || [],  // ✅ Restore full details
          retries: session.state.retries || 0,
          maxRetries: session.state.maxRetries || 3,
          previousAttempts: session.state.previousAttempts || [],
          enforcementHistory: session.state.enforcementHistory || [],
          lastViolations: session.state.lastViolations || [],
          previousFileCount: session.state.previousFileCount,
          resolvedCategories: (session.state.resolvedCategories || []) as any,
          planText: session.state.planText || '',  // ✅ Restore plan to skip LLM call on resume
          _httpTaskId: state._httpTaskId  // ✅ Explicitly preserve taskId for next node
        };
        
        // ✅ Update live snapshot for seamless UI transition (Port or HTTP fallback)
        if (state._httpTaskId) {
          const completedTasks = resumedState.completedTasksDetails || [];
          const queueTasks = taskQueue.getAll();
          
          if (state.deps?.kanbanUpdate) {
            // In-process: use injected port
            state.deps.kanbanUpdate.updateTaskQueue(
              state._httpTaskId,
              resumedState.currentTask || null,
              queueTasks,
              completedTasks
            );
            console.log(`🔄 [Decompose Resume] Live snapshot updated via PORT (${taskQueue.size()} tasks, current: ${resumedState.currentTask?.name || 'none'})\n`);
          } else {
            // Child process: HTTP API fallback
            const serverPort = process.env.ANT_SERVER_PORT || '4100';
            fetch(`http://localhost:${serverPort}/api/internal/task-queue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId: state._httpTaskId,
                currentTask: resumedState.currentTask || null,
                queue: queueTasks,
                completedTasks: completedTasks
              })
            }).then(() => {
              console.log(`🔄 [Decompose Resume] Live snapshot updated via HTTP (${taskQueue.size()} tasks, current: ${resumedState.currentTask?.name || 'none'})\n`);
            }).catch(err => console.log(`⚠️  [Decompose Resume] HTTP update failed:`, err.message));
          }
        }
        
        return resumedState;
        }  // End of else block (normal resume)
      }  // End of if (session.state && taskQueue)
    } catch (error) {
      console.log('⚠️  Could not load previous session state, starting fresh');
    }
  }
  
  // ✅ NOW send "estimating started" signal with preloaded completed tasks
  if (state._httpTaskId && state.deps?.kanbanUpdate) {
    console.log(`\n🎬 [Code Decompose] Signaling estimating started...`);
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
  
  // Starting fresh - no session or session was reset
  console.log('🆕 Starting new project - decomposing into tasks...\n');
  
  // Prepare spec
  const specParts = [
    state.prd ? `PRD:\n${state.prd}` : null,
    state.design ? `DESIGN:\n${state.design}` : null,
    state.directive ? `DIRECTIVE:\n${state.directive}` : null
  ].filter(Boolean);
  
  if (specParts.length === 0) {
    console.log('⚠️  No specification provided, creating minimal task');
    
    // Create a single default task
    const taskQueue = new TaskQueue();
    const defaultTask: Task = {
      id: 'default',
      name: 'Implement Requirements',
      type: 'feature',
      priority: 220,
      description: 'Implement based on directive or design',
      completed: false
    };
    
    taskQueue.push(defaultTask);
    
    const featureTasks = new Map<string, Task>();
    featureTasks.set(defaultTask.id, defaultTask);
    
    const newState = {
      ...state,
      taskQueue,
      featureTasks,
      completedTasks: [],
      _httpTaskId: state._httpTaskId  // ✅ Explicitly preserve taskId for next node
    };
    
    // ✅ Save checkpoint for default task
    if (state.deps?.session && state.context.featureFolder) {
      try {
        const { saveCheckpoint } = await import('./checkpoint');
        await saveCheckpoint(newState);
        console.log(`💾 [Decompose Default] Checkpoint saved (1 default task)\n`);
      } catch (error) {
        console.warn(`⚠️  [Decompose] Failed to save checkpoint:`, error);
      }
    }
    
    // ✅ Update live snapshot (Port or HTTP fallback)
    if (state._httpTaskId) {
      const completedTasks = state.completedTasksDetails || [];
      const queueTasks = taskQueue.getAll();
      
      if (state.deps?.kanbanUpdate) {
        // In-process: use injected port
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpTaskId,
          null,
          queueTasks,
          completedTasks
        );
        console.log(`🎬 [Decompose Default] Live snapshot updated via PORT (1 default task)\n`);
      } else {
        // Child process: HTTP API fallback
        const serverPort = process.env.ANT_SERVER_PORT || '4100';
        fetch(`http://localhost:${serverPort}/api/internal/task-queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: state._httpTaskId,
            currentTask: null,
            queue: queueTasks,
            completedTasks: completedTasks
          })
        }).then(() => {
          console.log(`🎬 [Decompose Default] Live snapshot updated via HTTP (1 default task)\n`);
        }).catch(err => console.log(`⚠️  [Decompose Default] HTTP update failed:`, err.message));
      }
    }
    
    return newState;
  }
  
  const spec = specParts.join('\n\n---\n\n');
  
  // Check if this is a new project (no existing code)
  const isNewProject = !state.code || state.code.trim().length === 0;
  const hasExistingCode = Boolean(state.code && state.code.trim().length > 0);
  const codePreview = state.code ? state.code.split('\n').slice(0, 20).join('\n') + '\n...' : '(empty)';
  
  // Load prompt templates
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    throw new Error('PromptEngine not available');
  }
  
  // Use FilePromptAdapter directly for decompose templates
  const FilePromptAdapter = await import('../../../../../periphery/adapters/prompt/FilePromptAdapter');
  const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
  
  // Render templates with variables
  const basePrompt = await promptAdapter.render('code/phases/decompose/base', {
    spec,
    hasExistingCode,
    codePreview
  });
  
  const validationStrategy = await promptAdapter.render('code/phases/decompose/injections/validation-strategy', {});
  const rules = await promptAdapter.render('code/phases/decompose/rules', {});
  
  const prompt = `${basePrompt}

${validationStrategy}

${rules}`;

  try {
    // Define JSON schema for task decomposition
    const taskSchema = {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Unique task identifier in kebab-case"
              },
              name: {
                type: "string",
                description: "Human-readable task name"
              },
              type: {
                type: "string",
                enum: ["setup", "feature", "error"],
                description: "Task type: setup (config files), feature (implementation), or error (bug fix)"
              },
              priority: {
                type: "number",
                description: "Priority number (lower = higher priority). Setup: 100, Features: 200-999"
              },
              description: {
                type: "string",
                description: "Detailed task description"
      },
              dependencies: {
                type: "array",
                items: { type: "string" },
                description: "Optional array of task IDs this task depends on"
              },
              validationRequired: {
                type: "boolean",
                description: "Whether this task requires validation after completion. Use true for critical tasks, false for batch intermediate tasks"
              },
              validationType: {
                type: "string",
                enum: ["none", "static", "runtime"],
                description: "Type of validation: none (skip all), static (syntax/config only), runtime (full: tsc + build + lint)"
              },
              validationRationale: {
                type: "string",
                description: "Brief explanation for the validation decision (e.g., 'Config files need syntax check', 'Batch component, validate at end')"
              }
            },
            required: ["id", "name", "type", "priority", "description", "validationRequired", "validationType"]
          }
        }
      },
      required: ["tasks"]
    };
    
    // Use structured output to guarantee valid JSON
    const result = await llm.invokeStructured<{ tasks: Task[] }>(
      [{ role: 'user', content: prompt }],
      taskSchema,
      'task_decomposition'
    );
    
    const tasks: Task[] = result.tasks || [];
    
    if (tasks.length === 0) {
      console.log('⚠️  No tasks created from spec, creating default task');
      
      const taskQueue = new TaskQueue();
      const defaultTask: Task = {
        id: 'impl-spec',
        name: 'Implement Specification',
        type: 'feature',
        priority: 220,
        description: 'Implement requirements from specification',
        completed: false
      };
      
      taskQueue.push(defaultTask);
      
      const featureTasks = new Map<string, Task>();
      featureTasks.set(defaultTask.id, defaultTask);
      
      const newState = {
        ...state,
        taskQueue,
        featureTasks,
        completedTasks: [],
        _httpTaskId: state._httpTaskId  // ✅ Explicitly preserve taskId for next node
      };
      
      // ✅ Save checkpoint for default task
      if (state.deps?.session && state.context.featureFolder) {
        try {
          const { saveCheckpoint } = await import('./checkpoint');
          await saveCheckpoint(newState);
          console.log(`💾 [Decompose EmptyResult] Checkpoint saved (1 default task)\n`);
        } catch (error) {
          console.warn(`⚠️  [Decompose] Failed to save checkpoint:`, error);
        }
      }
      
      // ✅ Update live snapshot (Port or HTTP fallback)
      if (state._httpTaskId) {
        const completedTasks = state.completedTasksDetails || [];
        const queueTasks = taskQueue.getAll();
        
        if (state.deps?.kanbanUpdate) {
          // In-process: use injected port
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpTaskId,
            null,
            queueTasks,
            completedTasks
          );
          console.log(`🎬 [Decompose EmptyResult] Live snapshot updated via PORT (1 default task)\n`);
        } else {
          // Child process: HTTP API fallback
          const serverPort = process.env.ANT_SERVER_PORT || '4100';
          fetch(`http://localhost:${serverPort}/api/internal/task-queue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: state._httpTaskId,
              currentTask: null,
              queue: queueTasks,
              completedTasks: completedTasks
            })
          }).then(() => {
            console.log(`🎬 [Decompose EmptyResult] Live snapshot updated via HTTP (1 default task)\n`);
          }).catch(err => console.log(`⚠️  [Decompose EmptyResult] HTTP update failed:`, err.message));
        }
      }
      
      return newState;
    }
    
    // Create task queue
    const taskQueue = new TaskQueue();
    const featureTasks = new Map<string, Task>();
    
    tasks.forEach((task: Task) => {
      // Ensure task has all required fields
      const completeTask: Task = {
        ...task,
        completed: false
      };
      
      taskQueue.push(completeTask);
      
      if (completeTask.type === 'feature') {
        featureTasks.set(completeTask.id, completeTask);
      }
    });
    
    console.log(`📊 Created ${tasks.length} tasks:`);
    tasks.forEach((task, i) => {
      console.log(`   ${i + 1}. [P${task.priority}] ${task.name} (${task.type})`);
    });
    console.log('');
    
    const newState = {
      ...state,
      taskQueue,
      featureTasks,
      completedTasks: [],
      _httpTaskId: state._httpTaskId  // ✅ Explicitly preserve taskId for next node
    };
    
    // ✅ CRITICAL: Save checkpoint immediately after decompose
    // This triggers file watcher → SSE broadcast → UI update
    if (state.deps?.session && state.context.featureFolder) {
      try {
        const { saveCheckpoint } = await import('./checkpoint');
        await saveCheckpoint(newState);
        console.log(`💾 [Decompose] Checkpoint saved (${taskQueue.size()} tasks)\n`);
      } catch (error) {
        console.warn(`⚠️  [Decompose] Failed to save checkpoint:`, error);
      }
    }
    
    // ✅ Update live task queue snapshot (Port or HTTP fallback for child process)
    if (state._httpTaskId) {
      const completedTasks = state.completedTasksDetails || [];
      const queueTasks = taskQueue.getAll();
      
      if (state.deps?.kanbanUpdate) {
        // In-process: use injected port
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpTaskId,
          null,
          queueTasks,
          completedTasks
        );
        console.log(`🎬 [Decompose] Task queue ready! Sent ${taskQueue.size()} tasks to Kanban board via PORT\n`);
      } else {
        // Child process: HTTP API fallback
        const serverPort = process.env.ANT_SERVER_PORT || '4100';
        fetch(`http://localhost:${serverPort}/api/internal/task-queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: state._httpTaskId,
            currentTask: null,
            queue: queueTasks,
            completedTasks: completedTasks
          })
        }).then(() => {
          console.log(`🎬 [Decompose] Task queue ready! Sent ${taskQueue.size()} tasks to Kanban board via HTTP\n`);
        }).catch(err => console.log(`⚠️  [Decompose] HTTP update failed:`, err.message));
      }
    } else {
      console.log(`⚠️  [Decompose] Live update SKIPPED - no taskId available\n`);
    }
    
    // ✅ Workflow instrumentation: Exit node
    if (state.deps?.workflowUpdate && state._httpTaskId) {
      state.deps.workflowUpdate.exitNode(state._httpTaskId, 'decompose');
    }
    
    return newState;
    
  } catch (error) {
    console.error('❌ Failed to decompose tasks:', error);
    
    // Fallback: create default task
    const taskQueue = new TaskQueue();
    const defaultTask: Task = {
      id: 'impl-fallback',
      name: 'Implement Requirements',
      type: 'feature',
      priority: 220,
      description: 'Implement based on specification',
      completed: false
    };
    
    taskQueue.push(defaultTask);
    
    const featureTasks = new Map<string, Task>();
    featureTasks.set(defaultTask.id, defaultTask);
    
    const newState = {
      ...state,
      taskQueue,
      featureTasks,
      completedTasks: [],
      _httpTaskId: state._httpTaskId  // ✅ Explicitly preserve taskId for next node
    };
    
    // ✅ Save checkpoint for fallback task
    if (state.deps?.session && state.context.featureFolder) {
      try {
        const { saveCheckpoint } = await import('./checkpoint');
        await saveCheckpoint(newState);
        console.log(`💾 [Decompose Error] Checkpoint saved (1 fallback task)\n`);
      } catch (saveError) {
        console.warn(`⚠️  [Decompose] Failed to save checkpoint:`, saveError);
      }
    }
    
    // ✅ Update live snapshot (Port or HTTP fallback)
    if (state._httpTaskId) {
      const completedTasks = state.completedTasksDetails || [];
      const queueTasks = taskQueue.getAll();
      
      if (state.deps?.kanbanUpdate) {
        // In-process: use injected port
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpTaskId,
          null,
          queueTasks,
          completedTasks
        );
        console.log(`🎬 [Decompose Error] Live snapshot updated via PORT (1 fallback task)\n`);
      } else {
        // Child process: HTTP API fallback
        const serverPort = process.env.ANT_SERVER_PORT || '4100';
        fetch(`http://localhost:${serverPort}/api/internal/task-queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: state._httpTaskId,
            currentTask: null,
            queue: queueTasks,
            completedTasks: completedTasks
          })
        }).then(() => {
          console.log(`🎬 [Decompose Error] Live snapshot updated via HTTP (1 fallback task)\n`);
        }).catch(err => console.log(`⚠️  [Decompose Error] HTTP update failed:`, err.message));
      }
    }
    
    // ✅ Workflow instrumentation: Exit node (error path)
    if (state.deps?.workflowUpdate && state._httpTaskId) {
      state.deps.workflowUpdate.exitNode(state._httpTaskId, 'decompose');
    }
    
    return newState;
  }
}

