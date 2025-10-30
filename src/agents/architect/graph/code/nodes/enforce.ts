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

export async function enforce(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const violations = state.violations || [];
  
  console.log(`\n⚠️  ENFORCEMENT triggered (retry ${state.retries + 1}/${state.maxRetries})\n`);
  console.log(`   Violations: ${violations.length}`);
  
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
  
  console.log(`   Error summary: ${actualErrors.substring(0, 200)}${actualErrors.length > 200 ? '...' : ''}\n`);
  
  // ===== SIMPLIFIED ENFORCEMENT =====
  // LLM in Plan node now handles subtask management
  // We just pass violations and increment retries
  
  console.log('📨 Passing violations to Plan node for LLM analysis...\n');
  
  return {
    ...state,
    enforcementReason: actualErrors,
    retries: state.retries + 1,
    lastViolations: violations
  };
}

