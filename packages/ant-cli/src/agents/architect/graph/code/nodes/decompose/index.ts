import { LLMClient } from "../../../../../../core/ports";
import { ArchitectGraphState, Task, TaskQueue } from "../../state";
import { JobTimingManager } from "../../../common/timing/JobTimingManager";
import { extractErrorDetails, createErrorViolation, logErrorHeader } from "../shared/errorHandler";

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
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;
  
  // ✅ Workflow instrumentation: Enter node with LLM info
  if (state.deps?.workflowUpdate && state._httpJobId) {
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
    
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'decompose', taskInfo, llmInfo);
  }
  
  // ✅ CRITICAL: Load session FIRST to get completedTasksDetails before signaling
  let preloadedCompletedTasks: any[] = [];
  if (state.deps?.session) {
    try {
      const session = await state.deps.session.load(
        state.context.project,
        state.context.featureFolder || 'default',
        'code'  // ✅ Specify job type
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
        console.log('\n🔄 Resuming from previous code session...\n');
        
        // ✅ CRITICAL: Reload codebase from actual disk to detect file deletions
        const gitPort = state.deps?.git;
        let reloadedCode = state.code;
        let shouldResetAndDecompose = false;  // Flag to trigger decomposition
        
        if (gitPort) {
          console.log('📂 Checking codebase status for resume...');
          
          try {
            // ✅ SMART RELOAD: Only check file count for deletion detection
            // Don't load full codebase content - Plan node will do smart context loading
            const allFiles = await gitPort.listFiles('.', [
              'node_modules', '.git', 'dist', 'build', '.next', 'out', 
              'coverage', '.cache', '.turbo', '.vercel', '.netlify'
            ]);
            
            console.log(`   Found ${allFiles.length} files in codebase`);
            
            // ✅ Detect full project deletion (not partial edits)
            const hasCompletedTasks = session.state.completedTasks && session.state.completedTasks.length > 0;
            const hasNoFiles = allFiles.length === 0;
            
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
        
        // ✨ Handle jobId and jobTiming for Resume
        const existingJobId = session.state.jobId || state._httpJobId || 'unknown-job';
        const { jobId, jobTiming } = JobTimingManager.resumeJob(existingJobId, session.state.jobTiming);
        
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
        
        // ✅ Restore buffer from disk for interruption recovery
        try {
          const { StreamBufferManager } = await import('../../../../../../core/streaming/buffer/StreamBufferManager');
          const featurePath = state.context.workspaceResolver?.getFeaturePath(
            { userId: state.context.userId, organizationId: state.context.organizationId },
            state.context.project,
            state.context.featureFolder
          ) || state.context.featurePath || '';
          const projectPath = featurePath.replace(`/features/${state.context.featureFolder}`, '');
          const bufferManager = new StreamBufferManager(projectPath, state.context.featureFolder, 'code', jobId);
          
          const savedBuffers = bufferManager.loadBuffersFromDisk();
          if (savedBuffers.size > 0) {
            console.log(`\n🔄 [Resume] Loaded ${savedBuffers.size} buffer(s) from disk for recovery`);
            for (const [filePath, buffer] of savedBuffers) {
              console.log(`   📂 ${filePath}: ${buffer.content.length} chars (${buffer.actionType})`);
            }
          }
        } catch (error) {
          console.warn(`⚠️  [Resume] Failed to restore buffers (non-critical):`, error);
        }
        
        const resumedState = {
          ...state,
          jobId,  // ✨ Restore jobId
          jobTiming,  // ✨ Restore/update jobTiming
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
          directive: mergedDirective,  // ✅ Merged directives (newest first)
          overrideDirective: session.state.overrideDirective,  // ✅ Restore chat-initiated directive
          chatSource: session.state.chatSource,  // ✅ Restore chat source flag
          _httpJobId: state._httpJobId,  // ✅ Explicitly preserve jobId for next node
          interruption: undefined  // ✅ CRITICAL: Clear interruption when resuming (job is now running again)
        } as any;
        
        // ✅ Start/resume timing for currentTask if exists
        if (resumedState.currentTask) {
          const { TaskTimingHelper } = await import('../../state');
          if (!resumedState.currentTask.timing?.startedAt) {
            console.log(`⏱️  [Decompose Resume] Starting timer for resumed task: ${resumedState.currentTask.name}`);
            resumedState.currentTask = TaskTimingHelper.startTask(resumedState.currentTask);
          } else if (resumedState.currentTask.timing?.pausedAt) {
            console.log(`⏱️  [Decompose Resume] Resuming timer for task: ${resumedState.currentTask.name}`);
            resumedState.currentTask = TaskTimingHelper.startTask(resumedState.currentTask);
          } else {
            console.log(`⏱️  [Decompose Resume] Timer already running for task: ${resumedState.currentTask.name}`);
          }
        }
        
        // ✅ Update live snapshot for seamless UI transition (Port or HTTP fallback)
        if (state._httpJobId) {
          const completedTasks = resumedState.completedTasksDetails || [];
          const queueTasks = taskQueue.getAll();
          
          // ✅ CRITICAL: Get recursionCount and recursionLimit from resumed state
          const recursionCount = session.state.recursionCount || 0;
          const MIN_RECURSION_LIMIT = 5;
          const envLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
          const recursionLimit = (isNaN(envLimit) || envLimit < MIN_RECURSION_LIMIT) 
            ? MIN_RECURSION_LIMIT 
            : envLimit;
          
          if (state.deps?.kanbanUpdate) {
            // In-process: use injected port
            state.deps.kanbanUpdate.updateTaskQueue(
              state._httpJobId,
              resumedState.currentTask || null,  // ✅ Now includes timing info
              queueTasks,
              completedTasks,
              recursionCount,  // ✅ Pass recursion tracking
              recursionLimit   // ✅ Pass recursion limit
            );
            console.log(`🔄 [Decompose Resume] Live snapshot updated via PORT`);
            console.log(`   JobId: ${state._httpJobId}`);
            console.log(`   CurrentTask: ${resumedState.currentTask?.name || 'none'}`);
            console.log(`   Queue: ${taskQueue.size()} tasks`);
            console.log(`   Completed: ${completedTasks.length} tasks`);
            console.log(`   Recursion: ${recursionCount}/${recursionLimit}`);
            console.log(`   Live snapshot will be broadcast immediately by updateTaskQueue\n`);
          } else {
            // Child process: HTTP API fallback
            const serverPort = process.env.ANT_SERVER_PORT || '4100';
            fetch(`http://localhost:${serverPort}/api/internal/task-queue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId: state._httpJobId,
                currentTask: resumedState.currentTask || null,
                queue: queueTasks,
                completedTasks: completedTasks,
                recursionCount,
                recursionLimit
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
  
  // ✨ Initialize jobId and jobTiming for new job
  const { jobId: newJobId, jobTiming: newJobTiming, estimatingStartTime } = JobTimingManager.initializeNewJob(state._httpJobId!);
  
  
  // 💾 CRITICAL: Save jobTiming to session IMMEDIATELY so frontend can show timer during estimating
  if (state.deps?.session && state.context.featureFolder) {
    try {
      const { saveCheckpoint } = await import('../checkpoint');
      const tempState = {
        ...state,
        jobId: newJobId,
        jobTiming: newJobTiming,
        taskQueue: new TaskQueue(), // empty queue
        completedTasks: [],
        completedTasksDetails: preloadedCompletedTasks,
        overrideDirective: state.overrideDirective,  // ✅ Preserve chat directive
        chatSource: state.chatSource  // ✅ Preserve chat source flag
      } as any;
      await saveCheckpoint(tempState);
      console.log(`💾 [Code Decompose] Initial jobTiming saved to session\n`);
    } catch (error) {
      console.warn(`⚠️  [Code Decompose] Failed to save initial jobTiming:`, error);
    }
  }
  
  // ✅ NOW send "estimating started" signal with preloaded completed tasks
  if (state._httpJobId && state.deps?.kanbanUpdate) {
    console.log(`\n🎬 [Code Decompose] Signaling estimating started...`);
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
    
    // ✨ Calculate estimating duration (decompose completed)
    const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(newJobTiming, estimatingStartTime);
    
    const newState = {
      ...state,
      jobId: newJobId,  // ✨ Initialize jobId
      jobTiming: finalJobTiming,  // ✨ Initialize jobTiming with estimatingDuration
      taskQueue,
      featureTasks,
      completedTasks: [],
      overrideDirective: state.overrideDirective,  // ✅ Preserve chat directive
      chatSource: state.chatSource,  // ✅ Preserve chat source flag
      _httpJobId: state._httpJobId  // ✅ Explicitly preserve taskId for next node
    };
    
    // ✅ Save checkpoint for default task
    if (state.deps?.session && state.context.featureFolder) {
      try {
        const { saveCheckpoint } = await import('../checkpoint');
        await saveCheckpoint(newState);
        console.log(`💾 [Decompose Default] Checkpoint saved (1 default task)\n`);
      } catch (error) {
        console.warn(`⚠️  [Decompose] Failed to save checkpoint:`, error);
      }
    }
    
    // ✅ Update live snapshot (Port or HTTP fallback)
    if (state._httpJobId) {
      const completedTasks = state.completedTasksDetails || [];
      const queueTasks = taskQueue.getAll();
      
      if (state.deps?.kanbanUpdate) {
        // In-process: use injected port
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpJobId,
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
            taskId: state._httpJobId,
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
  const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
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
    console.log('\n📝 Analyzing specification and breaking down tasks...\n');
    
    // ✅ Get ChatAPIClient for UI feedback
    const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
    const chatAPI = getChatAPIClient();
    
    if (!llm.stream) {
      throw new Error('LLM client does not support streaming');
    }
    
    // 🎯 Show placeholder before LLM call
    await chatAPI.showChatStatus('placeholder');
    
    // ✅ NEW: Direct streaming (no XML parsing!)
    let raw = '';
    for await (const event of llm.stream([{ role: 'user', content: prompt }])) {
      // Thinking
      if (event.type === 'thinking') {
        await chatAPI.sendLLMEvent(event);
      }
      
      // Text
      if (event.type === 'text') {
        raw += event.text || '';  // ✅ NEW: text 필드 사용
        await chatAPI.sendLLMEvent(event);
      }
      
      // Done
      if (event.type === 'done') {
        await chatAPI.sendLLMEvent(event);
      }
    }
    
    // ✅ Extract JSON from <tasks> tags (more reliable than parsing freeform text)
    let tasks: Task[] = [];
    const tasksMatch = raw.match(/<tasks>\s*([\s\S]*?)\s*<\/tasks>/);
    
    if (tasksMatch && tasksMatch[1]) {
      try {
        const jsonText = tasksMatch[1].trim();
        const parsed = JSON.parse(jsonText);
        tasks = parsed.tasks || [];
        console.log(`✅ Parsed ${tasks.length} tasks from LLM response\n`);
      } catch (parseError) {
        console.error('❌ Failed to parse task JSON from <tasks> tags:', parseError);
        console.error('JSON text:', tasksMatch[1].substring(0, 500));
      }
    } else {
      // Fallback: Try to find JSON in raw response (for backward compatibility)
      console.log('⚠️  No <tasks> tags found, trying fallback JSON extraction...\n');
      
      // Remove thinking tags
      let jsonText = raw.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
      
      // Try to find JSON object
      const jsonMatch = jsonText.match(/\{[\s\S]*"tasks"[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0] + '}');
          tasks = parsed.tasks || [];
          console.log(`✅ Parsed ${tasks.length} tasks from fallback extraction\n`);
        } catch (parseError) {
          console.error('❌ Fallback JSON parsing also failed:', parseError);
        }
      }
    }
    
    if (tasks.length === 0) {
      console.log('⚠️  Could not extract tasks from LLM response');
      console.log('Raw response preview:', raw.substring(0, 300), '...');
      console.log('Creating default task as fallback...\n');
      
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
      
      // ✨ Calculate estimating duration (decompose completed)
      const estimatingEndTime = Date.now();
      const estimatingDuration = estimatingEndTime - new Date(estimatingStartTime).getTime();
      const finalJobTiming = {
        ...newJobTiming,
        estimatingDuration
      };
      console.log(`⏰ [Estimating Complete] Duration: ${Math.round(estimatingDuration / 1000)}s\n`);
      
      const newState = {
        ...state,
        jobId: newJobId,  // ✨ Initialize jobId
        jobTiming: finalJobTiming,  // ✨ Initialize jobTiming with estimatingDuration
        taskQueue,
        featureTasks,
        completedTasks: [],
        overrideDirective: state.overrideDirective,  // ✅ Preserve chat directive
        chatSource: state.chatSource,  // ✅ Preserve chat source flag
        _httpJobId: state._httpJobId  // ✅ Explicitly preserve taskId for next node
      };
      
      // ✅ Save checkpoint for default task
      if (state.deps?.session && state.context.featureFolder) {
        try {
          const { saveCheckpoint } = await import('../checkpoint');
          await saveCheckpoint(newState);
          console.log(`💾 [Decompose EmptyResult] Checkpoint saved (1 default task)\n`);
        } catch (error) {
          console.warn(`⚠️  [Decompose] Failed to save checkpoint:`, error);
        }
      }
      
      // ✅ Update live snapshot (Port or HTTP fallback)
      if (state._httpJobId) {
        const completedTasks = state.completedTasksDetails || [];
        const queueTasks = taskQueue.getAll();
        
        if (state.deps?.kanbanUpdate) {
          // In-process: use injected port
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpJobId,
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
              taskId: state._httpJobId,
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
    
    // ✨ Calculate estimating duration (decompose completed)
    const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(newJobTiming, estimatingStartTime);
    
    const newState = {
      ...state,
      jobId: newJobId,  // ✨ Initialize jobId
      jobTiming: finalJobTiming,  // ✨ Initialize jobTiming with estimatingDuration
      taskQueue,
      featureTasks,
      completedTasks: [],
      overrideDirective: state.overrideDirective,  // ✅ Preserve chat directive
      chatSource: state.chatSource,  // ✅ Preserve chat source flag
      _httpJobId: state._httpJobId  // ✅ Explicitly preserve taskId for next node
    };
    
    // ✅ CRITICAL: Save checkpoint immediately after decompose
    // This triggers file watcher → SSE broadcast → UI update
    if (state.deps?.session && state.context.featureFolder) {
      try {
        const { saveCheckpoint } = await import('../checkpoint');
        await saveCheckpoint(newState);
        console.log(`💾 [Decompose] Checkpoint saved (${taskQueue.size()} tasks)\n`);
      } catch (error) {
        console.warn(`⚠️  [Decompose] Failed to save checkpoint:`, error);
      }
    }
    
    // ✅ Update live task queue snapshot (Port or HTTP fallback for child process)
    if (state._httpJobId) {
      const completedTasks = state.completedTasksDetails || [];
      const queueTasks = taskQueue.getAll();
      
      if (state.deps?.kanbanUpdate) {
        // In-process: use injected port
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpJobId,
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
            taskId: state._httpJobId,
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
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose');
    }
    
    return newState;
    
  } catch (error) {
    logErrorHeader('Decompose');
    
    // Extract detailed error information
    const errorDetails = extractErrorDetails(error);
    console.error('❌ Failed to decompose tasks:', errorDetails.message);
    
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
    
    // ✨ Calculate estimating duration (decompose completed)
    const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(newJobTiming, estimatingStartTime);
    
    const newState = {
      ...state,
      jobId: newJobId,  // ✨ Initialize jobId
      jobTiming: finalJobTiming,  // ✨ Initialize jobTiming with estimatingDuration
      taskQueue,
      featureTasks,
      completedTasks: [],
      overrideDirective: state.overrideDirective,  // ✅ Preserve chat directive
      chatSource: state.chatSource,  // ✅ Preserve chat source flag
      _httpJobId: state._httpJobId  // ✅ Explicitly preserve taskId for next node
    };
    
    // ✅ Save checkpoint for fallback task
    if (state.deps?.session && state.context.featureFolder) {
      try {
        const { saveCheckpoint } = await import('../checkpoint');
        await saveCheckpoint(newState);
        console.log(`💾 [Decompose Error] Checkpoint saved (1 fallback task)\n`);
      } catch (saveError) {
        console.warn(`⚠️  [Decompose] Failed to save checkpoint:`, saveError);
      }
    }
    
    // ✅ Update live snapshot (Port or HTTP fallback)
    if (state._httpJobId) {
      const completedTasks = state.completedTasksDetails || [];
      const queueTasks = taskQueue.getAll();
      
      if (state.deps?.kanbanUpdate) {
        // In-process: use injected port
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpJobId,
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
            taskId: state._httpJobId,
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
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose');
    }
    
    return newState;
  }
}

