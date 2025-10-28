import { HumanMessage } from "@langchain/core/messages";
import { MemoryPort, LLMClient } from "../core/ports";

export async function reviewerAgent(prDiff: string, project: string, deps: { memory: MemoryPort; llm: LLMClient }) {
  const results = await deps.memory.query("code review guidelines", project, { k: 5 });
  const context = results.map(r => r.content).join("\n\n");
  const prompt = `
You are a senior software reviewer.
Project: ${project}
Relevant context:
${context}

Review the following PR diff and summarize risks, improvements, and style issues.
---
${prDiff}
  `;
  const response = await deps.llm.invoke([{ role: "user", content: prompt }]);
  return response;
}
