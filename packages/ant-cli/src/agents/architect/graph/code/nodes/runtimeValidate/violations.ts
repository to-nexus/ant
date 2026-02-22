/**
 * Functions for converting validation results to violations
 */

import { Violation } from "../../state";
import { RuntimeValidationResult } from "./types";

/**
 * Convert diagnostics to structured violations
 */
export function convertDiagnosesToViolations(result: RuntimeValidationResult): Violation[] {
  const violations: Violation[] = [];
  
  // ✅ Use structured diagnostics if available
  if (result.diagnoses && result.diagnoses.length > 0) {
    for (const diagnosis of result.diagnoses) {
      violations.push({
        type: diagnosis.type as any,
        severity: diagnosis.severity as any,
        message: `${diagnosis.message}\n\nRoot Cause: ${diagnosis.rootCause}\n\nSuggested Actions:\n${diagnosis.suggestedActions.map(a => `• ${a}`).join('\n')}`,
        suggestedFix: diagnosis.suggestedActions.join('\n'),
        isRetryable: diagnosis.isRetryable,
      });
    }
  }
  
  // ⚠️ CRITICAL: ALWAYS check buildErrors/typeErrors/lintErrors
  // Even if we have diagnoses, some errors might not have diagnosis patterns yet
  // (e.g. PostCSS config errors, new error types)
  
  // Track which errors are already covered by diagnoses to avoid duplicates
  const diagnosedMessages = new Set(
    result.diagnoses?.map(d => d.message) || []
  );
  
  // Build errors (highest priority - often missing files or deps)
  if (result.buildErrors && result.buildErrors.length > 0) {
    for (const error of result.buildErrors) {
      // Skip if already covered by diagnosis
      if (diagnosedMessages.has(error)) continue;
      
      // Check for missing entry file
      if (error.includes('MISSING REQUIRED FILE') || error.includes('Could not resolve entry module')) {
        const fileMatch = error.match(/index\.html|main\.tsx?|main\.jsx?|index\.tsx?|index\.jsx?/);
        violations.push({
          type: 'missing_file',
          severity: 'critical',
          file: fileMatch ? fileMatch[0] : 'entry file',
          message: error,
          suggestedFix: 'Create the missing entry file',
          isRetryable: false
        });
      }
      // Check for missing module/dependency
      else if (error.includes('Cannot find module') || error.includes('MISSING MODULE')) {
        const moduleMatch = error.match(/["'](.+?)["']/);
        violations.push({
          type: 'missing_dependency',
          severity: 'critical',
          module: moduleMatch ? moduleMatch[1] : 'unknown',
          message: error,
          suggestedFix: 'Install missing dependency or create missing file',
          isRetryable: false
        });
      }
      // Other build errors
      else {
        violations.push({
          type: 'build_error',
          severity: 'major',
          message: error,
          suggestedFix: 'Fix build configuration or code',
          isRetryable: true  // ✅ Make it retryable so LLM can try to fix
        });
      }
    }
  }
  
  // Type errors (only if not already covered by diagnoses)
  if (result.typeErrors && result.typeErrors.length > 0) {
    const uncoveredTypeErrors = result.typeErrors.filter(e => !diagnosedMessages.has(e));
    if (uncoveredTypeErrors.length > 0) {
      // ✅ Group errors by file for better context
      const errorsByFile = new Map<string, string[]>();
      const errorsWithoutFile: string[] = [];
      
      uncoveredTypeErrors.forEach(error => {
        // Parse: "src/path/file.ts(line,col): error TS1234: message"
        const fileMatch = error.match(/^(.+?)\(\d+,\d+\):/);
        if (fileMatch) {
          const file = fileMatch[1];
          if (!errorsByFile.has(file)) {
            errorsByFile.set(file, []);
          }
          errorsByFile.get(file)!.push(error);
        } else {
          errorsWithoutFile.push(error);
        }
      });
      
      // ✅ Create separate violation for each file (better for LLM to focus)
      errorsByFile.forEach((errors, file) => {
        // ✅ Extract unique error codes for this file
        const errorCodes = new Set<string>();
        errors.forEach(error => {
          const codeMatch = error.match(/error (TS\d+):/);
          if (codeMatch) {
            errorCodes.add(codeMatch[1]);
          }
        });
        
        const codesInfo = errorCodes.size > 0 
          ? ` [${Array.from(errorCodes).join(', ')}]` 
          : '';
        
        violations.push({
          type: 'type_error',
          severity: 'major',
          file, // ⭐ Specific file for LLM to target
          message: `TypeScript errors in ${file}${codesInfo}:\n\n${errors.join('\n')}`,
          suggestedFix: `Fix TypeScript errors in ${file}`,
          isRetryable: true,
          // ✅ Add metadata for potential future use
          metadata: {
            errorCount: errors.length,
            errorCodes: Array.from(errorCodes)
          }
        });
      });
      
      // ✅ If there are errors without file info, group them separately
      if (errorsWithoutFile.length > 0) {
        violations.push({
          type: 'type_error',
          severity: 'major',
          message: `TypeScript errors (general):\n\n${errorsWithoutFile.join('\n')}`,
          suggestedFix: 'Fix TypeScript errors',
          isRetryable: true
        });
      }
    }
  }
  
  // Import errors (from type errors or build errors)
  const importErrors = [...(result.typeErrors || []), ...(result.buildErrors || [])]
    .filter(e => e.includes("Cannot find module") || e.includes("Module not found"))
    .filter(e => !diagnosedMessages.has(e));
  if (importErrors.length > 0) {
    violations.push({
      type: 'import_error',
      severity: 'major',
      message: `Import errors (${importErrors.length} total):\n${importErrors.slice(0, 3).join('\n')}`,
      suggestedFix: 'Fix import paths or install missing dependencies',
      isRetryable: false
    });
  }
  
  // Test errors
  if (result.testErrors && result.testErrors.length > 0) {
    const uncoveredTestErrors = result.testErrors.filter(e => !diagnosedMessages.has(e));
    if (uncoveredTestErrors.length > 0) {
      violations.push({
        type: 'build_error',
        severity: 'major',
        message: `Test failures (${uncoveredTestErrors.length} total):\n\n${uncoveredTestErrors.slice(0, 10).join('\n')}`,
        suggestedFix: 'Fix failing tests. Prefer fixing test expectations over modifying application source code unless the test exposes a genuine bug.',
        isRetryable: true
      });
    }
  }
  
  // Lint errors (lowest priority, only if not already covered)
  if (result.lintErrors && result.lintErrors.length > 0) {
    const uncoveredLintErrors = result.lintErrors.filter(e => !diagnosedMessages.has(e));
    if (uncoveredLintErrors.length > 0) {
      violations.push({
        type: 'lint_error',
        severity: 'minor',
        message: `ESLint errors (${uncoveredLintErrors.length} total) - LOW PRIORITY`,
        suggestedFix: 'Fix lint errors (but prioritize build/type errors first)',
        isRetryable: true
      });
    }
  }
  
  return violations;
}

