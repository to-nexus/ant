export type RetrievalPhase = "plan" | "code" | "learn";

export interface RetrievalPolicyConfig {
  topK: number;
  namespaces: string[]; // e.g., ["design", "code-history"]
}

export const RETRIEVAL_POLICY: Record<RetrievalPhase, RetrievalPolicyConfig> = {
  plan: { topK: 5, namespaces: ["design", "spec"] },
  code: { topK: 8, namespaces: ["design", "code-history", "errors"] },
  learn: { topK: 0, namespaces: [] },
};
