import { subagentMaxReportChars, subagentMaxRounds } from './config';
import type { SubagentPromptRenderer } from './types';

export const EXPLORE_SYSTEM_TEMPLATE = 'jobs/shared/subagent/explore-system';

export async function buildChildMessages(
  promptBuilder: SubagentPromptRenderer,
  params: { goal: string; hints?: string[]; toolNames?: string[] },
): Promise<Array<{ role: string; content: string }>> {
  const system = await promptBuilder.render(EXPLORE_SYSTEM_TEMPLATE, {
    goal: params.goal,
    hints: params.hints && params.hints.length > 0 ? params.hints : undefined,
    reportBudgetChars: subagentMaxReportChars(),
    maxRounds: subagentMaxRounds(),
    // The child's ACTUAL tool inventory — a parent-authored goal may name
    // tools from the parent's wider set; the declared list is authoritative.
    toolNames:
      params.toolNames && params.toolNames.length > 0 ? params.toolNames.join(', ') : undefined,
  });
  const hintLines = params.hints && params.hints.length > 0
    ? `\n\nStarting points suggested by the requester:\n${params.hints.map((h) => `- ${h}`).join('\n')}`
    : '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Investigation goal:\n${params.goal}${hintLines}` },
  ];
}
