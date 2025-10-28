import { StateGraph } from "@langchain/langgraph";
import { ArchitectGraphState } from "./state";
import { resolve, plan, implement, validate } from "./nodes/index";

export function buildCodeGraph() {
  const graph = new StateGraph<ArchitectGraphState>({} as any);
  
  graph.addNode("resolve", resolve as any);
  graph.addNode("plan", plan as any);
  graph.addNode("implement", implement as any);
  graph.addNode("validate", validate as any);
  graph.addNode(
    "enforce",
    (async (s: any) => {
      const reasonHeader = "VIOLATION DETECTED\nRegenerate COMPLETE files. Preserve originals. No ellipsis. Minimal changes only.";
      return implement(s as ArchitectGraphState, reasonHeader);
    }) as any
  );

  graph.addEdge("__start__" as any, "resolve" as any);
  graph.addEdge("resolve" as any, "plan" as any);
  graph.addEdge("plan" as any, "implement" as any);
  graph.addEdge("implement" as any, "validate" as any);

  graph.addConditionalEdges(
    "validate" as any,
    ((s: ArchitectGraphState) => {
      const hasViolations = (s.violations && s.violations.length > 0) || !s.files.length;
      if (hasViolations && s.retries < s.maxRetries) {
        s.retries += 1;
        return "enforce";
      }
      return "__end__";
    }) as any,
    { enforce: "enforce", __end__: "__end__" } as any
  );

  graph.addEdge("enforce" as any, "implement" as any);
  
  return (graph as any).compile();
}
