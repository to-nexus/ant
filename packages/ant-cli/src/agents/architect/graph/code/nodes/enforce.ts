/**
 * Enforce Node
 * 
 * Handles validation failures by:
 * 1. Formatting structured violations for LLM
 * 2. Saving enforcement feedback for learning
 * 3. Managing retry logic
 * 4. Preparing focused enforcement reason for re-planning
 * 
 * ✅ Self-Healing Planner Pattern:
 * - Captures error patterns for learning
 * - Provides structured feedback to Plan node
 * - Enables pattern matching for future errors
 */

import { ArchitectGraphState, Violation, EnforcementFeedback } from "../state";

/**
 * Format violations into human-readable text
 */
function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return 'No specific violations detected';
  
  return violations.map((v, idx) => {
    const parts = [
      `${idx + 1}. [${v.severity.toUpperCase()}] ${v.type}`,
      `   Message: ${v.message}`
    ];
    
    if (v.file) parts.push(`   File: ${v.file}`);
    if (v.module) parts.push(`   Module: ${v.module}`);
    if (v.suggestedFix) parts.push(`   💡 Suggested Fix: ${v.suggestedFix}`);
    if (v.isRetryable !== undefined) {
      parts.push(`   ♻️  Retryable: ${v.isRetryable ? 'YES' : 'NO (needs task decomposition)'}`);
    }
    
    return parts.join('\n');
  }).join('\n\n');
}

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
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    state.deps.workflowUpdate.enterNode(state._httpTaskId, 'enforce', taskInfo);
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
    return {
      ...state,
      violations: []  // Clear non-blocking errors
    };
  }
  
  // Focus on top priority error
  const topError = retryableErrors[0];
  console.log(`🎯 Focusing on highest priority error (score: ${topError.impact.score}/100)\n`);
  
  // Use only top priority for retry (avoid overwhelming LLM)
  const focusedViolations = [topError.violation];
  
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
  
  // ✅ Add escalation notice if errors are repeating
  if (isRepeating && state.retries > 0) {
    const hasMissingDependency = focusedViolations.some(v => v.type === 'missing_dependency');
    
    const dependencyInstructions = hasMissingDependency ? `

🚨 SPECIFIC FIX FOR MISSING DEPENDENCY:
Your previous attempts to run npm commands DID NOT WORK.

✅ CORRECT APPROACH - MODIFY package.json DIRECTLY:
1. Find the missing package name (e.g., "@types/react")
2. Output the COMPLETE package.json file with the dependency added
3. Format: === FILE: package.json === ... === END FILE ===

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
  
  // ===== SAVE ENFORCEMENT FEEDBACK (for learning) =====
  const feedback: EnforcementFeedback = {
    taskId: state.currentTask?.id || 'unknown',
    taskName: state.currentTask?.name || 'Unknown Task',
    attemptNumber: state.retries + 1,
    violations: focusedViolations,  // Use focused violations
    enforcementReason: formattedViolations,
    fixStrategy: 'retry',  // Will be updated by Plan node
    timestamp: Date.now()
  };
  
  const enforcementHistory = [...(state.enforcementHistory || []), feedback];
  
  console.log('💾 Enforcement feedback saved for learning\n');
  console.log('📨 Passing violations to Plan node for strategy decision...\n');
  
  return {
    ...state,
    violations: focusedViolations,  // ✅ Pass violations to next node (execute needs this!)
    enforcementReason: formattedViolations,
    retries: state.retries + 1,
    lastViolations: focusedViolations,
    enforcementHistory,
    _errorIsRepeating: isRepeating // ⭐ Flag for execute node to use
  };
}

