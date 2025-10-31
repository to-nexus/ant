import { LLMClient } from "../core/ports";
import { executeSimpleAgent, AgentDeps } from "./common/workflow";

/**
 * Doc Agent
 * 
 * Generates and updates documentation based on code changes:
 * - API documentation
 * - Function signatures
 * - Behavioral changes
 * - Migration guides
 * 
 * Current Status: 🚧 Simplified implementation
 * TODO: Implement full graph structure with:
 *   - resolve: Load existing docs
 *   - analyze: Detect documentation needs
 *   - generate: Create/update docs
 *   - validate: Check doc quality
 *   - learn: Store documentation patterns
 * 
 * @param diff - Code diff to document
 * @param project - Project name
 * @param deps - Dependencies (memory, llm)
 * @returns Generated documentation
 */
export async function docAgent(
  diff: string,
  project: string,
  deps: AgentDeps & { llm: LLMClient }
) {
  return await executeSimpleAgent({
    agentType: 'doc',
    project,
    input: diff,
    deps,
    execute: async (input, context, deps) => {
      const { llm } = deps as { llm: LLMClient };
      
      const prompt = `
You are a documentation writer.

Project: ${project}

${context.memory ? `Relevant context:\n${context.memory}\n` : ''}

Generate documentation updates based on the code diff below.
Focus on function signatures, behavioral changes,
and newly added or removed parameters.

Code diff:
---
${input}
      `;
      
      const response = await llm.invoke([{ role: "user", content: prompt }]);
      return response;
    }
  });
}
