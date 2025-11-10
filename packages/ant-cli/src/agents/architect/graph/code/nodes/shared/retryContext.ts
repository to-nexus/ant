/**
 * Retry Context Builder - Extract retry context for template injection
 */

import { ArchitectGraphState } from "../../state";

export interface RetryContext {
  attemptNumber: number;
  originalDirective: string;
  originalPlan: string;
  keyDecisions: string[];
  previousAttempts: Array<{
    attemptNumber: number;
    approach: string;
    error: string;
    wasCloseToSuccess: boolean;
  }>;
  currentError: string;
}

/**
 * Build retry context for template injection
 */
export function buildRetryContext(state: ArchitectGraphState): RetryContext | null {
  if (!state.retries || state.retries === 0) {
    return null;
  }
  
  // Extract original directive and plan
  const originalDirective = state.directive || state.context.task || '';
  const originalPlan = extractKeyPlan(state.planText || '');
  
  // Extract key decisions from plan
  const keyDecisions = extractKeyDecisions(state.planText || '');
  
  // Build previous attempts history
  const previousAttempts = (state.previousAttempts || []).map(attempt => ({
    attemptNumber: attempt.attemptNumber,
    approach: attempt.keyChanges.join(', ') || 'No changes recorded',
    error: attempt.errorsAttemptedToFix.join('; ') || 'Unknown error',
    wasCloseToSuccess: attempt.filesGenerated.length > 0
  }));
  
  // Current error (from enforcementReason)
  const currentError = state.enforcementReason || 'See violations below';
  
  return {
    attemptNumber: state.retries,
    originalDirective,
    originalPlan,
    keyDecisions,
    previousAttempts,
    currentError
  };
}

/**
 * Extract key plan from THINKING section
 */
function extractKeyPlan(planText: string): string {
  // Extract THINKING section
  const thinkingMatch = planText.match(/===\s*THINKING\s*===([\s\S]*?)===\s*END THINKING\s*===/);
  if (!thinkingMatch) return '';
  
  const thinking = thinkingMatch[1];
  const keyParts: string[] = [];
  
  // Extract Solution section
  const solutionMatch = thinking.match(/\*\*Solution:\*\*([\s\S]*?)(?=\n\*\*|$)/);
  if (solutionMatch) {
    keyParts.push(solutionMatch[1].trim());
  }
  
  // Extract Execution Plan/Approach
  const planMatch = thinking.match(/\*\*(?:Execution Plan|Approach):\*\*([\s\S]*?)(?=\n\*\*|$)/);
  if (planMatch) {
    keyParts.push(planMatch[1].trim());
  }
  
  // Extract Files to modify/create
  const filesMatch = thinking.match(/\*\*Files to (?:Create\/)?Modify:\*\*([\s\S]*?)(?=\n\*\*|$)/);
  if (filesMatch) {
    keyParts.push(filesMatch[1].trim());
  }
  
  return keyParts.join('\n\n').substring(0, 500); // Limit length
}

/**
 * Extract key decisions from plan (functions to use, approaches, etc.)
 */
function extractKeyDecisions(planText: string): string[] {
  const decisions: string[] = [];
  
  // "Use X instead of Y" pattern
  const useInsteadMatches = planText.matchAll(/use\s+`([^`]+)`\s+instead of\s+`([^`]+)`/gi);
  for (const match of useInsteadMatches) {
    decisions.push(`Use ${match[1]} instead of ${match[2]}`);
  }
  
  // "Import X from Y" pattern
  const importMatches = planText.matchAll(/import.*?`([^`]+)`.*?from\s+[`']([^`']+)[`']/gi);
  for (const match of importMatches) {
    decisions.push(`Import ${match[1]} from ${match[2]}`);
  }
  
  // Function names mentioned in backticks
  const functionMatches = planText.matchAll(/`(\w+(?:WithFallback|Helper|Service)(?:\.\w+)?)`/g);
  const functionNames = new Set<string>();
  for (const match of functionMatches) {
    functionNames.add(match[1]);
  }
  
  if (functionNames.size > 0) {
    decisions.push(`Key functions: ${Array.from(functionNames).join(', ')}`);
  }
  
  // Limit to top 5 most important decisions
  return decisions.slice(0, 5);
}

