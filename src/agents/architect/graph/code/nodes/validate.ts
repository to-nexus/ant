import { ArchitectGraphState } from "../../state";
import { loadProjectConfig } from "../../../../../core/config";

/**
 * Validate generated code against guardrails:
 * - Check for ellipsis/skipped code patterns
 * - Check for excessive deletion (< 70% of original lines)
 */
export async function validate(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const violations: string[] = [];
  const forbiddenEllipsis = /\.{3}|\/\/\s*\.\.\.|\{\s*\/\*.*\.\.\..*\*\/\s*\}/s;

  const config = state.context.config || await loadProjectConfig(state.context.project);
  const git = state.deps?.git ? state.deps.git : null as any;

  for (const f of state.files) {
    // Check for forbidden ellipsis patterns
    if (forbiddenEllipsis.test(f.content)) {
      violations.push(`${f.path}: contains ellipsis or skipped code`);
    }

    // Check for excessive deletion (if modifying existing file)
    try {
      const original = await git.show([`HEAD:${f.path}`]).catch(() => null);
      if (original) {
        const origLines = original.split('\n').length;
        const newLines = f.content.split('\n').length;
        
        if (newLines < Math.floor(origLines * 0.7)) {
          violations.push(`${f.path}: excessive deletion (${newLines}/${origLines} lines)`);
        }
      }
    } catch {}
  }

  return { ...state, violations };
}

