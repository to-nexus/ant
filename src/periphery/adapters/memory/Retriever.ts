import { MemoryPort } from "../../../core/ports";
import { RETRIEVAL_POLICY, RetrievalPhase } from "../../../core/policies/retrieval";

export async function retrieveContext(memory: MemoryPort, phase: RetrievalPhase, query: string): Promise<string[]> {
  const policy = RETRIEVAL_POLICY[phase];
  const results: string[] = [];
  for (const ns of policy.namespaces) {
    const r = await memory.query(query, ns, policy.topK);
    results.push(...r);
  }
  return results.slice(0, policy.topK);
}
