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
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    state.deps.workflowUpdate.enterNode(state._httpTaskId, 'validate');
  }
  
  const violations: Violation[] = [];
  // ✅ Only detect ellipsis in comments or standalone (not spread/rest operators)
  // Matches:
  //   - // ... or /* ... */ (comments)
  //   - Standalone ... without identifier (line has only "...")
  // Allows:
  //   - ...rest, ...args, ...props (spread/rest operators)
  //   - { ...obj } (object spread)
  //   - [...arr] (array spread)
  const forbiddenEllipsis = /\/\/\s*\.{3}|\/\*\s*\.{3}\s*\*\/|^\s*\.{3}\s*$/m;

  const config = state.context.config;
  const git = state.deps?.git ? state.deps.git : null as any;

  // ✅ IMPROVED: Check if no files generated
  // But don't fail immediately - check if files already exist in working directory
  if (!state.files || state.files.length === 0) {
    // Check if this is a verification/completion task where files might already exist
    const gitPort = state.deps?.git;
    if (gitPort) {
      try {
        const p = await import('path');
        const repoRoot = await gitPort.getRepoRoot();
        const workDir = state.context.workDir || '.';
        const resolvedPath = p.resolve(repoRoot, workDir);
        
        // Check if source files already exist in working directory
        const commonSourceDirs = ['src', 'lib', 'app', 'components'];
        const commonSourceExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
        
        let hasExistingSourceFiles = false;
        for (const dir of commonSourceDirs) {
          const dirPath = p.join(workDir, dir);
          const exists = await gitPort.fileExists(dirPath);
          if (exists) {
            // Directory exists, assume it has source files
            hasExistingSourceFiles = true;
            break;
          }
        }
        
        if (hasExistingSourceFiles) {
          // Files already exist, LLM determined no changes needed
          // Continue to runtimeValidate to check if there are actual errors
          console.log('ℹ️  No files generated, but source files already exist - proceeding to validation');
          return { ...state, violations };
        }
      } catch (error) {
        // If check fails, fall through to original logic
        console.warn('⚠️  Failed to check existing files:', error);
      }
    }
    
    // Original logic: no files generated and none exist
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
    // ✅ Only check ellipsis in source code files (not documentation)
    const isSourceCode = /\.(ts|tsx|js|jsx|py|java|go|rs|cpp|c|h)$/i.test(f.path);
    
    // Check for forbidden ellipsis patterns (only in source code)
    if (isSourceCode && forbiddenEllipsis.test(f.content)) {
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

