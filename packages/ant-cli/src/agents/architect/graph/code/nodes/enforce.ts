/**
 * Enforce Node
 * 
 * Handles validation failures by:
 * 1. Prioritizing violations by impact
 * 2. Saving enforcement feedback for learning
 * 3. Managing retry logic
 * 4. Passing violations to Plan node for retry strategy
 * 
 * ✅ Self-Healing Planner Pattern:
 * - Captures error patterns for learning
 * - Provides structured violations to Plan node
 * - Enables pattern matching for future errors
 */

import { ArchitectGraphState, Violation, EnforcementFeedback } from "../state";
import { formatViolations } from "./shared/violationFormatter";

/**
 * Check if violations are retryable (재시도로 해결 가능한지)
 */
function areViolationsRetryable(violations: Violation[]): boolean {
  // 모든 violation이 retryable이면 true
  return violations.every(v => v.isRetryable === true);
}

/**
 * Generate error fingerprint for detecting repeated errors
 */
function generateErrorFingerprint(violations: Violation[]): string {
  return violations
    .map(v => {
      const fileInfo = v.file ? `:${v.file}` : '';
      const msgSnippet = v.message.substring(0, 80).replace(/\n/g, ' ');
      return `${v.type}${fileInfo}:${msgSnippet}`;
    })
    .sort()
    .join('|');
}

/**
 * Check if errors are repeating from previous attempt
 */
function areErrorsRepeating(
  currentViolations: Violation[], 
  previousViolations?: Violation[]
): boolean {
  if (!previousViolations || previousViolations.length === 0) {
    return false;
  }
  
  const currentFingerprint = generateErrorFingerprint(currentViolations);
  const previousFingerprint = generateErrorFingerprint(previousViolations);
  
  return currentFingerprint === previousFingerprint;
}

export async function enforce(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 
      'enforce', 
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  const violations = state.violations || [];
  
  console.log(`\n⚠️  ENFORCEMENT triggered (retry ${state.retries + 1}/${state.maxRetries})\n`);
  console.log(`   Violations: ${violations.length}`);
  
  // ✅ Apply error priority system
  const { 
    logErrorPriority, 
    getTopPriorityError,
    prioritizeViolations
  } = await import('./errorPriority');
  
  const errorContext = {
    directive: state.context.task || '',
    taskType: state.currentTask?.type || 'feature',
    taskName: state.currentTask?.name || 'Unknown',
    retryCount: state.retries
  };
  
  // Log priority analysis
  logErrorPriority(violations, errorContext);
  
  // Get only retryable errors
  const retryableErrors = prioritizeViolations(violations, errorContext, true);
  
  if (retryableErrors.length === 0) {
    console.log('✅ No blocking/retryable errors found - proceeding despite warnings\n');
    
    // ✅ Workflow instrumentation: Exit node (no retryable errors path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'enforce');
    }
    
    return {
      ...state,
      violations: []  // Clear non-blocking errors
    };
  }
  
  // Focus on top priority error(s)
  const topError = retryableErrors[0];
  console.log(`🎯 Focusing on highest priority error (score: ${topError.impact.score}/100)\n`);
  
  // ✅ CRITICAL: Include ALL errors of the same type as top priority
  // Reason: If LLM needs to fix "Search block not found" for 4 files,
  //         showing only 1 will cause infinite retry loop (fix 1 per retry)
  const topErrorType = topError.violation.type;
  const sameTypeErrors = retryableErrors.filter(
    err => err.violation.type === topErrorType
  );
  
  // ✅ Strategy: Show all same-type errors, max 5 to avoid overwhelming LLM
  const focusedViolations = sameTypeErrors.slice(0, 5).map(err => err.violation);
  
  if (focusedViolations.length > 1) {
    console.log(`   Including ${focusedViolations.length} errors of type "${topErrorType}"\n`);
  }
  
  // ✅ Check for repeated errors
  const isRepeating = areErrorsRepeating(focusedViolations, state.lastViolations);
  
  if (isRepeating) {
    console.warn('🚨 REPEATED ERRORS DETECTED - Same errors as previous attempt!\n');
    console.warn('   This suggests the LLM is stuck or misunderstanding the problem.\n');
    console.warn('   Escalating context for next retry...\n');
    
    // ✅ CRITICAL: Force package.json update for repeated missing dependency errors
    const hasMissingDependency = focusedViolations.some(v => v.type === 'missing_dependency');
    if (hasMissingDependency && state.retries >= 1) {
      console.warn('   💡 Missing dependency error repeating - forcing package.json modification strategy\n');
      // This will be used in the enforcement message
    }
  }
  
  // Format violations for LLM (use focused violations only)
  let formattedViolations = formatViolations(focusedViolations);
  
  // ✅ CRITICAL: Make enforcement message CONCISE and ACTIONABLE
  // - LLM ignores long walls of text
  // - Focus on ONE clear instruction per error type
  const errorType = focusedViolations[0]?.type;
  const fileCount = focusedViolations.length;
  
  if (errorType === 'file_operation_failed') {
    // Search block errors need special handling
    const searchBlockErrors = focusedViolations.filter(v => 
      v.message.includes('Search block not found') || 
      v.message.includes('Duplicate edit')
    );
    
    if (searchBlockErrors.length > 0) {
      const files = searchBlockErrors
        .map(v => v.file)
        .filter(Boolean)
        .join(', ');
      
      // ✅ REPLACE verbose message with concise, actionable one
      formattedViolations = `
🚨 PREVIOUS ATTEMPT FAILED: ${searchBlockErrors.length} file edit error(s)

Files: ${files}

REASON: Search block mismatch or duplicate edit

✅ REQUIRED FIX (3 steps):
1. BEFORE editing: Call read_file("path")
2. Copy EXACT search block (character-perfect)
3. ONE edit per file
`;
    }
  }
  
  // ✅ Add escalation notice if errors are repeating
  if (isRepeating && state.retries > 0) {
    const hasMissingDependency = focusedViolations.some(v => v.type === 'missing_dependency');
    
    const dependencyInstructions = hasMissingDependency ? `

🚨 SPECIFIC FIX FOR MISSING DEPENDENCY:
Your previous attempts to run npm commands DID NOT WORK.

✅ CORRECT APPROACH - MODIFY package.json DIRECTLY:
1. Find the missing package name (e.g., "@types/react")
2. Output the COMPLETE package.json file with the dependency added
3. Format: <file path="package.json">...</file>

❌ DO NOT output npm commands in bash blocks - they did not execute!
❌ DO NOT create separate "Terminal Commands" files
✅ MODIFY package.json file DIRECTLY - system will auto-install
` : '';
    
    formattedViolations = `
⚠️⚠️⚠️ CRITICAL: REPEATED ERRORS DETECTED ⚠️⚠️⚠️

You have seen these EXACT SAME ERRORS before and your previous fix DID NOT WORK.
This means your previous approach was WRONG.

🔴 YOU MUST:
1. **STOP and READ** the error messages MORE CAREFULLY
2. **THINK DIFFERENTLY** - your previous approach failed
3. **CHECK YOUR ASSUMPTIONS** - you may have misunderstood the problem
4. **BE MORE PRECISE** - follow the error message LITERALLY
${dependencyInstructions}

For example:
- If error says "Property 'X' does not exist on type 'Y'" → Add property 'X' to type 'Y'
- If error says "Variable 'Z' is declared but never read" → Remove variable 'Z'
- DO NOT try to fix something else - fix EXACTLY what the error says

${formattedViolations}
`;
  }
  
  console.log(`\n📋 Violation Summary:\n${formattedViolations}\n`);
  
  // ===== RETRY HEURISTIC =====
  // Analyze if violations are retryable or need task decomposition
  const retryable = areViolationsRetryable(focusedViolations);
  
  if (retryable) {
    console.log('✅ All violations are retryable (can fix with regeneration)\n');
  } else {
    console.log('⚠️  Some violations need task decomposition (blocking errors)\n');
  }
  
  // ===== SAVE ENFORCEMENT FEEDBACK (for lesson extraction) =====
  const feedback: EnforcementFeedback = {
    taskId: state.currentTask?.id || 'unknown',
    taskName: state.currentTask?.name || 'Unknown Task',
    attemptNumber: state.retries + 1,
    violations: focusedViolations,  // Use focused violations
    fixStrategy: 'retry',  // Will be updated by Plan node
    timestamp: Date.now()
  };
  
  const enforcementHistory = [...(state.enforcementHistory || []), feedback];
  
  console.log('💾 Enforcement feedback saved for lesson extraction\n');
  console.log('📨 Passing violations to Plan node for strategy decision...\n');
  
  // ✅ Workflow instrumentation: Exit node (retry path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'enforce');
  }
  
  return {
    ...state,
    violations: focusedViolations,  // ✅ Pass violations to next node for retry strategy
    violationMessage: formattedViolations,  // ✅ Pass the enhanced, formatted message to promptBuilder
    retries: state.retries + 1,
    lastViolations: focusedViolations,
    enforcementHistory,
    _errorIsRepeating: isRepeating // ⭐ Flag for execute node to use
  };
}

