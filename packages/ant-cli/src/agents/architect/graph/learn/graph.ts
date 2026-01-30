import { StateGraph } from "@langchain/langgraph";
import { LearnGraphState } from "./state";
import { decompose } from "./nodes/decompose";
import { resolve } from "./nodes/resolve";
import { store } from "./nodes/store";
import { triage, routeAfterTriage } from "../../../common/nodes/triage";

export function buildLearnGraph() {
  const graph = new StateGraph<LearnGraphState>({
    channels: {
      context: null as any,
      spec: null as any,
      deps: null as any,
      command: null as any,
      targets: null as any,
      texts: null as any,
      reportFilePath: null as any,
      // ✅ Triage System channels
      triageResult: null as any,
      workspaceState: null as any,
      overrideDirective: null as any,
      skipTriage: null as any,
      currentJob: null as any,
      currentAgent: null as any,
      _httpJobId: null as any,
      tokenUsage: null as any,
    } as any,
  } as any);
  
  // ✅ Triage: analyze intent and prerequisites
  graph.addNode("triage", triage as any);
  graph.addNode("decompose", decompose as any);  // LLM이 자연어 분해
  graph.addNode("resolve", resolve as any);      // 명령 실행
  graph.addNode("store", store as any);

  // ✅ Start with triage
  graph.addEdge("__start__" as any, "triage" as any);
  
  // ✅ Route after triage: proceed to decompose or end (redirect/ask)
  graph.addConditionalEdges(
    "triage" as any,
    (state: LearnGraphState) => {
      // ✅ Use common router with custom detectEnvironment → decompose mapping
      const route = routeAfterTriage(state);
      // Learn doesn't have detectEnvironment, map to decompose
      if (route === 'detectEnvironment') {
        return 'decompose';
      }
      return route;
    },
    {
      decompose: "decompose" as any,
      __end__: "__end__" as any,
    } as any
  );
  
  graph.addEdge("decompose" as any, "resolve" as any);
  graph.addEdge("resolve" as any, "store" as any);

  return (graph as any).compile();
}
