import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Plan Node
 * Generate design plan based on artifacts
 */
export async function plan(state: DesignGraphState) {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  // ✅ CRITICAL: Get next task BEFORE enterNode
  // This ensures enterNode is called with correct taskInfo
  let currentTask = state.currentTask;
  
  if (state.taskQueue && !currentTask) {
    const nextTask = state.taskQueue.pop();
    if (nextTask) {
      currentTask = nextTask;
      console.log(`\n📋 Processing task: "${nextTask.name}"`);
      console.log(`   Priority: ${nextTask.priority}`);
      console.log(`   Description: ${nextTask.description}\n`);
      
      // ✨ Start timing for the task
      const { TaskTimingHelper } = await import('../../code/state');
      console.log(`⏱️  Starting timer for task: ${currentTask.name}`);
      currentTask = TaskTimingHelper.startTask(currentTask);
      
      // ✅ CRITICAL: Update Kanban snapshot when task starts
      if (state._httpJobId && state.deps?.kanbanUpdate) {
        console.log(`\n🔥 [Plan] Updating Kanban → task started`);
        console.log(`   Current: ${currentTask.name}`);
        console.log(`   Remaining in queue: ${state.taskQueue.size()}\n`);
        
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpJobId,
          currentTask,                    // ✅ Show current task as in-progress
          state.taskQueue.getAll(),      // ✅ Remaining queue
          state.completedTasksDetails || []
        );
      }
    } else {
      console.log('⚠️  No task to execute');
      return state;
    }
  }
  
  // ✅ Workflow instrumentation: Enter node AFTER currentTask is set
  // ✅ CRITICAL: await to ensure workflow SSE is sent before continuing
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = currentTask ? {
      id: currentTask.id,
      name: currentTask.name,
      type: currentTask.type,
      description: currentTask.description,
      priority: currentTask.priority
    } : undefined;
    
    // ✅ Extract LLM info from GenericLLMClient
    const llmInfo = (llm as any)?.provider && (llm as any)?.modelName ? {
      provider: (llm as any).provider,
      model: (llm as any).modelName
    } : undefined;
    
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'plan', taskInfo, llmInfo);
  }

  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: state.designMarkdown || undefined,  // ✅ Pass accumulated design for continuation detection
    prdSpec: state.prd,               // PRD
    previousDesign: state.design,     // Previous design (for evolution/refactor)
    currentCode: state.code,          // Codebase (for evolution/refactor)
    originalFiles: undefined,         // Design doesn't use git HEAD
    currentTask: currentTask ? {      // ✅ Pass current task info to plan prompt
      name: currentTask.name,
      type: currentTask.type,
      description: currentTask.description
    } : undefined
  };

  // Build prompt using PromptEngine
  const result = await engine.buildPlanPrompt(
    "design",
    state.context,
    artifacts
  );

  // Generate plan with streaming and Chat integration
  let planText = '';
  
  console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
  console.log(`🎯 Design mode: ${state.designMode || 'auto'}`);
  console.log('\n📝 Generating design strategy...\n');
  
  // ✅ Get ChatAPIClient
  const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  // ✅ Use StreamOrchestrator for consistent XML parsing
  const { StreamOrchestrator, XMLStreamParser, CommonRenderStrategy } = await import('../../../../../core/streaming');
  
  if (!llm.streamRaw) {
    throw new Error('LLM client does not support streaming');
  }
  
  const orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: new CommonRenderStrategy(chatAPI),
    existingFiles: new Set([]) // Design plan phase doesn't generate files
  });
  
  // 🎯 Show placeholder before LLM call
  await chatAPI.showChatStatus('placeholder');
  
  // Stream LLM response with real-time XML parsing (will replace placeholder)
  for await (const event of llm.streamRaw(result.formatted.messages)) {
    await orchestrator.processEvent(event);
  }
  
  const streamResult = await orchestrator.finalize();
  planText = streamResult.raw;
  console.log('\n');

  // ✅ DEBUG: Verify timing before return
  console.log(`\n🔍 [Design Plan] About to return state:`);
  console.log(`   currentTask: ${currentTask?.name}`);
  console.log(`   Has timing: ${!!currentTask?.timing}`);
  console.log(`   timing.startedAt: ${currentTask?.timing?.startedAt}\n`);

  // ✅ planText를 메모리(state)에 저장하여 execute 노드에서 직접 사용
  return { ...state, planText, currentTask };
}
