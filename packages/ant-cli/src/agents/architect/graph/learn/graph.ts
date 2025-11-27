import { StateGraph } from "@langchain/langgraph";
import { LearnGraphState } from "./state";
import { decompose } from "./nodes/decompose";
import { resolve } from "./nodes/resolve";
import { store } from "./nodes/store";

export function buildLearnGraph() {
  const graph = new StateGraph<LearnGraphState>({
    channels: {
      context: null as any,
      spec: null as any,
      deps: null as any,
      command: null as any,      // ✅ LLM의 정규화된 명령
      targets: null as any,
      lessons: null as any,
      texts: null as any,
      reportFilePath: null as any,
    } as any,
  } as any);
  
  graph.addNode("decompose", decompose as any);  // ✅ LLM이 자연어 분해
  graph.addNode("resolve", resolve as any);      // ✅ 명령 실행
  graph.addNode("store", store as any);

  graph.addEdge("__start__" as any, "decompose" as any);
  graph.addEdge("decompose" as any, "resolve" as any);
  graph.addEdge("resolve" as any, "store" as any);

  return (graph as any).compile();
}
