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
 * 
 * ✅ NEW: UI Design mode (designWorkType === 'ui-design')
 * - Requires reference images in inputs/references/
 * - Creates tasks for ui-tokens.json, ui-assets.json, ui-spec.json generation
 */
export async function decompose(state: DesignGraphState): Promise<DesignGraphState> {
  // ✅ NEW: Validate UI design prerequisites
  if (state.designWorkType === 'ui-design') {
    const hasReferences = state.uiReferences?.screens?.length || state.uiReferences?.components?.length;
    const hasAssets = state.uiAssetsList?.logos?.length || 
                      state.uiAssetsList?.backgrounds?.length || 
                      state.uiAssetsList?.icons?.length || 
                      state.uiAssetsList?.other?.length;
    
    if (!hasReferences && !hasAssets) {
      throw new Error(
        "UI 문서 생성에 필요한 입력 파일이 없습니다.\n\n" +
        "필수 입력:\n" +
        "- inputs/references/screens/ - 피그마 화면 캡처 이미지\n" +
        "- inputs/references/components/ - 컴포넌트 상태 스냅샷 (선택)\n" +
        "- inputs/assets/ - 런타임 에셋 파일들 (선택)\n\n" +
        "위 폴더에 최소 하나 이상의 이미지/에셋 파일을 추가해주세요."
      );
    }
    
    // ✅ At minimum, we need reference images for UI spec generation
    if (!hasReferences) {
      throw new Error(
        "UI 문서 생성을 위한 레퍼런스 이미지가 없습니다.\n\n" +
        "inputs/references/screens/ 폴더에 피그마 화면 캡처 이미지를 추가해주세요.\n" +
        "- 스크린샷은 화면 레이아웃, 색상, 타이포그래피 분석에 사용됩니다.\n" +
        "- 가능하면 다양한 해상도/상태의 스크린샷을 포함해주세요."
      );
    }
  }
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
          tokenUsage: session.state.tokenUsage,  // ✅ CRITICAL: Restore job-level token usage
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
  
  // ✅ NEW: UI Design mode - LLM-driven task decomposition (like System Design)
  if (state.designWorkType === 'ui-design') {
    console.log('🎨 UI Design mode - analyzing UI complexity for task decomposition\n');
    
    // Prepare UI context for LLM analysis
    const uiContextParts = [
      state.prd ? `PRD:\n${state.prd}` : null,
      state.directive ? `DIRECTIVE:\n${state.directive}` : null,
    ].filter(Boolean);
    
    const uiContext = uiContextParts.length > 0 ? uiContextParts.join('\n\n---\n\n') : '';
    
    // ✅ Use FilePromptAdapter for ui-design decompose template
    const FilePromptAdapter = await import('../../../../../../periphery/adapters/prompt/FilePromptAdapter');
    const promptAdapter = new FilePromptAdapter.FilePromptAdapter();
    
    const uiDecomposePrompt = await promptAdapter.render('design/phases/decompose/base-ui-design', {
      uiContext,
      screenCount: state.uiReferences?.screens?.length || 0,
      componentCount: state.uiReferences?.components?.length || 0,
      assetCount: (state.uiAssetsList?.logos?.length || 0) + 
                  (state.uiAssetsList?.icons?.length || 0) + 
                  (state.uiAssetsList?.backgrounds?.length || 0),
    });
    
    try {
      console.log('🤖 Analyzing UI requirements...\n');
      
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
      
      // Call LLM for UI task decomposition
      // ✅ IMPORTANT: Use invoke (not generateObject) to get token usage
      const result = await llmToUse.invokeWithUsage?.(
        [{ role: 'user', content: uiDecomposePrompt }],
        { temperature: 0.2, maxTokens: 8000 }
      );
      const textResponse = result?.content || await llmToUse.invoke([{ role: 'user', content: uiDecomposePrompt }]);
      
      // ✅ Track token usage
      if (result?.usage) {
        const { accumulateTokenUsage } = await import('../../../common/llmHelpers');
        accumulateTokenUsage(state as any, result.usage, { taskLevel: false, jobLevel: true });
        console.log(`   Tokens: ${result.usage.totalTokens} total (${result.usage.inputTokens} in, ${result.usage.outputTokens} out)`);
      } else {
        console.log(`   ⚠️  Token usage not available (invokeWithUsage not supported by client)`);
      }
      
      // Parse JSON (support raw JSON, ```json fenced, or embedded object)
      const trimmed = (textResponse || '').trim();
      let parsedResponse: any | undefined;
      try {
        parsedResponse = JSON.parse(trimmed);
      } catch {
        const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
        const candidate = fenced?.[1] || trimmed.match(/\{[\s\S]*"tasks"[\s\S]*\}/)?.[0];
        if (!candidate) {
          throw new Error('Could not parse UI task breakdown from LLM response');
        }
        parsedResponse = JSON.parse(candidate);
      }
      
      // Validate response format (strategy is optional, defaults to chapter-based)
      const response: {
        strategy?: string;
        targetFiles: string[];
        tasks: Array<{
          id: string;
          name: string;
          targetFile: string;
          description: string;
          priority: number;
        }>;
      } = parsedResponse;
      
      if (!response.targetFiles || !response.tasks) {
        throw new Error('Invalid UI task breakdown format from LLM');
      }
      
      const strategy = response.strategy || 'chapter-based';
      
      const taskQueue = new TaskQueue<DesignTask>();
      
      response.tasks.forEach((task) => {
        taskQueue.push({
          id: task.id,
          name: task.name,
          type: 'feature',
          priority: task.priority,
          description: task.description,
          completed: false,
          ui: true,
          targetFile: task.targetFile,
        } as DesignTask);
      });
      
      console.log(`✅ LLM decomposed UI work into ${taskQueue.size()} tasks (${strategy} strategy):`);
      taskQueue.getAll().forEach((t, i) => {
        console.log(`   ${i + 1}. ${t.name} → ${t.targetFile} (priority: ${t.priority})`);
      });
      console.log();
      
      // Mark estimating phase complete
      const finalJobTiming = JobTimingManager.finalizeEstimatingPhase(newJobTiming, newJobTiming.startedAt);
      
      const uiDocsState: DesignGraphState = {
        ...state,
        taskQueue,
        completedTasks: [],
        completedTasksDetails: preloadedCompletedTasks,
        _httpJobId: state._httpJobId,
        jobId: newJobId,
        jobTiming: finalJobTiming,
      };
      
      // Update Kanban
      if (state._httpJobId && state.deps?.kanbanUpdate) {
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpJobId,
          null,
          taskQueue.getAll(),
          preloadedCompletedTasks
        );
        console.log(`✅ Kanban updated with ${taskQueue.size()} UI doc tasks\n`);
      }
      
      // Workflow exit
      if (state.deps?.workflowUpdate && state._httpJobId) {
        state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose');
      }
      
      return uiDocsState;
      
    } catch (error: any) {
      logErrorHeader('decompose');
      console.error(error);
      throw error;
    }
  }
  
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
  const prompt = await promptAdapter.render('design/phases/decompose/base-system-design', {
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
    
    // ✅ IMPORTANT:
    // We intentionally avoid invokeStructured here because it cannot provide token usage
    // for some providers (notably Anthropic). Estimating token usage must include decompose.
    const result = await llmToUse.invokeWithUsage?.(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, maxTokens: 16000 }
    );
    const textResponse = result?.content || await llmToUse.invoke([{ role: 'user', content: prompt }]);
    
    // ✅ Track token usage (job-level only; decompose runs before tasks start)
    if (result?.usage) {
      const { accumulateTokenUsage } = await import('../../../common/llmHelpers');
      accumulateTokenUsage(state as any, result.usage, { taskLevel: false, jobLevel: true });
      console.log(`   Tokens: ${result.usage.totalTokens} total (${result.usage.inputTokens} in, ${result.usage.outputTokens} out)`);
    } else {
      console.log(`   ⚠️  Token usage not available (invokeWithUsage not supported by client)`);
    }
    
    // Parse JSON (support raw JSON, ```json fenced, or embedded object)
    const trimmed = (textResponse || '').trim();
    let parsedResponse: any | undefined;
    try {
      parsedResponse = JSON.parse(trimmed);
    } catch {
      const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
      const candidate = fenced?.[1] || trimmed.match(/\{[\s\S]*"tasks"[\s\S]*\}/)?.[0];
      if (!candidate) {
        throw new Error('Could not parse task breakdown from LLM response');
      }
      parsedResponse = JSON.parse(candidate);
    }
    
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
    
    // ✅ Enforce naming policy for consistency:
    // - frontend-only or backend-only → ALWAYS `system-design.md`
    // - fullstack → ALWAYS contract-first split docs
    const detectedEnv = state.designEnvironment;
    if (detectedEnv === 'frontend' || detectedEnv === 'backend') {
      response.documentType = 'unified';
      response.targetFiles = ['system-design.md'];
      response.tasks = response.tasks.map(t => ({ ...t, targetFile: 'system-design.md' }));
    } else if (detectedEnv === 'fullstack') {
      response.documentType = 'contract-first';
      response.targetFiles = ['api-contract.md', 'fe-system-design.md', 'be-system-design.md'];
      
      const hasRequiredTargets = (targets: string[]) =>
        targets.includes('api-contract.md') &&
        targets.includes('fe-system-design.md') &&
        targets.includes('be-system-design.md');
      
      const taskTargets = response.tasks.map(t => t.targetFile);
      if (!hasRequiredTargets(taskTargets) || response.tasks.length < 3) {
        // If the LLM didn't split tasks properly, create a deterministic 3-task breakdown.
        // Keep it concise (line budgets are handled in execute phase; decompose only sets structure).
        response.tasks = [
          {
            id: 'design-api-contract',
            name: 'Design Document: API Contract',
            targetFile: 'api-contract.md',
            priority: 200,
            description: 'Define FE↔BE API contract (endpoints/events, DTOs, error format, auth if any). MAX 120 lines total!'
          },
          {
            id: 'design-fe',
            name: 'Design Document: Frontend System Design',
            targetFile: 'fe-system-design.md',
            priority: 220,
            description: 'Design frontend architecture consuming api-contract.md (components, routing, state, loading/error UX, API integration). MAX 180 lines total!'
          },
          {
            id: 'design-be',
            name: 'Design Document: Backend System Design',
            targetFile: 'be-system-design.md',
            priority: 240,
            description: 'Design backend architecture implementing api-contract.md (layers, endpoints, storage, validation, error handling). MAX 180 lines total!'
          }
        ];
      } else {
        // Normalize task targetFile to one of the contract-first files.
        response.tasks = response.tasks.map(t => ({
          ...t,
          targetFile: response.targetFiles.includes(t.targetFile) ? t.targetFile : 'api-contract.md'
        }));
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
    
    // ✅ CRITICAL: Reset task-level token usage for first task
    const { resetTaskTokenUsage } = await import('../../../common/llmHelpers');
    resetTaskTokenUsage(state as any);
    console.log(`🔄 [Design Decompose] Reset task-level token usage for first task`);
    
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
              currentTask: {
                ...currentTask,
                tokenUsage: (state as any)._currentTaskTokenUsage || currentTask.tokenUsage  // ✅ Real-time token usage
              },
              completedTasks: [],
              completedTasksDetails: [],
              jobId: newJobId,
              jobTiming: finalJobTiming,
              tokenUsage: (state as any).tokenUsage  // ✅ Save job-level token usage from decompose
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

