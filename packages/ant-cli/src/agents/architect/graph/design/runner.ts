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
  
  // ✅ Read recursion limit from environment variable
  const MIN_RECURSION_LIMIT = 5;
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
  const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
    ? MIN_RECURSION_LIMIT 
    : recursionLimit;
  
  console.log(`🔍 [DesignRunner] Recursion limit: ${finalLimit}`);
  
  const state = await (app as any).invoke(initial as any, {
    configurable: {
      recursion_limit: finalLimit  // ✅ LangGraph requires recursion_limit inside configurable
    }
  }) as DesignGraphState;
  
  // ✅ Return minimal results (all files were saved in writeFiles node)
  // No need to return paths - they are deterministic from context
  return state;
}
