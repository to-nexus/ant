import { subagentMaxReportChars } from './config';
import type { SubagentPromptRenderer } from './types';

export const EXPLORE_SYSTEM_TEMPLATE = 'jobs/shared/subagent/explore-system';

export async function buildChildMessages(
  promptBuilder: SubagentPromptRenderer,
  params: { goal: string; hints?: string[] },
): Promise<Array<{ role: string; content: string }>> {
  const system = await promptBuilder.render(EXPLORE_SYSTEM_TEMPLATE, {
    goal: params.goal,
    hints: params.hints && params.hints.length > 0 ? params.hints : undefined,
    reportBudgetChars: subagentMaxReportChars(),
  });
  const hintLines = params.hints && params.hints.length > 0
    ? `\n\nStarting points suggested by the requester:\n${params.hints.map((h) => `- ${h}`).join('\n')}`
    : '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Investigation goal:\n${params.goal}${hintLines}` },
  ];
}
