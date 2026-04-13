import { Annotation, StateGraph } from "@langchain/langgraph";
import { LearnGraphState } from "./state";
import { decompose } from "./nodes/decompose";
import { resolve } from "./nodes/resolve";
import { store } from "./nodes/store";
import { triage, routeAfterTriage } from "../../../common/nodes/triage";

const LearnAnnotation = Annotation.Root({
  context: Annotation<any>,
  directive: Annotation<any>,
  deps: Annotation<any>,
  command: Annotation<any>,
  targets: Annotation<any>,
  texts: Annotation<any>,
  reportFilePath: Annotation<any>,
  triageResult: Annotation<any>,
  workspaceState: Annotation<any>,
  overrideDirective: Annotation<any>,
  skipTriage: Annotation<any>,
  actionMetadata: Annotation<any>,
  chatSource: Annotation<any>,
  currentJob: Annotation<any>,
  currentAgent: Annotation<any>,
  featurePath: Annotation<any>,
  _httpJobId: Annotation<any>,
  _phaseTimings: Annotation<any>,
  _uiLocale: Annotation<any>,
  isResume: Annotation<any>,
  tokenUsage: Annotation<any>,
  resolvedAction: Annotation<any>,
});

export function buildLearnGraph() {
  const graph = new StateGraph(LearnAnnotation);
  
  graph.addNode("triage", triage as any);
  graph.addNode("decompose", decompose as any);
  graph.addNode("resolve", resolve as any);
  graph.addNode("store", store as any);

  graph.addEdge("__start__" as any, "triage" as any);
  
  graph.addConditionalEdges(
    "triage" as any,
    (state: LearnGraphState) => {
      const route = routeAfterTriage(state);
      if (route === 'detect') {
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
