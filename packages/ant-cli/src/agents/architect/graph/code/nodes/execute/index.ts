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
import { streamLLMResponse, finalizeChatMessage, addChatFileOperation } from "../shared/llmStreamHandler";
import { extractErrorDetails, createErrorViolation, logErrorHeader } from "../shared/errorHandler";

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
    if (currentTask && !currentTask.timing?.startedAt) {
      currentTask = TaskTimingHelper.startTask(currentTask);
    } else if (currentTask?.timing?.pausedAt) {
      currentTask = TaskTimingHelper.startTask(currentTask); // Resumes and accumulates pause duration
    }
    
    // Build prompt messages with context
    const { messages } = await buildExecutePromptMessages(state, engine);
    
    // ✅ Get ChatAPIClient for chat integration
    const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
    const chatAPI = getChatAPIClient();
    
    // ✅ Start message FIRST (so everything goes into the same message)
    if (chatAPI.isEnabled()) {
      await chatAPI.startMessage();
      
      // ✅ Show "Planning next moves..."
      await chatAPI.sendLLMEvent({
        type: 'thinking',
        content: 'Planning next moves...',
        metadata: {
          provider: 'system',
          timestamp: new Date().toISOString()
        }
      });
    }
    
    // ✅ Track current file for real-time streaming
    let currentFileForStreaming: string | null = null;
    const streamedFiles = new Set<string>();
    
    // ✅ Generate code with real-time file streaming (Cursor-style)
    console.log('\n💻 Generating code...\n');
    const { raw, chatMessageStarted } = await streamLLMResponse(llm, messages, {
      thinkingOnly: false,  // ✅ Show thinking AND text (for file streaming)
      onFileStart: async (filePath) => {
        // ✅ New file detected in LLM response
        if (currentFileForStreaming && streamedFiles.has(currentFileForStreaming)) {
          // Complete previous file
          await chatAPI.completeFileCreation(currentFileForStreaming, '');
        }
        
        // Start new file card
        currentFileForStreaming = filePath;
        streamedFiles.add(filePath);
        await chatAPI.streamFileContent(filePath, '');
      },
      onFileEnd: async () => {
        // ✅ Complete current file when block ends
        if (currentFileForStreaming) {
          await chatAPI.completeFileCreation(currentFileForStreaming, '');
          currentFileForStreaming = null;
        }
      }
    });
    console.log('\n');
    
    // ✅ Complete last streamed file if not already completed
    if (currentFileForStreaming) {
      await chatAPI.completeFileCreation(currentFileForStreaming, '');
      currentFileForStreaming = null;
    }
    
    // Parse LLM response
    const { responseSection, files, filesToDelete, commands, edits } = parseResponse(raw);
    
    // Execute commands if any (with safety checks)
    await executeCommands(state, commands || []);
    
    // Apply edit instructions to existing files
    const failedEdits = await applyEdits(state, edits || [], files);
    
    // ✅ Add any files that weren't streamed (fallback for parsing differences)
    for (const file of files) {
      if (!streamedFiles.has(file.path)) {
        await chatAPI.completeFileCreation(file.path, file.content || '');
      }
    }
    
    // ✅ Show file deletions
    for (const file of filesToDelete || []) {
      await chatAPI.completeFileDeletion(file);
    }
    
    // ✅ Show file edits (from applyEdits)
    // Note: Edit notifications are already handled in applyEdits function
    
    // Record this attempt for learning
    const filesGenerated = files.map(f => f.path);
    const keyChanges = extractKeyChanges(files);
    
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
      suggestedFix: `Use FILE format (=== FILE: ${path} ===) to create/replace the entire file instead of EDIT format`,
      isRetryable: true
    }));
    
    const updatedState = {
      ...state,
      currentTask, // ✨ Updated with timing info
      rawResponse: raw,
      responseSection,
      files,
      filesToDelete,
      previousAttempts,
      violations: editViolations.length > 0 ? editViolations : undefined,  // ✅ Add edit failures as violations
      completedTasksDetails: state.completedTasksDetails || [],  // ✅ Preserve completed tasks
    };
    
    // ✅ Finalize chat message if started
    await finalizeChatMessage(chatMessageStarted);
    
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
    try {
      console.log(`\n📝 Applying edit to: ${edit.path}`);
      
      // Read existing file
      const existingContent = await state.deps.git.readFile(edit.path);
      
      if (!existingContent) {
        throw new Error(`File ${edit.path} does not exist or is empty`);
      }
      
      // ✅ Phase 1: Start editing
      await chatAPI.startFileEdit(edit.path);
      
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
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.error(`   ❌ Failed to apply edit to ${edit.path}:`);
      console.error(`      ${errorMsg}`);
      
      // Track failed edit for feedback
      failedEdits.push(edit.path);
      
      // ✅ Diagnose failure reason
      if (errorMsg.includes('ENOENT') || errorMsg.includes('does not exist') || 
          errorMsg.includes('null or undefined')) {
        console.log(`   💡 File doesn't exist or couldn't be read`);
        console.log(`   💡 Should use FILE format (=== FILE: ${edit.path} ===) instead of EDIT`);
      } else if (errorMsg.includes('Search pattern not found')) {
        console.log(`   💡 SEARCH block doesn't match file content`);
        console.log(`   💡 Copy exact code from file or use FILE format to replace entire file`);
      } else {
        console.log(`   💡 Unknown error - consider using FILE format instead`);
      }
      
      console.log(`   ⚠️  Skipping this edit - file will remain unchanged`);
    }
  }
  
  return failedEdits;
}

