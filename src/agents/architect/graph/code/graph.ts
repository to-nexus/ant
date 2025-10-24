import { StateGraph } from "@langchain/langgraph";
import { ArchitectGraphState } from "../state";
import { resolve } from "./nodes/index";
import { plan, implement, validate, enforce } from "./nodes/index";

export function buildCodeGraph() {
  const graph = new StateGraph<ArchitectGraphState>({ channels: {} });
  graph.addNode("resolve", resolve);
  graph.addNode("plan", plan);
  graph.addNode("implement", implement);
  graph.addNode("validate", validate);
  graph.addNode("enforce", async (s) => enforce(s, "VIOLATION DETECTED\nRegenerate COMPLETE files. Preserve originals. No ellipsis. Minimal changes only."));

  graph.addEdge("resolve", "plan");
  graph.addEdge("plan", "implement");
  graph.addEdge("implement", "validate");

  graph.addConditionalEdges("validate", (s: ArchitectGraphState) => {
    const hasViolations = (s.violations && s.violations.length > 0) || !s.files.length;
    if (hasViolations && s.retries < s.maxRetries) {
      s.retries += 1;
      return "enforce";
    }
    return "__end__";
  }, { enforce: "enforce", __end__: "__end__" });

  graph.addEdge("enforce", "implement");
  return graph.compile();
}
