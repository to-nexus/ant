/**
 * Validation Policy System
 * 
 * Determines appropriate validation level based on task context
 * to prevent minor issues from blocking valid solutions.
 */

export type TaskType = 'setup' | 'feature' | 'error';

export interface ValidationLevel {
  type: 'full' | 'functional' | 'build-only' | 'skip';
  ignoreWarnings: boolean;
  ignoreLintErrors: boolean;
  allowMinorTypeErrors: boolean;
  description: string;
}

export interface ValidationContext {
  taskType: TaskType;
  taskName: string;
  retryCount: number;
  isLastTask: boolean;
  hasPreviousAttempts: boolean;
}

/**
 * Determine appropriate validation level based on context
 * 
 * Priority Rules:
 * 1. Retry attempts → Use build-only (avoid blocking on style issues)
 * 2. Final verification → Functional only (build + basic validation)
 * 3. Error tasks → Full validation (strict)
 * 4. Feature tasks → Build-only (lenient)
 */
export function determineValidationLevel(context: ValidationContext): ValidationLevel {
  // 🎯 Rule 1: Retry attempts should be lenient
  // Reason: LLM already tried to fix core issue, don't block on minor style issues
  if (context.retryCount > 0) {
    return {
      type: 'build-only',
      ignoreWarnings: true,
      ignoreLintErrors: true,
      allowMinorTypeErrors: true,
      description: `Retry attempt ${context.retryCount} - lenient validation to avoid blocking on style issues`
    };
  }
  
  // 🎯 Rule 2: Final verification tasks should focus on functionality
  // Reason: These tasks are for integration, not for fixing unused variables
  if (context.isLastTask && 
      (context.taskName.toLowerCase().includes('verification') ||
       context.taskName.toLowerCase().includes('integration') ||
       context.taskName.toLowerCase().includes('final'))) {
    return {
      type: 'functional',
      ignoreWarnings: true,
      ignoreLintErrors: true,
      allowMinorTypeErrors: true,
      description: 'Final task - focus on build success and functionality, ignore style issues'
    };
  }
  
  // 🎯 Rule 3: Error tasks need strict validation
  // Reason: These tasks explicitly fix errors, should validate correctly
  if (context.taskType === 'error') {
    return {
      type: 'full',
      ignoreWarnings: false,
      ignoreLintErrors: false,
      allowMinorTypeErrors: false,
      description: 'Error fix task - strict validation to ensure errors are properly fixed'
    };
  }
  
  // 🎯 Rule 4: Feature tasks should be lenient
  // Reason: Focus on functionality, not code style
  if (context.taskType === 'feature') {
    return {
      type: 'build-only',
      ignoreWarnings: true,
      ignoreLintErrors: true,
      allowMinorTypeErrors: true,
      description: 'Feature task - lenient validation, focus on build success'
    };
  }
  
  // 🎯 Rule 5: Setup tasks need functional validation
  // Reason: Infrastructure tasks should have working builds
  if (context.taskType === 'setup') {
    return {
      type: 'functional',
      ignoreWarnings: true,
      ignoreLintErrors: true,
      allowMinorTypeErrors: false,
      description: 'Setup task - functional validation, allow lint/warning issues'
    };
  }
  
  // Default: build-only (lenient)
  return {
    type: 'build-only',
    ignoreWarnings: true,
    ignoreLintErrors: true,
    allowMinorTypeErrors: true,
    description: 'Default - lenient validation focusing on build success'
  };
}

/**
 * Check if an error should be considered "minor" based on its message
 */
export function isMinorTypeError(errorMessage: string): boolean {
  const minorPatterns = [
    // Unused variables/imports
    /is declared but (?:its value is )?never (?:read|used)/i,
    /'.+' is defined but never used/i,
    
    // Unused parameters
    /'.+' is declared but never used in the function/i,
    
    // Missing return type (style issue, not functional)
    /missing return type/i,
    
    // Implicit any (works at runtime, just not type-safe)
    /implicitly has an 'any' type/i,
    
    // @ts-ignore comments
    /do not use '@ts-ignore'/i,
  ];
  
  return minorPatterns.some(pattern => pattern.test(errorMessage));
}

/**
 * Filter errors based on validation level
 */
export function filterErrorsByLevel(
  errors: Array<{type: string; severity?: string; message: string}>,
  level: ValidationLevel
): Array<{type: string; severity?: string; message: string}> {
  return errors.filter(error => {
    // Always keep build errors (blocking)
    if (error.type === 'build_error') {
      return true;
    }
    
    // Filter by validation level settings
    if (level.ignoreWarnings && error.severity === 'warning') {
      return false;
    }
    
    if (level.ignoreLintErrors && (error.type === 'lint' || error.type === 'lint_error')) {
      return false;
    }
    
    if (level.allowMinorTypeErrors && 
        error.type === 'type_error' && 
        isMinorTypeError(error.message)) {
      return false;
    }
    
    return true;
  });
}

/**
 * Log validation level decision for debugging
 */
export function logValidationLevel(level: ValidationLevel, context: ValidationContext): void {
  console.log(`\n📋 Validation Level: ${level.type.toUpperCase()}`);
  console.log(`   Task: ${context.taskName} (${context.taskType})`);
  console.log(`   Retry: ${context.retryCount}/3`);
  console.log(`   Reason: ${level.description}`);
  
  const settings: string[] = [];
  if (level.ignoreWarnings) settings.push('⏭️  Ignore warnings');
  if (level.ignoreLintErrors) settings.push('⏭️  Ignore lint errors');
  if (level.allowMinorTypeErrors) settings.push('⏭️  Allow minor type errors');
  
  if (settings.length > 0) {
    console.log(`\n   Settings:`);
    settings.forEach(s => console.log(`   ${s}`));
  }
  console.log('');
}

