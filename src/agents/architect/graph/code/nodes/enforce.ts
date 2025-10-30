/**
 * Enforce Node
 * 
 * Handles validation failures by:
 * 1. Analyzing errors and creating subtasks (Task Decomposition)
 * 2. Detecting progress on current subtask
 * 3. Managing retry logic with smart reset
 * 4. Preparing focused enforcement reason for re-planning
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Pure business logic
 * - No external dependencies
 * - Domain-driven error analysis
 */

import { ArchitectGraphState } from "../state";
import { analyzeErrors, formatSubtaskPrompt, hasSubtaskProgress } from "../utils/ErrorAnalyzer";

export async function enforce(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const violations = state.violations || [];
  
  console.log(`\n⚠️  ENFORCEMENT triggered (retry ${state.retries + 1}/${state.maxRetries})\n`);
  
  // Convert violations to string safely
  let actualErrors = 'Validation failed';
  if (violations.length > 0) {
    actualErrors = violations
      .map((v: any) => {
        if (typeof v === 'string') return v;
        
        try {
          return JSON.stringify(v, null, 2);
        } catch (circularError) {
          if (v && typeof v.toString === 'function') {
            return v.toString();
          }
          return `[${typeof v}] ${String(v)}`;
        }
      })
      .join('\n\n');
  }
  
  // If no files generated, add helpful message
  if (!state.files || state.files.length === 0) {
    if (actualErrors === 'Validation failed') {
      actualErrors = `❌ No files were generated. Please create the necessary files based on the design document and directive.`;
    } else {
      actualErrors = `❌ No files were generated.\n\n${actualErrors}`;
    }
  }
  
  // ===== TASK DECOMPOSITION =====
  
  // Check if we need to create subtasks (first time or when subtasks exhausted)
  const needsDecomposition = !state.currentSubtask && !state.remainingSubtasks;
  
  if (needsDecomposition) {
    console.log('🔍 Analyzing errors and creating subtasks...\n');
    
    const subtasks = analyzeErrors(violations);
    
    if (subtasks.length === 0) {
      // No categorizable errors, use all violations as one task
      console.log('⚠️  No categorizable errors, treating as single task\n');
      return {
        ...state,
        enforcementReason: actualErrors,
        retries: state.retries + 1
      };
    }
    
    console.log(`📊 Created ${subtasks.length} subtask${subtasks.length > 1 ? 's' : ''}:`);
    subtasks.forEach((st, i) => {
      console.log(`   ${i + 1}. ${st.name} (${st.errors.length} error${st.errors.length > 1 ? 's' : ''}, priority: ${st.priority})`);
    });
    console.log('');
    
    const currentSubtask = subtasks[0];
    const remainingSubtasks = subtasks.slice(1);
    
    console.log(`🎯 Starting Subtask 1/${subtasks.length}: ${currentSubtask.name}`);
    console.log(`   Focus: ${currentSubtask.description}`);
    console.log(`   Errors: ${currentSubtask.errors.length}\n`);
    
    return {
      ...state,
      currentSubtask,
      remainingSubtasks,
      completedSubtasks: [],
      subtaskIndex: 1,
      totalSubtasks: subtasks.length,
      enforcementReason: formatSubtaskPrompt(currentSubtask, 1, subtasks.length),
      retries: 0, // Reset for new subtask
      lastViolations: violations,
      previousFileCount: state.files?.length || 0
    };
  }
  
  // ===== PROGRESS DETECTION =====
  
  const currentSubtask = state.currentSubtask!;
  const currentViolations = violations;
  const lastViolations = state.lastViolations || [];
  const currentFileCount = state.files?.length || 0;
  const previousFileCount = state.previousFileCount || 0;
  
  // Detect different types of progress
  const newFilesCreated = currentFileCount > previousFileCount;
  const subtaskProgress = hasSubtaskProgress(currentSubtask, lastViolations, currentViolations);
  const violationsChanged = JSON.stringify(currentViolations) !== JSON.stringify(lastViolations);
  
  const hasProgress = newFilesCreated || subtaskProgress || violationsChanged;
  
  // Smart retry logic: Reset counter if we made progress
  const newRetries = hasProgress ? 0 : state.retries + 1;
  
  if (hasProgress) {
    console.log(`✨ PROGRESS DETECTED on "${currentSubtask.name}"!`);
    if (newFilesCreated) {
      console.log(`   📝 New files created: ${previousFileCount} → ${currentFileCount}`);
    }
    if (subtaskProgress) {
      console.log(`   🎯 Subtask errors reduced`);
    }
    if (violationsChanged && !subtaskProgress) {
      console.log(`   🔄 Working on different issues`);
    }
    console.log(`   🔄 Retry counter reset: ${state.retries} → 0\n`);
  } else {
    console.log(`⚠️  No progress on "${currentSubtask.name}", incrementing retry: ${state.retries} → ${newRetries}\n`);
  }
  
  // Check if current subtask should be abandoned (too many retries without progress)
  if (newRetries >= state.maxRetries && state.remainingSubtasks && state.remainingSubtasks.length > 0) {
    console.log(`❌ Subtask "${currentSubtask.name}" failed after ${state.maxRetries} retries`);
    console.log(`   Moving to next subtask...\n`);
    
    const nextSubtask = state.remainingSubtasks[0];
    const newRemaining = state.remainingSubtasks.slice(1);
    const newIndex = state.subtaskIndex + 1;
    
    console.log(`🎯 Starting Subtask ${newIndex}/${state.totalSubtasks}: ${nextSubtask.name}`);
    console.log(`   Focus: ${nextSubtask.description}`);
    console.log(`   Errors: ${nextSubtask.errors.length}\n`);
    
    return {
      ...state,
      currentSubtask: nextSubtask,
      remainingSubtasks: newRemaining,
      completedSubtasks: [...(state.completedSubtasks || []), currentSubtask.name],
      subtaskIndex: newIndex,
      enforcementReason: formatSubtaskPrompt(nextSubtask, newIndex, state.totalSubtasks),
      retries: 0, // Reset for new subtask
      lastViolations: violations,
      previousFileCount: currentFileCount
    };
  }
  
  // Continue with current subtask
  return {
    ...state,
    enforcementReason: formatSubtaskPrompt(currentSubtask, state.subtaskIndex, state.totalSubtasks),
    retries: newRetries,
    lastViolations: violations,
    previousFileCount: currentFileCount
  };
}

