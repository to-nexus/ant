import { DesignGraphState } from "../state";

export async function plan(state: DesignGraphState) {
  const model = state.deps?.llm;
  if (!model) {
    throw new Error("LLMClient not provided in design graph state");
  }
  let directiveAnalysis = '';
  if (state.directive) {
    const analysisPrompt = `You are analyzing a human directive for system design.\n\nDirective:\n${state.directive}\n\nProvide a brief analysis (3-5 sentences): key requirements, patterns, constraints, assumptions.`;
    const analysisResponse = await model.invoke([{ role: 'user', content: analysisPrompt }]);
    directiveAnalysis = analysisResponse;
  }

  const prompt = state.directive ? `You are reviewing and revising a system design based on human feedback.\n\nPrevious Design:\n${state.previousDesign}\n\nFeedback (highest priority):\n${state.directive}\n\nYour analysis:\n${directiveAnalysis}\n\nPRD:\n${state.spec}\n\nTask: Produce an updated design addressing all feedback, preserving good parts, and listing file-level implementation plan (paths and changes).` : `You are a senior software architect.\nProject: ${state.context.project}\n\nPRD:\n${state.spec}\n\nCreate a comprehensive system design with architecture overview, components, data flow, APIs/DB as needed, integration points, and a file-level implementation plan (exact paths, new vs modify, brief rationale).`;

  const response = await model.invoke([{ role: 'user', content: prompt }]);
  const designMarkdown = response;
  return { directiveAnalysis, designMarkdown };
}
