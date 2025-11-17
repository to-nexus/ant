/**
 * Execute Node - Generate code using LLM
 * 
 * This is the main code generation node that:
 * 1. Builds context-aware prompts (retry, scope limiting)
 * 2. Streams LLM response with Chat UI integration
 * 3. Parses response (files, edits, commands)
 * 4. Executes commands (with safety checks)
 * 5. Applies edits to existing files
 * 6. Tracks attempt history for learning
 */

import { LLMClient } from "../../../../../../core/ports";
import { ArchitectGraphState, AttemptHistory, Violation, TaskTimingHelper } from "../../state";
import { PromptEngine } from "../../../../../../core/prompt/engine";

// Import shared utilities
import { extractErrorDetails, createErrorViolation, logErrorHeader } from "../shared/errorHandler";

// Import streaming system
import { StreamOrchestrator, XMLStreamParser, CommonRenderStrategy } from "../../../../../../core/streaming";

// Import execute-specific modules
import { parseResponse } from "./parseResponse";
import { applyEditToFile } from "./applyEdits";
import { executeCommands } from "./commandExecution";
import { buildExecutePromptMessages } from "./promptBuilder";
import { extractKeyChanges } from "./planContract";

/**
 * Execute node - generates code using LLM
 * Can be used for initial generation or enforcement (with reasonHeader)
 */
export async function execute(
  state: ArchitectGraphState
): Promise<ArchitectGraphState> {
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Workflow instrumentation: Enter node with current task info
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
  
  try {
    const llm = state.deps?.llm as LLMClient;
    const engine = state.deps?.promptEngine as PromptEngine;
    
    // ✨ Start timing for current task
    let currentTask = state.currentTask;
    console.log(`\n⏱️  [Execute] Checking task timing...`);
    console.log(`   Task: ${currentTask?.name}`);
    console.log(`   Has timing: ${!!currentTask?.timing}`);
    console.log(`   timing.startedAt: ${currentTask?.timing?.startedAt}`);
    
    if (currentTask && !currentTask.timing?.startedAt) {
      console.log(`   ➡️  Starting timing for task...`);
      currentTask = TaskTimingHelper.startTask(currentTask);
      console.log(`   ✅ Timing started at: ${currentTask.timing?.startedAt}`);
    } else if (currentTask?.timing?.pausedAt) {
      console.log(`   ➡️  Resuming timing (was paused at ${currentTask.timing.pausedAt})...`);
      currentTask = TaskTimingHelper.startTask(currentTask); // Resumes and accumulates pause duration
      console.log(`   ✅ Timing resumed`);
    } else {
      console.log(`   ℹ️  Timing already started (${currentTask?.timing?.startedAt})`);
    }
    
    // ✅ Update Kanban with timing info IMMEDIATELY after starting task
    if (currentTask && state._httpTaskId && state.deps?.kanbanUpdate) {
      const queueTasks = state.taskQueue?.getAll() || [];
      const completedTasksDetails = state.completedTasksDetails || [];
      
      console.log(`\n📡 [Execute] Broadcasting Kanban update with timing...`);
      console.log(`   jobId: ${state._httpTaskId}`);
      console.log(`   currentTask.name: ${currentTask.name}`);
      console.log(`   currentTask.timing.startedAt: ${currentTask.timing?.startedAt}`);
      console.log(`   queue length: ${queueTasks.length}`);
      console.log(`   completed length: ${completedTasksDetails.length}`);
      
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpTaskId,
        currentTask,  // ✅ Now includes timing info
        queueTasks,
        completedTasksDetails,
        state.recursionCount,
        state.recursionLimit || 50
      );
      console.log(`   ✅ Kanban update sent!\n`);
    } else {
      console.log(`\n⚠️  [Execute] Skipping Kanban update:`);
      console.log(`   currentTask: ${!!currentTask}`);
      console.log(`   _httpTaskId: ${!!state._httpTaskId}`);
      console.log(`   kanbanUpdate: ${!!state.deps?.kanbanUpdate}\n`);
    }
    
    // Build prompt messages with context
    const { messages } = await buildExecutePromptMessages(state, engine);
    
    // ✅ Get ChatAPIClient for chat integration
    const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
    const chatAPI = getChatAPIClient();
    
    // ✅ Extract existing file paths for duplicate prevention
    const existingFilePaths = new Set<string>();
    if (state.code) {
      const fileMatches = state.code.matchAll(/===\s+FILE:\s+(.+?)\s+===/g);
      for (const match of fileMatches) {
        existingFilePaths.add(match[1].trim());
      }
    }
    
    // ✅ Initialize StreamOrchestrator (single-pipeline streaming)
    const orchestrator = new StreamOrchestrator({
      parser: new XMLStreamParser(),
      renderStrategy: new CommonRenderStrategy(chatAPI),
      existingFiles: existingFilePaths
    });
    
    console.log('\n💻 Generating code with real-time streaming...\n');
    
    // ✅ Stream LLM response through orchestrator
    if (!llm.streamRaw) {
      throw new Error('LLM client does not support streaming');
    }
    
    // 🎯 Show placeholder before LLM call
    await chatAPI.showChatStatus('placeholder');
    
    try {
      console.log('🔵 [Execute] Starting LLM stream...');
      for await (const event of llm.streamRaw(messages)) {
        await orchestrator.processEvent(event);
      }
      console.log('✅ [Execute] LLM stream completed');
    } catch (error) {
      console.error('❌ [Execute] LLM stream failed:', error);
      throw error;
    }
    
    // ✅ Finalize streaming
    const streamResult = await orchestrator.finalize();
    const raw = streamResult.raw;
    
    console.log('\n');
    
    // ✅ Fallback parsing (for any files/edits/appends that weren't streamed)
    const { files, filesToDelete, commands, edits, appends } = parseResponse(raw);
    const streamedFiles = new Set(streamResult.streamedFiles);
    
    console.log(`\n📊 [Execute] Stream result:`);
    console.log(`   Streamed files: ${streamedFiles.size}`);
    console.log(`   Parsed files (total): ${files.length}`);
    console.log(`   Parsed edits: ${edits.length}`);
    console.log(`   Parsed appends: ${appends.length}`);
    console.log(`   Parsed deletes: ${filesToDelete?.length || 0}\n`);
    
    // Execute commands if any (with safety checks)
    await executeCommands(state, commands || []);
    
    // ✅ Fallback: Create file cards for files that weren't streamed
    const unstreamedFiles = files.filter(f => !streamedFiles.has(f.path));
    if (unstreamedFiles.length > 0) {
      console.log(`\n📄 [Execute] Creating fallback cards for ${unstreamedFiles.length} unstreamed file(s)...\n`);
      for (const file of unstreamedFiles) {
        console.log(`   ✅ ${file.path}`);
        const isExisting = existingFilePaths.has(file.path);
        if (isExisting && state.deps?.git) {
          // Existing file → treat as edit (full replacement)
          try {
            const existingContent = await state.deps.git.readFile(file.path);
            if (existingContent) {
              await chatAPI.startFileEdit(file.path);
              await chatAPI.completeFileEdit(file.path, existingContent, file.content || '');
            } else {
              await chatAPI.completeFileCreation(file.path, file.content || '');
            }
          } catch (error) {
            await chatAPI.completeFileCreation(file.path, file.content || '');
          }
        } else {
          // New file
          await chatAPI.completeFileCreation(file.path, file.content || '');
        }
      }
    }
    
    // ✅ Fallback: Apply edit instructions (if any weren't streamed)
    const failedEdits = await applyEdits(state, edits || [], []);
    
    // ✅ Fallback: Apply append instructions (if any weren't streamed)
    const failedAppends = await applyAppends(state, appends || [], []);
    
    // ✅ Fallback: Show file deletions (if any weren't streamed)
    for (const file of filesToDelete || []) {
      if (!streamedFiles.has(file)) {
        await chatAPI.completeFileDeletion(file);
      }
    }
    
    // ✅ Show file edits (from applyEdits)
    // Note: Edit notifications are already handled in applyEdits function
    
    // Record this attempt for learning (include all files: streamed + fallback)
    const allProcessedFiles = [...Array.from(streamedFiles), ...unstreamedFiles.map(f => f.path)];
    const filesGenerated = allProcessedFiles;
    const keyChanges = extractKeyChanges(files);  // Use all parsed files for analysis
    
    const currentAttempt: AttemptHistory = {
      attemptNumber: (state.previousAttempts?.length || 0) + 1,
      filesGenerated,
      keyChanges,
      subtaskName: state.currentTask?.name,
      // Use lastViolations (from previous attempt) not current violations (not set yet)
      errorsAttemptedToFix: state.currentTask?.errors || 
        (state.lastViolations?.map(v => v.message) || [])
    };
    
    // Add to history
    const previousAttempts = [...(state.previousAttempts || []), currentAttempt];
    
    console.log(`\n📝 Attempt #${currentAttempt.attemptNumber} recorded:`);
    console.log(`   Files: ${filesGenerated.length}`);
    console.log(`   Changes: ${keyChanges.length}`);
    if (keyChanges.length > 0) {
      keyChanges.forEach(change => console.log(`      - ${change}`));
    }
    
    // ✅ Add violations for failed edits (to guide next retry)
    const editViolations: Violation[] = failedEdits.map(path => ({
      type: 'other',
      severity: 'major',
      file: path,
      message: `Failed to apply EDIT to ${path}. File may not exist or SEARCH pattern doesn't match.`,
      suggestedFix: `Use <file> format to create/replace the entire file instead of <edit> format`,
      isRetryable: true
    }));
    
    const updatedState = {
      ...state,
      currentTask, // ✨ Updated with timing info
      rawResponse: raw,
      files,  // ✅ All parsed files
      filesToDelete,
      previousAttempts,
      violations: editViolations.length > 0 ? editViolations : undefined,  // ✅ Add edit failures as violations
      completedTasksDetails: state.completedTasksDetails || [],  // ✅ Preserve completed tasks
    };
    
    // ✅ Chat message is automatically finalized by orchestrator
    
    // ✅ Save checkpoint after code generation (in case recursion limit hits during writeFiles)
    const { saveCheckpoint } = await import('../checkpoint');
    await saveCheckpoint(updatedState);
    
    return updatedState;
  } catch (error) {
    logErrorHeader('Execute');
    
    // Extract detailed error information
    const errorDetails = extractErrorDetails(error);
    
    console.error('❌ Full error details:', JSON.stringify(error, null, 2));
    console.error('❌ ═══════════════════════════════════════════════════════════════\n');
    
    // Return state with empty files to trigger validation failure
    const executeError = createErrorViolation(errorDetails);
    
    return {
      ...state,
      files: [],
      filesToDelete: [],
      violations: [...(state.violations || []), executeError]
    };
  }
}

/**
 * Apply edit instructions to existing files
 */
async function applyEdits(
  state: ArchitectGraphState,
  edits: Array<{ path: string; search: string; replace: string }>,
  files: Array<{ path: string; content: string }>
): Promise<string[]> {
  const failedEdits: string[] = [];
  
  if (edits.length === 0 || !state.deps?.git) {
    return failedEdits;
  }
  
  console.log(`\n✂️  Found ${edits.length} edit instruction(s) in LLM response`);
  
  // ✅ Import ChatAPIClient for Cursor-style file edit streaming
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  for (const edit of edits) {
    let editStarted = false;
    try {
      console.log(`\n📝 Applying edit to: ${edit.path}`);
      
      // Read existing file
      const existingContent = await state.deps.git.readFile(edit.path);
      
      if (!existingContent) {
        throw new Error(`File ${edit.path} does not exist or is empty`);
      }
      
      // ✅ Phase 1: Start editing
      await chatAPI.startFileEdit(edit.path);
      editStarted = true;  // ✅ Track that editing UI was started
      
      // Apply edit
      const updatedContent = applyEditToFile(existingContent, edit);
      
      // Add to files list (will be written by existing writeFiles logic)
      files.push({
        path: edit.path,
        content: updatedContent
      });
      
      console.log(`   ✅ Edit applied successfully to ${edit.path}`);
      
      // ✅ Phase 2: Complete editing with diff (Cursor-style)
      await chatAPI.completeFileEdit(edit.path, existingContent, updatedContent);
      editStarted = false;  // ✅ Successfully completed
    } catch (error) {
      // ✅ CRITICAL: If editing UI was started, complete it with error state
      if (editStarted) {
        console.error(`   ⚠️  Completing file edit with error state to prevent stuck "Editing" UI`);
        try {
          // Complete with empty diff to close the card
          await chatAPI.completeFileEdit(edit.path, '', '');
        } catch (completeError) {
          console.error(`   ⚠️  Failed to complete edit UI:`, completeError);
        }
      }
      
      const errorMsg = (error as Error).message;
      console.error(`   ❌ Failed to apply edit to ${edit.path}:`);
      console.error(`      ${errorMsg}`);
      
      // Track failed edit for feedback
      failedEdits.push(edit.path);
      
      // ✅ Diagnose failure reason
      if (errorMsg.includes('ENOENT') || errorMsg.includes('does not exist') || 
          errorMsg.includes('null or undefined')) {
        console.log(`   💡 File doesn't exist or couldn't be read`);
        console.log(`   💡 Should use <file> format instead of <edit>`);
      } else if (errorMsg.includes('Search pattern not found')) {
        console.log(`   💡 <search> block doesn't match file content`);
        console.log(`   💡 Copy exact code from file or use <file> format to replace entire file`);
      } else {
        console.log(`   💡 Unknown error - consider using <file> format instead`);
      }
      
      console.log(`   ⚠️  Skipping this edit - file will remain unchanged`);
    }
  }
  
  return failedEdits;
}

/**
 * ✅ Apply append instructions to existing files
 * Appends content to the end of files
 */
async function applyAppends(
  state: ArchitectGraphState,
  appends: Array<{ path: string; content: string }>,
  files: Array<{ path: string; content: string }>
): Promise<string[]> {
  const failedAppends: string[] = [];
  
  if (appends.length === 0 || !state.deps?.git) {
    return failedAppends;
  }
  
  console.log(`\n➕ Found ${appends.length} append instruction(s) in LLM response`);
  
  // ✅ Import ChatAPIClient for Cursor-style file edit streaming
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  for (const append of appends) {
    let appendStarted = false;
    try {
      console.log(`\n📝 Appending to: ${append.path}`);
      
      // Read existing file
      const existingContent = await state.deps.git.readFile(append.path);
      
      if (!existingContent) {
        throw new Error(`File ${append.path} does not exist or is empty`);
      }
      
      // ✅ Phase 1: Start editing
      await chatAPI.startFileEdit(append.path);
      appendStarted = true;  // ✅ Track that editing UI was started
      
      // Append content
      const updatedContent = existingContent.trimEnd() + '\n\n' + append.content.trimStart();
      
      // Add to files list (will be written by existing writeFiles logic)
      files.push({
        path: append.path,
        content: updatedContent
      });
      
      console.log(`   ✅ Append applied successfully to ${append.path}`);
      
      // ✅ Phase 2: Complete editing with diff (Cursor-style)
      await chatAPI.completeFileEdit(append.path, existingContent, updatedContent);
      appendStarted = false;  // ✅ Successfully completed
    } catch (error) {
      // ✅ CRITICAL: If editing UI was started, complete it with error state
      if (appendStarted) {
        console.error(`   ⚠️  Completing file edit with error state to prevent stuck "Editing" UI`);
        try {
          // Complete with empty diff to close the card
          await chatAPI.completeFileEdit(append.path, '', '');
        } catch (completeError) {
          console.error(`   ⚠️  Failed to complete edit UI:`, completeError);
        }
      }
      
      const errorMsg = (error as Error).message;
      console.error(`   ❌ Failed to append to ${append.path}:`);
      console.error(`      ${errorMsg}`);
      
      // Track failed append for feedback
      failedAppends.push(append.path);
      
      // ✅ Diagnose failure reason
      if (errorMsg.includes('ENOENT') || errorMsg.includes('does not exist') || 
          errorMsg.includes('null or undefined')) {
        console.log(`   💡 File doesn't exist or couldn't be read`);
        console.log(`   💡 Should use <file> format instead of <append>`);
      } else {
        console.log(`   💡 Unknown error - consider using <file> format instead`);
      }
      
      console.log(`   ⚠️  Skipping this append - file will remain unchanged`);
    }
  }
  
  return failedAppends;
}

