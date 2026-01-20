import { LLMClient } from "../core/ports";
import { executeSimpleAgent, AgentDeps } from "./common/workflow";

/**
 * Planner Agent Input
 */
export interface PlannerInput {
  issues: string;
  commits: string;
}

/**
 * Planner Agent
 * 
 * Summarizes project progress and plans next steps:
 * - Analyzes issue tracker data
 * - Reviews commit history
 * - Identifies risks and blockers
 * - Suggests priorities
 * 
 * Current Status: 🚧 Simplified implementation
 * TODO: Implement full graph structure with:
 *   - resolve: Load sprint context
 *   - analyze: Analyze progress and velocity
 *   - prioritize: Rank tasks by importance
 *   - schedule: Create sprint plan
 *   - learn: Store planning patterns
 * 
 * @param input - Issues and commits
 * @param project - Project name
 * @param deps - Dependencies (memory, llm)
 * @returns Sprint plan
 */
export async function plannerAgent(
  input: PlannerInput,
  project: string,
  deps: AgentDeps & { llm: LLMClient }
) {
  return await executeSimpleAgent({
    agentJob: 'plan',
    project,
    input,
    deps,
    execute: async (input, context, deps) => {
      const { llm } = deps as { llm: LLMClient };
      
      const prompt = `
You are an AI sprint planner.

Project: ${project}

${context.memory ? `Relevant context:\n${context.memory}\n` : ''}

Given the current issue list and commit logs,
summarize the sprint status including:
- Completed tasks
- In progress
- Risks and blockers
- Next actions

Issues:
${input.issues}

Commits:
${input.commits}
      `;
      
      const response = await llm.invoke([{ role: "user", content: prompt }]);
      return response;
    }
  });
}
