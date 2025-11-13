import { DesignGraphState } from "../../state";
import { LLMClient } from "../../../../../../core/ports";
import { PromptEngine } from "../../../../../../core/prompt/engine";

/**
 * Merge incremental design changes into existing document
 * 
 * Strategy: Section-level merging
 * - Parse both documents into sections (by markdown headers)
 * - For each section in the incremental update:
 *   - If it's marked as (UPDATED) or (NEW), replace/append in the existing doc
 *   - Otherwise, append as new content
 * - Preserve all existing sections that weren't updated
 */
function mergeDesignDocuments(existingDoc: string, incrementalChanges: string): string {
  // Simple but effective approach:
  // 1. Keep the entire existing document
  // 2. Append incremental changes with a clear separator
  // 3. Let the user manually consolidate if needed, or improve this logic later
  
  // Check if incrementalChanges looks like a full document (starts with # and has multiple major sections)
  const hasMultipleMajorSections = (incrementalChanges.match(/^#\s+/gm) || []).length >= 2;
  
  if (hasMultipleMajorSections && incrementalChanges.length > existingDoc.length * 0.8) {
    // LLM returned what looks like a full document (disobeyed instructions)
    // Use it as-is but warn
    console.warn('⚠️  Warning: LLM returned a full document instead of incremental changes. Using new version.');
    return incrementalChanges;
  }
  
  // Incremental update: append with separator
  const separator = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  return existingDoc.trimEnd() + separator + incrementalChanges.trimStart();
}

/**
 * Execute Node
 * Generate design document based on plan
 */
export async function execute(state: DesignGraphState) {
  // ✅ DEBUG: Check timing at node entry
  let currentTask = state.currentTask;
  console.log(`\n🔍 [Design Execute] Node entry:`);
  console.log(`   currentTask: ${currentTask?.name}`);
  console.log(`   Has timing: ${!!currentTask?.timing}`);
  console.log(`   timing.startedAt: ${currentTask?.timing?.startedAt}\n`);
  
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = currentTask ? {
      id: currentTask.id,
      name: currentTask.name,
      type: currentTask.type,
      description: currentTask.description,
      priority: currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpTaskId, 'execute', taskInfo);
  }
  
  // ✅ Update Kanban snapshot with timing info
  if (state._httpTaskId && currentTask && state.deps?.kanbanUpdate) {
    console.log(`\n🔥 [Design Execute] Updating Kanban with timing info`);
    console.log(`   Current: ${currentTask.name}`);
    console.log(`   Remaining in queue: ${state.taskQueue?.size() || 0}\n`);
    
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpTaskId,
      currentTask,  // ✅ With timing info
      state.taskQueue?.getAll() || [],
      state.completedTasksDetails || []
    );
  }
  
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  // ✅ Use in-memory planText (no need to read from file)
  // planText was generated in the plan node and passed through state
  const strategyContent = state.planText;

  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: state.designMarkdown || undefined,  // ✅ Pass accumulated design from previous tasks
    prdSpec: state.prd,               // PRD
    previousDesign: state.design,     // Previous design (from git)
    currentCode: state.code,          // Codebase (for evolution/refactor)
    originalFiles: undefined,         // Design doesn't use git HEAD
    currentTask: state.currentTask ? {  // ✅ Pass current task info
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description
    } : undefined
  };

  // Build prompt using PromptEngine with strategy content
  const result = await engine.buildExecutePrompt(
    "design",
    state.context,
    artifacts,
    strategyContent  // ✅ Use loaded strategy content
  );

  // Generate design with streaming
  let designMarkdown = '';
  
  console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
  
  // ✅ Check if this is a continuation task
  const isFirstTask = !state.designMarkdown;
  if (isFirstTask) {
    console.log('\n📐 Generating initial design document...\n');
  } else {
    console.log('\n📐 Updating design document (incremental task)...\n');
  }
  
  // ✅ Get ChatAPIClient for file operations
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  const filePath = 'outputs/design/system-design.md';
  
  // ✅ Start message if not already started
  if (chatAPI.isEnabled()) {
    // ✅ Start file operation in WRITING state (in the SAME message)
    if (isFirstTask) {
      // Start with 'writing' phase so LLM text streams directly into the file card
      await chatAPI.streamFileContent(filePath, '');
    } else {
      // For edit: start with 'updating' phase
      // TODO: Add proper method to ChatAPIClient for this
      await chatAPI.startFileEdit(filePath);
    }
  }
  
  // ✅ 3. Stream LLM response with real-time XML parsing
  console.log('\n💭 Streaming design document...\n');
  
  if (!llm.streamRaw) {
    throw new Error('LLM client does not support streaming');
  }
  
  // ✅ Use StreamOrchestrator but collect text content separately for design document
  const { StreamOrchestrator, XMLStreamParser, CommonRenderStrategy } = await import('../../../../../../core/streaming');
  
  const orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: new CommonRenderStrategy(chatAPI),
    existingFiles: new Set([]) // Design phase doesn't generate code files
  });
  
  // 🎯 Show placeholder before LLM call
  await chatAPI.showChatStatus('placeholder');
  
  // Stream LLM response with real-time XML parsing
  for await (const event of llm.streamRaw(result.formatted.messages)) {
    await orchestrator.processEvent(event);
  }
  
  const streamResult = await orchestrator.finalize();
  const raw = streamResult.raw;
  
  // Extract design content (everything outside thinking tags)
  // The raw response contains both thinking and response text, but we only want response
  let designContent = raw;
  
  // Remove thinking sections from raw content
  designContent = designContent.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
  
  designMarkdown = designContent;
  console.log('\n');
  
  // ✅ Merge with previous designMarkdown if this is a continuation task
  let finalDesignMarkdown: string;
  
  if (isFirstTask) {
    // First task: use LLM response as-is (full document)
    finalDesignMarkdown = designMarkdown;
  } else {
    // Continuation task: LLM returns only changes, merge with existing
    console.log('\n🔀 Merging incremental changes with existing document...\n');
    finalDesignMarkdown = mergeDesignDocuments(state.designMarkdown!, designMarkdown);
  }

  // ✅ Complete file operation (transition to collapsible state)
  if (isFirstTask) {
    // Complete file creation
    await chatAPI.completeFileCreation(filePath, finalDesignMarkdown);
  } else {
    // Complete file edit with diff
    await chatAPI.completeFileEdit(filePath, state.designMarkdown || '', finalDesignMarkdown);
  }

  // ✅ DON'T mark task as completed here - checkTaskStatus node handles completion
  // This prevents duplicate entries in completedTasksDetails
  // This ensures Kanban updates happen AFTER all workflow nodes are processed

  // ✅ DEBUG: Verify timing before return
  console.log(`\n🔍 [Design Execute] About to return state:`);
  console.log(`   currentTask: ${currentTask?.name}`);
  console.log(`   Has timing: ${!!currentTask?.timing}`);
  console.log(`   timing.startedAt: ${currentTask?.timing?.startedAt}\n`);

  return { 
    ...state,
    currentTask,  // ✅ Explicitly include currentTask with timing
    designMarkdown: finalDesignMarkdown,  // ✅ Use merged/updated markdown
    // Keep currentTask - checkTaskStatus will handle completion and clear it
  };
}
