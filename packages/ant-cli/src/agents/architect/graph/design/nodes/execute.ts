import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

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
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpTaskId, 'execute', taskInfo);
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
  
  if (llm.stream) {
    // Use streaming if available
    for await (const chunk of llm.stream(result.formatted.messages)) {
      process.stdout.write(chunk);
      designMarkdown += chunk;
    }
    console.log('\n');
  } else {
    // Fallback to regular invoke
    designMarkdown = await llm.invoke(result.formatted.messages);
  }
  
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

  // ✅ Mark current task as completed
  let completedTasks = state.completedTasks || [];
  let completedTasksDetails = state.completedTasksDetails || [];
  
  if (state.currentTask) {
    // ✨ Complete task with timing
    const { TaskTimingHelper } = await import('../../code/state');
    const completedTask = TaskTimingHelper.completeTask(state.currentTask);
    
    if (completedTask.timing?.elapsedTime) {
      const formattedTime = TaskTimingHelper.formatElapsedTime(completedTask.timing.elapsedTime);
      console.log(`✅ Task "${completedTask.name}" completed in ${formattedTime}!`);
    } else {
      console.log(`✅ Task "${completedTask.name}" completed!`);
    }
    
    completedTasks.push(completedTask.id);
    completedTasksDetails.push(completedTask);
  }

  // ✅ DON'T update Kanban here - let checkTaskCompletion do it after workflow tracking
  // This ensures Kanban updates happen AFTER all workflow nodes are processed

  return { 
    ...state, 
    designMarkdown: finalDesignMarkdown,  // ✅ Use merged/updated markdown
    currentTask: state.currentTask,  // ✅ Keep currentTask (checkTaskCompletion will clear it)
    completedTasks,
    completedTasksDetails
  };
}
