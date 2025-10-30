/**
 * ErrorAnalyzer
 * 
 * Analyzes validation errors and categorizes them into actionable subtasks.
 * Implements Task Decomposition (Divide & Conquer) strategy.
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Pure utility with no external dependencies
 * - Domain logic for error analysis
 */

import { ErrorSubtask, ErrorCategory } from "../state";

/**
 * Analyze violations and create prioritized subtasks
 */
export function analyzeErrors(violations: string[]): ErrorSubtask[] {
  if (!violations || violations.length === 0) {
    return [];
  }

  // Group errors by category
  const categorized = new Map<ErrorCategory, string[]>();
  
  for (const violation of violations) {
    const category = categorizeError(violation);
    const existing = categorized.get(category) || [];
    categorized.set(category, [...existing, violation]);
  }

  // Convert to subtasks with priorities
  const subtasks: ErrorSubtask[] = [];
  
  for (const [category, errors] of categorized.entries()) {
    subtasks.push({
      name: getCategoryName(category),
      priority: getCategoryPriority(category),
      errors,
      description: getCategoryDescription(category),
      category
    });
  }

  // Sort by priority (highest first)
  return subtasks.sort((a, b) => b.priority - a.priority);
}

/**
 * Categorize a single error message
 */
function categorizeError(error: string): ErrorCategory {
  const errorLower = error.toLowerCase();

  // Missing required files (highest priority)
  if (error.includes('MISSING REQUIRED FILE') || 
      error.includes('Could not resolve entry module') ||
      errorLower.includes('entry module') && errorLower.includes('resolve')) {
    return 'missing_files';
  }

  // Missing dependencies
  if (error.includes('MISSING MODULE') ||
      error.includes('Cannot find module') ||
      errorLower.includes('cannot find package') ||
      errorLower.includes('dependency') && errorLower.includes('not found')) {
    return 'missing_deps';
  }

  // Import errors
  if (errorLower.includes('cannot resolve') ||
      errorLower.includes('import') && errorLower.includes('failed') ||
      errorLower.includes('module resolution')) {
    return 'import_errors';
  }

  // TypeScript type errors
  if (error.match(/error TS\d+/) ||
      errorLower.includes('type error') ||
      errorLower.includes('implicitly has') && errorLower.includes('any')) {
    return 'type_errors';
  }

  // Configuration errors
  if (errorLower.includes('config') ||
      errorLower.includes('tsconfig') ||
      errorLower.includes('vite.config') ||
      errorLower.includes('configuration')) {
    return 'config_errors';
  }

  // Syntax errors
  if (errorLower.includes('syntaxerror') ||
      errorLower.includes('unexpected token') ||
      errorLower.includes('parsing error')) {
    return 'syntax_errors';
  }

  return 'other';
}

/**
 * Get human-readable category name
 */
function getCategoryName(category: ErrorCategory): string {
  const names: Record<ErrorCategory, string> = {
    missing_files: 'Missing Entry Files',
    missing_deps: 'Missing Dependencies',
    type_errors: 'TypeScript Type Errors',
    config_errors: 'Configuration Issues',
    import_errors: 'Import Path Errors',
    syntax_errors: 'Syntax Errors',
    other: 'Other Issues'
  };
  return names[category];
}

/**
 * Get priority for category (higher = more critical)
 */
function getCategoryPriority(category: ErrorCategory): number {
  const priorities: Record<ErrorCategory, number> = {
    missing_files: 100,      // Most critical - project can't even start
    missing_deps: 90,        // High - need packages to build
    config_errors: 80,       // High - build tools need config
    import_errors: 70,       // Medium-high - affects module resolution
    syntax_errors: 60,       // Medium - prevents compilation
    type_errors: 50,         // Medium-low - can sometimes be ignored
    other: 10                // Low - miscellaneous
  };
  return priorities[category];
}

/**
 * Get actionable description for category
 */
function getCategoryDescription(category: ErrorCategory): string {
  const descriptions: Record<ErrorCategory, string> = {
    missing_files: 'Create missing required files (index.html, main entry points, etc.)',
    missing_deps: 'Add missing packages to package.json and install dependencies',
    type_errors: 'Fix TypeScript type errors by adding type definitions or @types/* packages',
    config_errors: 'Fix configuration files (tsconfig.json, vite.config.ts, etc.)',
    import_errors: 'Correct import paths to match actual file structure',
    syntax_errors: 'Fix syntax errors in source files',
    other: 'Address miscellaneous issues'
  };
  return descriptions[category];
}

/**
 * Format subtask into enforcement reason for LLM
 */
export function formatSubtaskPrompt(subtask: ErrorSubtask, index: number, total: number): string {
  return `
🎯 FOCUSED SUBTASK ${index}/${total}: ${subtask.name}

${subtask.description}

ERRORS TO FIX IN THIS SUBTASK (${subtask.errors.length} error${subtask.errors.length > 1 ? 's' : ''}):

${subtask.errors.map((err, i) => `${i + 1}. ${err}`).join('\n\n')}

⚠️ CRITICAL INSTRUCTIONS:
- Focus EXCLUSIVELY on these ${subtask.errors.length} error${subtask.errors.length > 1 ? 's' : ''}
- DO NOT try to fix any other issues
- After you fix these, we'll move to the next subtask
- Create/modify ONLY the files necessary for these specific errors

📋 STRATEGY:
1. Analyze EACH error above carefully
2. Identify what files/changes are needed
3. Make MINIMAL changes to fix ONLY these errors
4. Verify your output addresses ALL ${subtask.errors.length} error${subtask.errors.length > 1 ? 's' : ''} listed

${index < total ? `\n✅ After completing this subtask, ${total - index} more subtask${total - index > 1 ? 's' : ''} remain.` : '\n🏁 This is the FINAL subtask!'}
`;
}

/**
 * Check if current attempt made progress on subtask
 */
export function hasSubtaskProgress(
  subtask: ErrorSubtask,
  previousViolations: string[],
  currentViolations: string[]
): boolean {
  // Count how many errors from this subtask are still present
  const previousCount = previousViolations.filter(v => 
    subtask.errors.some(err => v.includes(err) || err.includes(v))
  ).length;
  
  const currentCount = currentViolations.filter(v =>
    subtask.errors.some(err => v.includes(err) || err.includes(v))
  ).length;
  
  // Progress if error count decreased
  return currentCount < previousCount;
}

