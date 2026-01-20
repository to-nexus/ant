import { LLMClient } from "../core/ports";
import { executeSimpleAgent, AgentDeps } from "./common/workflow";

/**
 * Reviewer Agent
 * 
 * Reviews code changes (PR diffs) and provides feedback on:
 * - Code quality issues
 * - Security vulnerabilities
 * - Performance concerns
 * - Style violations
 * - Best practices
 * 
 * Current Status: 🚧 Simplified implementation
 * TODO: Implement full graph structure with:
 *   - resolve: Load PR context
 *   - analyze: Deep code analysis
 *   - suggest: Generate improvements
 *   - validate: Check review quality
 *   - learn: Store review patterns
 * 
 * @param prDiff - Pull request diff to review
 * @param project - Project name
 * @param deps - Dependencies (memory, llm)
 * @returns Review feedback
 */
export async function reviewerAgent(
  prDiff: string,
  project: string,
  deps: AgentDeps & { llm: LLMClient }
) {
  return await executeSimpleAgent({
    agentJob: 'review',
    project,
    input: prDiff,
    deps,
    execute: async (input, context, deps) => {
      const { llm } = deps as { llm: LLMClient };
      
      const prompt = `
You are a senior software reviewer.

Project: ${project}

${context.memory ? `Relevant context:\n${context.memory}\n` : ''}

Review the following PR diff and summarize risks, improvements, and style issues.

---
${input}
      `;
      
      const response = await llm.invoke([{ role: "user", content: prompt }]);
      return response;
    }
  });
}
