import { StateGraph } from "@langchain/langgraph";
import { ArchitectGraphState } from "./state";
import { resolveInputs } from "./nodes/resolveInputs";
import { plan } from "./nodes/plan";
import { implement } from "./nodes/implement";
import { validate } from "./nodes/validate";
import { enforce } from "./nodes/enforce";

export function buildArchitectGraph() {
  const graph = new StateGraph<ArchitectGraphState>({ channels: {} });

  graph.addNode("resolveInputs", resolveInputs);
  graph.addNode("plan", plan);
  graph.addNode("implement", implement);
  graph.addNode("validate", validate);
  // Enforce node requires a reason header; wrap as node using default header
  graph.addNode("enforce", async (s) => enforce(s, "VIOLATION DETECTED\nRegenerate COMPLETE files. Preserve originals. No ellipsis. Minimal changes only."));

  graph.addEdge("resolveInputs", "plan");
  graph.addEdge("plan", "implement");
  graph.addEdge("implement", "validate");

  // Conditional routing: if violations and retries < maxRetries → enforce → implement
  graph.addConditionalEdges("validate", (s: ArchitectGraphState) => {
    const hasViolations = (s.violations && s.violations.length > 0) || !s.files.length;
    if (hasViolations && s.retries < s.maxRetries) {
      s.retries += 1;
      return "enforce";
    }
    return "__end__";
  }, {
    enforce: "enforce",
    __end__: "__end__",
  });

  graph.addEdge("enforce", "implement");

  return graph.compile();
}
