import { ArchitectGraphState } from "../state";
import { getGitInstance, getFileFromHead, loadProjectGitConfig } from "../../../../tools/git";

export async function validate(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const violations: string[] = [];
  const forbiddenEllipsis = /\.{3}|\/\/\s*\.\.\.|\{\s*\/\*.*\.\.\..*\*\/\s*\}/s;

  const config = state.context.config || await loadProjectGitConfig(state.context.project);
  const git = await getGitInstance(state.context.project, config);

  for (const f of state.files) {
    try {
      const original = await getFileFromHead(git, f.path);
      if (original) {
        const origLines = original.split('\n').length;
        const newLines = f.content.split('\n').length;
        if (newLines < Math.floor(origLines * 0.7)) {
          violations.push(`${f.path}: excessive deletion (${newLines}/${origLines} lines)`);
        }
      }
    } catch {}
    if (forbiddenEllipsis.test(f.content)) {
      violations.push(`${f.path}: contains ellipsis or skipped code`);
    }
  }

  return { ...state, violations };
}
