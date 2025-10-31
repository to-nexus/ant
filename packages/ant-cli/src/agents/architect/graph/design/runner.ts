import { buildDesignGraph } from "./graph";
import { DesignGraphState } from "./state";

/**
 * Design Graph Runner
 * 
 * Responsibility: Execute the graph and return results
 * All side effects (file saving, memory storage) are handled inside the graph
 */
export async function runDesignGraph(initial: DesignGraphState) {
  const app = buildDesignGraph();
  const state = await (app as any).invoke(initial as any) as DesignGraphState;
  
  // Return results (all saving was done in learn node)
  return { 
    designFilePath: state.designFilePath!, 
    markdown: state.designMarkdown 
  };
}
