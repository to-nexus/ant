import { StateGraph } from "@langchain/langgraph";
import { ArchitectGraphState } from "./state";
import { resolve, plan, execute, validate, learn } from "./nodes/index";

export function buildCodeGraph() {
  const graph = new StateGraph<ArchitectGraphState>({} as any);
  
  graph.addNode("resolve", resolve as any);
  graph.addNode("plan", plan as any);
  graph.addNode("execute", execute as any);
  graph.addNode("validate", validate as any);
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

  graph.addConditionalEdges(
    "validate" as any,
    ((s: ArchitectGraphState) => {
      const hasViolations = (s.violations && s.violations.length > 0) || !s.files.length;
      if (hasViolations && s.retries < s.maxRetries) {
        s.retries += 1;
        return "enforce";
      }
      return "learn";  // ✅ Success → Extract learnings
    }) as any,
    { enforce: "enforce", learn: "learn" } as any
  );

  graph.addEdge("enforce" as any, "execute" as any);
  graph.addEdge("learn" as any, "__end__" as any);
  
  return (graph as any).compile();
}
