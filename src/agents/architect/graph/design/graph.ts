import { StateGraph } from "@langchain/langgraph";
import { DesignGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { plan } from "./nodes/plan";
import { execute } from "./nodes/execute";
import { save } from "./nodes/save";

export function buildDesignGraph() {
  const graph = new StateGraph<DesignGraphState>({
    channels: {
      context: null as any,
      spec: null as any,
      previousDesign: null as any,
      directive: null as any,
      planText: null as any,
      designMarkdown: null as any,
      designFilePath: null as any,
    } as any,
  } as any);

  graph.addNode("resolve" as const, resolve as any);
  graph.addNode("plan" as const, plan as any);
  graph.addNode("execute" as const, execute as any);
  graph.addNode("save" as const, save as any);

  (graph as any).addEdge("__start__", "resolve");
  (graph as any).addEdge("resolve", "plan");
  (graph as any).addEdge("plan", "execute");
  (graph as any).addEdge("execute", "save");

  return graph.compile();
}
