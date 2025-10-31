import { StateGraph } from "@langchain/langgraph";
import { DesignGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { plan } from "./nodes/plan";
import { execute } from "./nodes/execute";
import { learn } from "./nodes/learn";

export function buildDesignGraph() {
  const graph = new StateGraph<DesignGraphState>({
    channels: {
      // Context & Input
      context: null as any,
      spec: null as any,
      
      // Dependencies (MUST be in channels to be passed between nodes!)
      deps: null as any,
      
      // Mode
      designMode: null as any,
      
      // Artifacts (from TaskArtifacts)
      prd: null as any,
      directive: null as any,
      design: null as any,
      code: null as any,
      codeHead: null as any,
      profile: null as any,
      
      // Execution
      planText: null as any,
      designMarkdown: null as any,
      
      // Results
      designFilePath: null as any,
      learnings: null as any,
    } as any,
  } as any);

  graph.addNode("resolve" as const, resolve as any);
  graph.addNode("plan" as const, plan as any);
  graph.addNode("execute" as const, execute as any);
  graph.addNode("learn" as const, learn as any);

  (graph as any).addEdge("__start__", "resolve");
  (graph as any).addEdge("resolve", "plan");
  (graph as any).addEdge("plan", "execute");
  (graph as any).addEdge("execute", "learn");

  return graph.compile();
}
