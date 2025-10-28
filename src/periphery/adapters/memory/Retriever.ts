import { MemoryPort } from "../../../core/ports";
import { RETRIEVAL_POLICY, RetrievalPhase } from "../../../core/policies/retrieval";
import { MMRReranker } from "../../../core/chunk/rerank";

export async function retrieveContext(memory: MemoryPort, phase: RetrievalPhase, query: string): Promise<string[]> {
  const policy = RETRIEVAL_POLICY[phase];
  const reranker = new MMRReranker({ lambda: 0.7 });
  
  const allResults = [];
  
  for (const ns of policy.namespaces) {
    const results = await memory.query(query, ns, { 
      k: policy.topK * 2,  // Get more for reranking
      minScore: 0.5
    });
    allResults.push(...results);
  }
  
  // Rerank for diversity
  const reranked = reranker.rerank(allResults, policy.topK);
  
  return reranked.map(r => r.content);
}
