import { buildLearnGraph } from "./graph";
import { LearnGraphState } from "./state";

export async function runLearnGraph(initial: LearnGraphState) {
  const app = buildLearnGraph();
  
  // ✅ Read recursion limit from environment variable
  const MIN_RECURSION_LIMIT = 5;
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
  const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
    ? MIN_RECURSION_LIMIT 
    : recursionLimit;
  
  console.log(`🔍 [LearnRunner] Recursion limit: ${finalLimit}`);
  
  const state = await (app as any).invoke(initial as any, {
    configurable: {
      recursion_limit: finalLimit  // ✅ LangGraph requires recursion_limit inside configurable
    }
  }) as LearnGraphState;
  
  return { stored: state.texts.length };
}
