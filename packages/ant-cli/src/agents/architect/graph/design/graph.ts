import { StateGraph } from "@langchain/langgraph";
import { DesignGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { decompose } from "./nodes/decompose";
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
      
      // ✅ NEW: Task Queue (like code graph)
      taskQueue: null as any,
      currentTask: null as any,
      completedTasks: null as any,
      completedTasksDetails: null as any,
      
      // Execution
      planText: null as any,
      designMarkdown: null as any,
      
      // Results
      designFilePath: null as any,
      learnings: null as any,
      
      // ✅ For tracking in UI
      _httpTaskId: null as any,
    } as any,
  } as any);

  graph.addNode("resolve" as const, resolve as any);
  graph.addNode("decompose" as const, decompose as any);  // ✅ NEW
  graph.addNode("plan" as const, plan as any);
  graph.addNode("execute" as const, execute as any);
  graph.addNode("learn" as const, learn as any);

  // ✅ NEW flow: resolve → decompose → plan → execute → learn
  (graph as any).addEdge("__start__", "resolve");
  (graph as any).addEdge("resolve", "decompose");  // ✅ NEW
  (graph as any).addEdge("decompose", "plan");     // ✅ CHANGED
  (graph as any).addEdge("plan", "execute");
  (graph as any).addEdge("execute", "learn");

  return graph.compile();
}
