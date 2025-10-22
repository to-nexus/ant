import { ChatOpenAI } from "@langchain/openai";

/**
 * PlannerAgent:
 * Summarizes project progress, issues, and next steps
 * using issue tracker data and commit logs.
 */
const model = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "gpt-4o",
  temperature: 0.2
});

export async function plannerAgent(issues: string, commits: string) {
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
  const response = await model.invoke([{ role: "user", content: prompt }]);
  return response.content;
}
