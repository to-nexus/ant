import { ChatAnthropic } from "@langchain/anthropic";
import { queryMemory } from "../memory/chroma";

const model = new ChatAnthropic({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  modelName: "claude-3-5-sonnet"
});

export async function reviewerAgent(prDiff: string, project: string) {
  const context = await queryMemory("code review guidelines", project);
  const prompt = `
You are a senior software reviewer.
Project: ${project}
Relevant context:
${context}

Review the following PR diff and summarize risks, improvements, and style issues.
---
${prDiff}
  `;
  const response = await model.invoke([{ role: "user", content: prompt }]);
  return response.content;
}
