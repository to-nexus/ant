import { buildDesignGraph } from "./graph";
import { DesignGraphState } from "./state";
import { getChatAPIClient } from "../../../../core/adapters/ChatAPIClient";

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
  
  try {
    const state = await (app as any).invoke(initial as any, {
      recursionLimit: finalLimit  // ✅ LangGraph RunnableConfig uses camelCase (NOT snake_case!)
    }) as DesignGraphState;
    
    // ✅ Return minimal results (all files were saved in writeFiles node)
    // No need to return paths - they are deterministic from context
    return state;
  } catch (error) {
    console.error(`❌ [DesignRunner] Graph execution failed:`, error);
    
    // ✅ CRITICAL: Cleanup any active chat message before re-throwing
    // This prevents stale currentMessage in Redis when the job fails
    try {
      const chatAPI = getChatAPIClient();
      if (chatAPI.hasActiveMessage()) {
        console.log('🧹 [DesignRunner] Cleaning up active message after error...');
        await chatAPI.finalizeMessage(true); // cancelled = true
      }
    } catch (cleanupError) {
      console.warn('⚠️ [DesignRunner] Failed to cleanup message:', cleanupError);
    }
    
    throw error;
  }
}
