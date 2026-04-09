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
      (state as any).workerId ?? 0,
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
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'enforce', (state as any).workerId ?? 0);
    }
    
    return {
      ...state,
      violations: []  // Clear non-blocking errors
    };
  }
  
  // Focus on top priority error(s)
  const topError = retryableErrors[0];
  console.log(`🎯 Focusing on highest priority error (score: ${topError.impact.score}/100)\n`);
  
  // ✅ CRITICAL: Focus on top 1-2 errors of the same type
  // Reason: Better to fix 1-2 completely than 5 partially
  // Strategy: Sequential fixing with clear focus
  const topErrorType = topError.violation.type;
  const sameTypeErrors = retryableErrors.filter(
    err => err.violation.type === topErrorType
  );
  
  // ✅ Strategy: Show max 2 same-type errors for clear focus
  // LLM works better with focused scope than trying to fix many at once
  const focusedViolations = sameTypeErrors.slice(0, 2).map(err => err.violation);
  
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
  
  if (errorType === 'cross_worker_conflict') {
    // Cross-worker file conflicts: another parallel task owns these files
    const conflictFiles = focusedViolations
      .map(v => v.file)
      .filter(Boolean);
    const fileList = conflictFiles.map(f => `  - ${f}`).join('\n');
    
    formattedViolations = `
🚨 CROSS-WORKER FILE CONFLICT

Another parallel task already created these files:
${fileList}

⛔ DO NOT use <file> tag to overwrite these files directly.

✅ REQUIRED (2 steps):
1. Call read_file("path") to get the CURRENT content and version
2. Then EITHER:
   a. Use <file path="path"> with MERGED content (full rewrite)
   b. Use edit_file tool to partially modify
`;
  } else if (errorType === 'file_operation_failed') {
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

REASON: Search block mismatch (outdated content)

✅ REQUIRED FIX (2 steps):
1. Call read_file("path") to get CURRENT content
2. Use EXACT old_str from read_file result in edit_file tool
`;
    }
  }
  
  // ✅ Add concise escalation notice if errors are repeating
  if (isRepeating && state.retries > 0) {
    const hasMissingDependency = focusedViolations.some(v => v.type === 'missing_dependency');
    
    const dependencyHint = hasMissingDependency ? `

💡 Missing dependency? Modify package.json directly with <file> tag.
` : '';
    
    formattedViolations = `
⚠️  REPEATED ERROR - Previous fix didn't work.

${formattedViolations}

Try a different approach. Read error message literally.${dependencyHint}
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
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'enforce', (state as any).workerId ?? 0);
  }
  
  return {
    ...state,
    violations: focusedViolations,
    violationMessage: formattedViolations,
    retries: state.retries + 1,
    lastViolations: focusedViolations,
    enforcementHistory,
    _errorIsRepeating: isRepeating,
    _planEntryReason: 'retry' as const,
  };
}

