import { HumanMessage } from "@langchain/core/messages";
import { createModel } from "./architect/model";

/**
 * DocAgent:
 * Generates API or technical documentation updates
 * based on code changes (diffs).
 */
const modelInfo = createModel('doc');
const model = modelInfo.model;

export async function docAgent(diff: string) {
  const prompt = `
You are a documentation writer.
Generate documentation updates based on the code diff below.
Focus on function signatures, behavioral changes,
and newly added or removed parameters.

Code diff:
---
${diff}
  `;
  const response = await model.invoke([new HumanMessage(prompt)]);
  return typeof response.content === 'string' 
    ? response.content 
    : JSON.stringify(response.content);
}
