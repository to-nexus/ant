import { HumanMessage } from "@langchain/core/messages";
import { LLMClient } from "../core/ports";

/**
 * DocAgent:
 * Generates API or technical documentation updates
 * based on code changes (diffs).
 */
export async function docAgent(diff: string, deps: { llm: LLMClient }) {
  const prompt = `
You are a documentation writer.
Generate documentation updates based on the code diff below.
Focus on function signatures, behavioral changes,
and newly added or removed parameters.

Code diff:
---
${diff}
  `;
  const response = await deps.llm.invoke([ { role: "user", content: prompt } ]);
  return response;
}
