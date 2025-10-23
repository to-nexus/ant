import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage } from "@langchain/core/messages";
import { queryMemory } from "../memory";

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
  const response = await model.invoke([new HumanMessage(prompt)]);
  return response.content;
}
