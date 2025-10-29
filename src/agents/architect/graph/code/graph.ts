import { StateGraph } from "@langchain/langgraph";
import { ArchitectGraphState } from "./state";
import { resolve, plan, execute, validate, dynamicValidate, evaluate, postProcess, learn } from "./nodes/index";

export function buildCodeGraph() {
  const graph = new StateGraph<ArchitectGraphState>({
    channels: {
      // Context & Input
      context: null as any,
      spec: null as any,
      
      // Dependencies
      deps: null as any,
      gitPort: null as any,
      
      // Mode
      codeMode: null as any,
      
      // Artifacts (from TaskArtifacts)
      prd: null as any,
      directive: null as any,
      design: null as any,
      code: null as any,
      codeHead: null as any,
      profile: null as any,
      
      // Execution
      planText: null as any,
      codePrompt: null as any,
      rawResponse: null as any,
      responseSection: null as any,
      files: null as any,
      filesToDelete: null as any,
      modifications: null as any,
      
      // Integrations & Validation
      requiredIntegrations: null as any,
      violations: null as any,
      retries: null as any,
      maxRetries: null as any,
      dynamicValidationResult: null as any,
      
      // Evaluation & Learning
      evaluationReport: null as any,
      learnings: null as any,
      
      // Results
      branch: null as any,
      filesWritten: null as any,
      reportFile: null as any,
    } as any,
  } as any);
  
  graph.addNode("resolve", resolve as any);
  graph.addNode("plan", plan as any);
  graph.addNode("execute", execute as any);
  graph.addNode("validate", validate as any);
  graph.addNode("dynamicValidate", dynamicValidate as any);
  graph.addNode("evaluate", evaluate as any);
  graph.addNode("postProcess", postProcess as any);
  graph.addNode("learn", learn as any);
  graph.addNode(
    "enforce",
    (async (s: any) => {
      const reasonHeader = "VIOLATION DETECTED\nRegenerate COMPLETE files. Preserve originals. No ellipsis. Minimal changes only.";
      return execute(s as ArchitectGraphState, reasonHeader);
    }) as any
  );

  graph.addEdge("__start__" as any, "resolve" as any);
  graph.addEdge("resolve" as any, "plan" as any);
  graph.addEdge("plan" as any, "execute" as any);
  graph.addEdge("execute" as any, "validate" as any);

  // Static validation first
  graph.addConditionalEdges(
    "validate" as any,
    ((s: ArchitectGraphState) => {
      const hasViolations = (s.violations && s.violations.length > 0) || !s.files.length;
      if (hasViolations && s.retries < s.maxRetries) {
        s.retries += 1;
        return "enforce";
      }
      return "postProcess";  // ✅ Static validation passed → Install dependencies first
    }) as any,
    { enforce: "enforce", postProcess: "postProcess" } as any
  );

  // After installing dependencies, run dynamic validation
  graph.addEdge("postProcess" as any, "dynamicValidate" as any);

  // Dynamic validation (build/lint/test) - now with dependencies installed
  graph.addConditionalEdges(
    "dynamicValidate" as any,
    ((s: ArchitectGraphState) => {
      const hasViolations = (s.violations && s.violations.length > 0);
      if (hasViolations && s.retries < s.maxRetries) {
        s.retries += 1;
        return "enforce";
      }
      return "evaluate";  // ✅ All validations passed → Evaluate
    }) as any,
    { enforce: "enforce", evaluate: "evaluate" } as any
  );

  graph.addEdge("enforce" as any, "execute" as any);
  graph.addEdge("evaluate" as any, "learn" as any);
  graph.addEdge("learn" as any, "__end__" as any);
  
  return (graph as any).compile();
}
