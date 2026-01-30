import { buildLearnGraph } from "./graph";
import { LearnGraphState } from "./state";
import { TriageResult } from "../../../common/nodes/triage/types";

export interface LearnGraphResult {
  stored: number;
  triageResult?: TriageResult;
}

export async function runLearnGraph(initial: LearnGraphState): Promise<LearnGraphResult> {
  const app = buildLearnGraph();
  
  // ✅ Read recursion limit from environment variable
  const MIN_RECURSION_LIMIT = 5;
  const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
  const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
    ? MIN_RECURSION_LIMIT 
    : recursionLimit;
  
  console.log(`🔍 [LearnRunner] Recursion limit: ${finalLimit}`);
  
  const state = await (app as any).invoke(initial as any, {
    recursionLimit: finalLimit  // ✅ LangGraph RunnableConfig uses camelCase (NOT snake_case!)
  }) as LearnGraphState;
  
  return { 
    stored: state.texts?.length || 0,
    triageResult: state.triageResult  // ✅ Include triage result for redirect/blocked handling
  };
}
