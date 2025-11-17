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
  
  // ✅ Get ChatAPIClient
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
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
  
  // ✅ Parse <edit> tags from raw response (for precise section modifications)
  const { parseResponse } = await import('../../../code/nodes/execute/parseResponse');
  const { applyEditToFile } = await import('../../../code/nodes/execute/applyEdits');
  const parsed = parseResponse(raw);
  
  // ✅ Determine operation mode (same as Code job)
  let finalDesignMarkdown: string;
  
  // Mode 1: <edit> tag used (precise section modification)
  if (parsed.edits.length > 0) {
    const designEdit = parsed.edits.find(e => e.path.includes('system-design.md'));
    if (!designEdit) {
      throw new Error('Edit instruction found but not for system-design.md');
    }
    
    // Read existing design document
    const existingDesign = state.designMarkdown || '';
    if (!existingDesign) {
      throw new Error('Cannot apply edit: no existing design document found. Use <file> tag for first task.');
    }
    
    // Apply edit (search/replace)
    try {
      finalDesignMarkdown = applyEditToFile(existingDesign, designEdit);
    } catch (error) {
      console.error(`   ❌ Failed to apply edit:`, error);
      throw error;
    }
  }
  // Mode 2: <append> tag used (append to existing document)
  else if (parsed.appends.length > 0) {
    const designAppend = parsed.appends.find(a => a.path.includes('system-design.md'));
    if (!designAppend) {
      throw new Error('Append instruction found but not for system-design.md');
    }
    
    // Read existing design document
    const existingDesign = state.designMarkdown || '';
    if (!existingDesign) {
      throw new Error('Cannot append: no existing design document found. Use <file> tag for first task.');
    }
    
    // Append content (same logic as mergeDesignDocuments)
    finalDesignMarkdown = mergeDesignDocuments(existingDesign, designAppend.content);
  }
  // Mode 3: <file> tag used (create new document)
  else if (parsed.files.length > 0) {
    const designFile = parsed.files.find(f => f.path.includes('system-design.md'));
    if (designFile) {
      finalDesignMarkdown = designFile.content || '';
    } else {
      console.warn('⚠️  No system-design.md file found in parsed files. Using raw content as fallback.');
      finalDesignMarkdown = raw.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    }
  }
  // Mode 4: No tags (fallback)
  else {
    console.warn('⚠️  No files in stream. LLM may not have used XML tags. Using raw text fallback.\n');
    finalDesignMarkdown = raw.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
  }

  // ✅ StreamOrchestrator already handled file card rendering in real-time
  // No manual file card operations needed!

  // ✅ DON'T mark task as completed here - checkTaskStatus node handles completion
  // This prevents duplicate entries in completedTasksDetails
  // This ensures Kanban updates happen AFTER all workflow nodes are processed

  // ✅ Validate finalDesignMarkdown before returning
  console.log(`\n✅ [Execute] Design document generated: ${finalDesignMarkdown.length} chars`);
  if (!finalDesignMarkdown || finalDesignMarkdown.trim().length === 0) {
    console.error(`❌ [Execute] WARNING: finalDesignMarkdown is empty!`);
  }

  return { 
    ...state,
    currentTask,  // ✅ Explicitly include currentTask with timing
    designMarkdown: finalDesignMarkdown,  // ✅ Use merged/updated markdown
    // Keep currentTask - checkTaskStatus will handle completion and clear it
  };
}
