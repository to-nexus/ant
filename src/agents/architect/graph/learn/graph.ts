import { StateGraph } from "@langchain/langgraph";
import { LearnGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { store } from "./nodes/store";

export function buildLearnGraph() {
  const graph = new StateGraph<LearnGraphState>({ channels: {} });
  graph.addNode("resolve", resolve);
  graph.addNode("store", store);

  graph.addEdge("resolve", "store");

  return graph.compile();
}
