import { buildLearnGraph } from "./graph";
import { LearnGraphState } from "./state";
import { TriageResult } from "../../../common/graph/nodes/triage/types";
import { loadRecursionLimit, cleanupChat, invokeGraph } from "../../../common/graph/runnerHelpers";

export interface LearnGraphResult {
  stored: number;
  triageResult?: TriageResult;
}

export async function runLearnGraph(initial: LearnGraphState): Promise<LearnGraphResult> {
  const limit = loadRecursionLimit();
  console.log(`🔍 [LearnRunner] Recursion limit: ${limit}`);

  try {
    const state = await invokeGraph(buildLearnGraph(), initial, limit) as LearnGraphState;
    return {
      stored: state.texts?.length || 0,
      triageResult: state.triageResult,
    };
  } catch (error) {
    console.error(`❌ [LearnRunner] Graph execution failed:`, error);
    await cleanupChat();
    throw error;
  }
}
