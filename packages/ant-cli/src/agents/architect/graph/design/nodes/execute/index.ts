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
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = currentTask ? {
      id: currentTask.id,
      name: currentTask.name,
      type: currentTask.type,
      description: currentTask.description,
      priority: currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'execute', taskInfo);
  }
  
  // ✅ Update Kanban snapshot with timing info
  if (state._httpJobId && currentTask && state.deps?.kanbanUpdate) {
    console.log(`\n🔥 [Design Execute] Updating Kanban with timing info`);
    console.log(`   Current: ${currentTask.name}`);
    console.log(`   Remaining in queue: ${state.taskQueue?.size() || 0}\n`);
    
    state.deps.kanbanUpdate.updateTaskQueue(
      state._httpJobId,
      currentTask,  // ✅ With timing info
      state.taskQueue?.getAll() || [],
      state.completedTasksDetails || []
    );
  }
  
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  // ✅ Get accumulated design from previous tasks (files[])
  const primaryDesign = state.files?.find(f => 
    f.path.includes('system-design') || f.path.includes('design.md')
  );

  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: primaryDesign?.content,  // ✅ Pass accumulated design from previous tasks
    prdSpec: state.prd,               // PRD
    previousDesign: state.design,     // Previous design (from git)
    currentCode: state.code,          // Codebase (for evolution/refactor)
    originalFiles: undefined,         // Design doesn't use git HEAD
    currentTask: state.currentTask ? {  // ✅ Pass current task info
      name: state.currentTask.name,
      type: state.currentTask.type,
      priority: state.currentTask.priority,
      description: state.currentTask.description
    } : undefined
  };

  const result = await engine.buildExecutePrompt(
    "design",
    state.context,
    artifacts
  );

  // Generate design with streaming
  console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
  
  // ✅ Check if this is a continuation task
  const isFirstTask = !primaryDesign;
  if (isFirstTask) {
    console.log('\n📐 Generating initial design document...\n');
  } else {
    console.log('\n📐 Updating design document (incremental task)...\n');
  }
  
  // ✅ Get ChatAPIClient
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  // ✅ 3. Stream LLM response with real-time XML parsing
  console.log('\n💭 Streaming design document...\n');
  
  if (!llm.stream) {
    throw new Error('LLM client does not support streaming');
  }
  
  // ✅ Use StreamOrchestrator but collect text content separately for design document
  const { StreamOrchestrator, XMLStreamParser, CommonRenderStrategy } = await import('../../../../../../core/streaming');
  const { StreamBufferManager } = await import('../../../../../../core/streaming/buffer/StreamBufferManager');
  
  // ✅ Initialize buffer manager for interruption safety
  const featurePath = state.deps?.workspaceResolver?.getFeaturePath(
    { userId: state.context.userId || 'local', organizationId: state.context.organizationId || 'local', workspacePath: '' },
    state.context.project,
    state.context.featureFolder
  ) || state.context.featurePath || '';
  
  const projectPath = featurePath.replace(`/features/${state.context.featureFolder}`, '');
  const jobId = state._httpJobId || `design-${Date.now()}`;
  const bufferManager = new StreamBufferManager(projectPath, state.context.featureFolder, 'design', jobId);
  
  const orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: new CommonRenderStrategy(chatAPI, bufferManager, state.context.userLanguage),  // ✅ Pass user language
    existingFiles: new Set([]) // Design phase doesn't generate code files
  });
  
  // 🎯 Show placeholder before LLM call
  await chatAPI.showChatStatus('placeholder');
  
  // Stream LLM response with real-time XML parsing
  for await (const event of llm.stream(result.formatted.messages)) {
    await orchestrator.processEvent(event);
  }
  
  const streamResult = await orchestrator.finalize();
  const raw = streamResult.raw;
  
  // ✅ CRITICAL: Get ALL files from buffer (not just design document)
  // This supports multi-file design (e.g., system-design.md + architecture.md + api-spec.md)
  const allBuffers = bufferManager.getAllBuffers();
  const files = Array.from(allBuffers.values()).map(buffer => ({
    path: buffer.filePath,
    content: buffer.content
  }));
  
  console.log(`\n📦 [Execute] Buffer analysis:`);
  console.log(`   Total buffers: ${allBuffers.size}`);
  for (const [path, buffer] of allBuffers) {
    console.log(`   📂 ${path}: ${buffer.content.length} chars (${buffer.actionType})`);
  }
  
  if (files.length === 0) {
    console.error(`❌ [Execute] No files generated!`);
    console.error(`   Streamed files: ${streamResult.streamedFiles.join(', ')}`);
    console.error(`   Raw response length: ${raw.length}`);
    throw new Error('No design files generated');
  }
  
  // ✅ Legacy support: Extract primary design document for designMarkdown
  const primaryDesignFile = files.find(f => 
    f.path.includes('system-design') || f.path.includes('design.md')
  ) || files[0];

  // ✅ StreamOrchestrator already handled file card rendering in real-time
  // No manual file card operations needed!

  // ✅ DON'T mark task as completed here - checkTaskStatus node handles completion
  // This prevents duplicate entries in completedTasksDetails
  // This ensures Kanban updates happen AFTER all workflow nodes are processed

  console.log(`\n✅ [Execute] Generated ${files.length} file(s):`);
  files.forEach(f => console.log(`   📄 ${f.path}: ${f.content.length} chars`));

  // ✅ CRITICAL: Sync buffer content to state for resume and writeFiles
  return { 
    ...state,
    currentTask,  // ✅ Explicitly include currentTask with timing
    files,  // ✅ All generated files (unified approach)
    filesToDelete: [],  // Design doesn't delete files
    // Keep currentTask - checkTaskStatus will handle completion and clear it
  };
}
