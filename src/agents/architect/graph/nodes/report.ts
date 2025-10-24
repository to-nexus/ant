import { ArchitectGraphState } from "../state";
import { generateReport } from "../../utils";

export function report(state: ArchitectGraphState): { reportFile: string } {
  const report = `# Code Generation Report (Graph)
**Project:** ${state.context.project}
**Feature:** ${state.context.featureFolder || 'default'}
**Date:** ${new Date().toISOString()}

## Plan (truncated)
${state.planText.substring(0, 1200)}...

## Files (${state.files.length})
${state.files.map(f => `- ${f.path}`).join('\n')}
`;
  const reportFile = generateReport("code-generation", state.context, report);
  return { reportFile };
}
