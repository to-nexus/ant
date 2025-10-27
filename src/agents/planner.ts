import { LLMClient } from "../core/ports";

/**
 * PlannerAgent:
 * Summarizes project progress, issues, and next steps
 * using issue tracker data and commit logs.
 */
export async function plannerAgent(issues: string, commits: string, deps: { llm: LLMClient }) {
  const prompt = `
You are an AI sprint planner.
Given the current issue list and commit logs,
summarize the sprint status including:
- Completed tasks
- In progress
- Risks and blockers
- Next actions

Issues:
${issues}

Commits:
${commits}
  `;
  const response = await deps.llm.invoke([{ role: "user", content: prompt }]);
  return response;
}
