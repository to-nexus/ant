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

export async function enforce(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    state.deps.workflowUpdate.enterNode(state._httpTaskId, 'enforce');
  }
  
  const violations = state.violations || [];
  
  console.log(`\n⚠️  ENFORCEMENT triggered (retry ${state.retries + 1}/${state.maxRetries})\n`);
  console.log(`   Violations: ${violations.length}`);
  
  // Format violations for LLM
  const formattedViolations = formatViolations(violations);
  
  console.log(`\n📋 Violation Summary:\n${formattedViolations}\n`);
  
  // ===== RETRY HEURISTIC =====
  // Analyze if violations are retryable or need task decomposition
  const retryable = areViolationsRetryable(violations);
  
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
    violations: violations,
    enforcementReason: formattedViolations,
    fixStrategy: 'retry',  // Will be updated by Plan node
    timestamp: Date.now()
  };
  
  const enforcementHistory = [...(state.enforcementHistory || []), feedback];
  
  console.log('💾 Enforcement feedback saved for learning\n');
  console.log('📨 Passing violations to Plan node for strategy decision...\n');
  
  return {
    ...state,
    enforcementReason: formattedViolations,
    retries: state.retries + 1,
    lastViolations: violations,
    enforcementHistory
  };
}

