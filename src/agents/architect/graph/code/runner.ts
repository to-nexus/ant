import { ArchitectGraphState } from "./state";
import { buildCodeGraph } from "./graph";

/**
 * Code Graph Runner
 * 
 * Responsibility: Execute the graph and return results
 * All side effects (file saving, memory storage) are handled inside the graph
 */
export async function runCodeGraph(initial: ArchitectGraphState) {
  const app = buildCodeGraph();
  const state = await (app as any).invoke(initial as any) as ArchitectGraphState;

  // Return results (all saving was done in learn node)
  return { 
    branch: state.branch!, 
    reportFile: `Generated ${state.filesWritten} files on branch ${state.branch}`,
    filesChanged: state.filesWritten!
  };
}
