import { StateGraph } from "@langchain/langgraph";
import { LearnAnnotation, LearnGraphState } from "./state";
import { decompose } from "./nodes/decompose";
import { processCommand as processNode } from "./nodes/resolve";
import { store } from "./nodes/store";
import { triage, routeAfterTriage } from "../../../common/nodes/triage";

export function buildLearnGraph() {
  const graph = new StateGraph(LearnAnnotation);
  
  graph.addNode("triage", triage as any);
  graph.addNode("decompose", decompose as any);
  graph.addNode("process", processNode as any);
  graph.addNode("store", store as any);

  graph.addEdge("__start__" as any, "triage" as any);
  
  graph.addConditionalEdges(
    "triage" as any,
    ((state: LearnGraphState) => {
      const route = routeAfterTriage(state);
      if (route === 'detect') {
        return 'decompose';
      }
      return route;
    }) as any,
    {
      decompose: "decompose" as any,
      __end__: "__end__" as any,
    } as any
  );
  
  graph.addEdge("decompose" as any, "process" as any);
  graph.addEdge("process" as any, "store" as any);

  return (graph as any).compile();
}
