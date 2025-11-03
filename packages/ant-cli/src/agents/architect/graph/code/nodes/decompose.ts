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
  
  // ✅ RESUME: Check if we have previous state to restore
  if (state.deps?.session) {
    try {
      const session = await state.deps.session.load(
        state.context.project,
        state.context.featureFolder || 'default'
      );
      
      if (session.state && session.state.taskQueue && session.state.taskQueue.length > 0) {
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
        
        // Calculate task type breakdown
        const tasksByType = {
          setup: 0,
          feature: 0,
          error: 0,
          final: 0
        };
        
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
        
        const completedCount = session.state.completedTasks?.length || 0;
        const totalTasks = completedCount + taskQueue.size();
        
        console.log(`📊 Resuming existing project:`);
        console.log(`   Progress: ${completedCount}/${totalTasks} tasks (${Math.round(completedCount / totalTasks * 100)}%)`);
        console.log(`   `);
        console.log(`   Setup:   ${tasksByType.setup === 0 ? '✅' : '⬜'} ${tasksByType.setup} remaining`);
        console.log(`   Feature: ${tasksByType.feature === 0 ? '✅' : '⬜'} ${tasksByType.feature} remaining`);
        console.log(`   Error:   ${tasksByType.error === 0 ? '✅' : '⚠️ '} ${tasksByType.error} remaining`);
        console.log(`   Final:   ${tasksByType.final === 0 ? '✅' : '⬜'} ${tasksByType.final} remaining`);
        console.log(``);
        
        return {
          ...state,
          taskQueue,
          featureTasks,
          completedTasks: session.state.completedTasks || [],
          retries: session.state.retries || 0,
          maxRetries: session.state.maxRetries || 3,
          previousAttempts: session.state.previousAttempts || [],
          enforcementHistory: session.state.enforcementHistory || [],
          lastViolations: session.state.lastViolations || [],
          previousFileCount: session.state.previousFileCount,
          resolvedCategories: (session.state.resolvedCategories || []) as any,
        };
        }  // End of else block (normal resume)
      }  // End of if (session.state && taskQueue)
    } catch (error) {
      console.log('⚠️  Could not load previous session state, starting fresh');
    }
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
    
    return {
      ...state,
      taskQueue,
      featureTasks,
      completedTasks: []
    };
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
      
      return {
        ...state,
        taskQueue,
        featureTasks,
        completedTasks: []
      };
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
    
    return {
      ...state,
      taskQueue,
      featureTasks,
      completedTasks: []
    };
    
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
    
    return {
      ...state,
      taskQueue,
      featureTasks,
      completedTasks: []
    };
  }
}

