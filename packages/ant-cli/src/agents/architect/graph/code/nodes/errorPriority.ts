/**
 * Error Priority System
 * 
 * Scores and prioritizes errors to focus LLM on the most impactful issues
 * and avoid blocking on minor style/lint problems.
 */

import { Violation } from "../state";

export interface ErrorImpact {
  score: number;  // 0-100 (higher = more critical)
  category: 'blocking' | 'functional' | 'quality' | 'style';
  shouldRetry: boolean;
  explanation: string;
}

export interface ErrorContext {
  directive: string;
  taskType: 'setup' | 'feature' | 'error' | 'explain';
  taskName: string;
  retryCount: number;
}

/**
 * Calculate error impact score
 * 
 * Higher scores = more critical = should block and retry
 * Lower scores = style/minor = can be ignored
 */
export function calculateErrorImpact(
  error: Violation,
  context: ErrorContext
): ErrorImpact {
  let score = 50;  // Base score
  let category: ErrorImpact['category'] = 'quality';
  let shouldRetry = true;
  let explanation = '';
  
  // 🎯 Rule 1: Build failure = ALWAYS blocking
  // Reason: Code won't run without successful build
  if (error.type === 'build_error') {
    score = 95;
    category = 'blocking';
    explanation = 'Build must pass for code to run';
    shouldRetry = true;
  }
  
  // 🎯 Rule 1.5: Search block not found = CRITICAL (LLM has outdated code)
  // This means LLM is trying to edit with old/hallucinated code
  // MUST force read_file and retry regardless of retry count
  else if (error.type === 'file_operation_failed' && error.message.includes('Search block not found')) {
    score = 100;  // ✅ Maximum priority
    category = 'blocking';
    explanation = 'LLM has outdated code - MUST read_file first';
    shouldRetry = true;  // ✅ ALWAYS retry
  }
  
  // 🎯 Rule 1.6: Other file operation failures (duplicate edits, etc.)
  else if (error.type === 'file_operation_failed') {
    score = 90;
    category = 'blocking';
    explanation = 'File operation failed - critical for task completion';
    shouldRetry = true;
  }
  
  // 🎯 Rule 2: Type errors - Context dependent
  else if (error.type === 'type_error') {
    // Minor type errors (unused variables, etc.)
    if (isMinorTypeError(error.message)) {
      score = 15;
      category = 'style';
      shouldRetry = context.retryCount === 0;  // Only retry once
      explanation = 'Unused code - does not affect functionality';
    }
    // Missing property/type mismatch = functional issue
    else if (error.message.match(/does not exist on type|Type .* is not assignable|Property .* is missing/i)) {
      score = 85;
      category = 'functional';
      shouldRetry = true;
      explanation = 'Type mismatch will cause runtime errors';
    }
    // Other type errors = moderate priority
    else {
      score = 60;
      category = 'quality';
      shouldRetry = true;
      explanation = 'Type safety issue - may cause problems';
    }
  }
  
  // 🎯 Rule 3: Lint errors = ALWAYS low priority
  // Reason: Code style doesn't affect functionality
  else if (error.type === 'lint_error') {
    score = 10;
    category = 'style';
    shouldRetry = false;
    explanation = 'Code style issue - does not affect functionality';
  }
  
  // 🎯 Rule 4: Environment errors = medium (should fix but not block)
  else if (error.type === 'environment_issue') {
    score = 70;
    category = 'quality';
    shouldRetry = context.retryCount < 2;  // Retry max 2 times
    explanation = 'Environment setup issue - fixable but not critical';
  }
  
  // 🎯 Rule 5: Import/module errors = high priority
  else if (error.message.match(/cannot find module|Module not found|import.*not found/i)) {
    score = 80;
    category = 'functional';
    shouldRetry = true;
    explanation = 'Missing module will cause runtime failure';
  }
  
  // 🎯 Rule 6: Severity-based adjustment
  if (error.severity === 'critical') {
    score = Math.min(score + 20, 100);
  } else if (error.severity === 'minor') {
    score = Math.max(score - 20, 0);
  }
  
  // 🎯 Rule 7: Directive relevance check
  // If error mentions something from the directive, it's more important
  const directiveLower = context.directive.toLowerCase();
  const errorLower = error.message.toLowerCase();
  
  const directiveKeywords = extractKeywords(directiveLower);
  const isRelevantToDirective = directiveKeywords.some(keyword => 
    errorLower.includes(keyword)
  );
  
  if (isRelevantToDirective) {
    score = Math.min(score + 15, 100);
    explanation += ' | Directly related to user requirement';
  }
  
  // 🎯 Rule 8: Retry count penalty
  // After multiple retries, lower priority (might be stuck)
  if (context.retryCount > 1) {
    score = Math.max(score - 15, 0);
    explanation += ` | Priority lowered (retry ${context.retryCount}/3)`;
    
    // ✅ Critical error types MUST be retried regardless of score
    const criticalTypes = [
      'missing_dependency',
      'import_error', 
      'build_error',
      'environment_error',
      'module_not_found',
      'edit_failed',  // ✅ EDIT failures must be retried (LLM needs to switch to FILE format)
      'file_operation_failed'  // ✅ CRITICAL: File edits failed (Search block, duplicate edits, etc.)
    ];
    const isCritical = criticalTypes.includes(error.type);
    
    // ✅ SPECIAL CASE: "Search block not found" NEVER gets retry penalty
    // This means LLM has outdated code - MUST retry to force read_file
    const isSearchBlockError = error.message.includes('Search block not found');
    if (isSearchBlockError) {
      score = 100;  // Override any score reduction
      shouldRetry = true;  // Force retry
      explanation = explanation.replace(' | Priority lowered (retry ', ' | CRITICAL: Outdated code (retry ');
    }
    
    // After 2 retries, only block on critical issues OR non-critical with score >= 80
    if (context.retryCount >= 2 && score < 80 && !isCritical) {
      shouldRetry = false;
      explanation += ' | Skipping to avoid infinite retry';
    } else if (context.retryCount >= 2 && isCritical) {
      // Keep retrying critical errors
      explanation += ' | Critical error - will retry despite low score';
    }
  }
  
  // 🎯 Rule 9: Error task type gets strict treatment
  // Reason: Task is specifically to fix errors
  if (context.taskType === 'error') {
    score = Math.min(score + 10, 100);
    explanation += ' | Error fix task requires strict validation';
  }
  
  return {
    score,
    category,
    shouldRetry,
    explanation
  };
}

/**
 * Check if a type error is "minor" (style issue, not functional)
 */
function isMinorTypeError(message: string): boolean {
  const minorPatterns = [
    /is declared but (?:its value is )?never (?:read|used)/i,
    /'.+' is defined but never used/i,
    /'.+' is declared but never used in the function/i,
    /missing return type/i,
    /implicitly has an 'any' type/i,
    /do not use '@ts-ignore'/i,
    /prefer-const/i,
    /no-explicit-any/i,
  ];
  
  return minorPatterns.some(pattern => pattern.test(message));
}

/**
 * Extract keywords from text for relevance matching
 */
function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  
  // UPPERCASE words (TOKEN, CROSS, API, etc.)
  const upperWords = text.match(/\b[A-Z][A-Z]+\b/g) || [];
  keywords.push(...upperWords.map(w => w.toLowerCase()));
  
  // Action words
  const actionWords = [
    'display', 'show', 'render', 'fetch', 'api', 'fail', 'error', 
    'fix', 'load', 'save', 'update', 'create', 'delete'
  ];
  keywords.push(...actionWords.filter(w => text.includes(w)));
  
  // Technical terms
  const techTerms = text.match(/\b(?:token|coin|price|data|component|function|service)\b/gi) || [];
  keywords.push(...techTerms.map(t => t.toLowerCase()));
  
  return [...new Set(keywords)];
}

/**
 * Prioritize violations by impact score
 * 
 * Returns violations sorted by score (highest first)
 * and optionally filtered by shouldRetry
 */
export function prioritizeViolations(
  violations: Violation[],
  context: ErrorContext,
  onlyRetryable: boolean = false
): Array<{ violation: Violation; impact: ErrorImpact }> {
  const withImpact = violations.map(v => ({
    violation: v,
    impact: calculateErrorImpact(v, context)
  }));
  
  // Sort by score (highest first)
  withImpact.sort((a, b) => b.impact.score - a.impact.score);
  
  // Filter if requested
  if (onlyRetryable) {
    return withImpact.filter(item => item.impact.shouldRetry);
  }
  
  return withImpact;
}

/**
 * Log error priority analysis for debugging
 */
export function logErrorPriority(
  violations: Violation[],
  context: ErrorContext
): void {
  const withImpact = prioritizeViolations(violations, context);
  
  console.log('\n📊 ERROR PRIORITY ANALYSIS:');
  console.log(`   Context: ${context.taskName} (${context.taskType})`);
  console.log(`   Retry: ${context.retryCount}/3\n`);
  
  withImpact.forEach(({ violation, impact }, index) => {
    const icon = impact.category === 'blocking' ? '🔥' :
                 impact.category === 'functional' ? '⚠️' :
                 impact.category === 'quality' ? '💡' : '✨';
    
    console.log(`${index + 1}. ${icon} [${impact.category.toUpperCase()}] Score: ${impact.score}/100`);
    console.log(`   Type: ${violation.type}`);
    console.log(`   Message: ${violation.message.split('\n')[0].substring(0, 100)}...`);
    console.log(`   ${impact.explanation}`);
    console.log(`   Retry: ${impact.shouldRetry ? '✅ YES' : '❌ NO'}\n`);
  });
  
  const retryable = withImpact.filter(item => item.impact.shouldRetry);
  const blocking = withImpact.filter(item => item.impact.category === 'blocking');
  
  console.log(`📌 Summary:`);
  console.log(`   Total: ${violations.length} | Retryable: ${retryable.length} | Blocking: ${blocking.length}\n`);
}

/**
 * Get top priority error (for focused retry)
 * 
 * Returns the highest priority error that should be retried,
 * or null if no retryable errors remain.
 */
export function getTopPriorityError(
  violations: Violation[],
  context: ErrorContext
): { violation: Violation; impact: ErrorImpact } | null {
  const retryable = prioritizeViolations(violations, context, true);
  
  if (retryable.length === 0) {
    return null;
  }
  
  return retryable[0];
}

