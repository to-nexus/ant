import { ArchitectGraphState, Violation } from "../state";

/**
 * Validate generated code against guardrails:
 * - Check for ellipsis/skipped code patterns
 * - Check for excessive deletion (< 70% of original lines)
 * - Check if files were generated
 * 
 * ✅ Returns structured Violation objects for better analysis
 */
export async function validate(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const violations: Violation[] = [];
  const forbiddenEllipsis = /\.{3}|\/\/\s*\.\.\.|\{\s*\/\*.*\.\.\..*\*\/\s*\}/s;

  const config = state.context.config;
  const git = state.deps?.git ? state.deps.git : null as any;

  // Check if no files generated
  if (!state.files || state.files.length === 0) {
    violations.push({
      type: 'no_files',
      severity: 'critical',
      message: 'No files were generated. Please create the necessary files based on the requirements.',
      suggestedFix: 'Generate required files',
      isRetryable: true
    });
    return { ...state, violations };
  }

  for (const f of state.files) {
    // Check for forbidden ellipsis patterns
    if (forbiddenEllipsis.test(f.content)) {
      violations.push({
        type: 'ellipsis',
        severity: 'major',
        file: f.path,
        message: `File contains ellipsis or skipped code (...)`,
        suggestedFix: 'Regenerate section without ellipsis',
        isRetryable: true  // ✅ 재시도로 해결 가능
      });
    }

    // Check for excessive deletion (if modifying existing file)
    try {
      const original = await git.show([`HEAD:${f.path}`]).catch(() => null);
      if (original) {
        const origLines = original.split('\n').length;
        const newLines = f.content.split('\n').length;
        
        if (newLines < Math.floor(origLines * 0.7)) {
          violations.push({
            type: 'excessive_deletion',
            severity: 'major',
            file: f.path,
            message: `Excessive deletion detected (${newLines}/${origLines} lines, ${Math.round(newLines/origLines*100)}%)`,
            suggestedFix: 'Regenerate file with full content',
            isRetryable: true  // ✅ 재시도로 해결 가능
          });
        }
      }
    } catch {}
  }

  return { ...state, violations };
}

