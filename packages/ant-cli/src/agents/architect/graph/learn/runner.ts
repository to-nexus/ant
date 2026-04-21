import { buildLearnGraph } from "./graph";
import { LearnGraphState } from "./state";
import { TriageResult } from "../../../common/graph/nodes/triage/types";
import { loadRecursionLimit, cleanupChat, invokeGraph } from "../../../common/graph/runnerHelpers";
import { ExecutionTierId } from "../../../../core/executionTier";

export interface LearnGraphResult {
  stored: number;
  triageResult?: TriageResult;
}

export async function runLearnGraph(initial: LearnGraphState): Promise<LearnGraphResult> {
  const limit = loadRecursionLimit();
  console.log(`🔍 [LearnRunner] Recursion limit: ${limit}`);

  // Learn is a read-only indexing job — Tier 0 Reflex always. Inject the
  // fixed tier at runner start so `getExecutionTier(state)` returns the
  // Reflex facade without going through an LLM.
  const seeded: LearnGraphState = {
    ...initial,
    executionTier: ExecutionTierId.Reflex,
  };

  try {
    const state = await invokeGraph(buildLearnGraph(), seeded, limit) as LearnGraphState;
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
