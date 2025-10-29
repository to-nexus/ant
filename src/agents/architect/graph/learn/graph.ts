import { StateGraph } from "@langchain/langgraph";
import { LearnGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { store } from "./nodes/store";

export function buildLearnGraph() {
  const graph = new StateGraph<LearnGraphState>({
    channels: {
      context: null as any,
      spec: null as any,
      deps: null as any,
      targets: null as any,
      learnings: null as any,
      reportFilePath: null as any,
    } as any,
  } as any);
  
  graph.addNode("resolve", resolve as any);
  graph.addNode("store", store as any);

  graph.addEdge("__start__" as any, "resolve" as any);
  graph.addEdge("resolve" as any, "store" as any);

  return (graph as any).compile();
}
