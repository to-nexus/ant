/**
 * Vector DB Capability — SSOT
 *
 * Single source of truth for the `ANT_VECTOR_DB_ENABLED` toggle.
 * All callers MUST go through `isVectorDbEnabled()` instead of reading
 * `process.env.ANT_VECTOR_DB_ENABLED` directly.
 *
 * Default: `false` (opt-in). Set `ANT_VECTOR_DB_ENABLED=true` and start
 * the ChromaDB + embedder containers (`pnpm dev:infra:vector`) to enable
 * vector-backed retrieval, codebase indexing, and lesson memory.
 *
 * When disabled:
 *   - `AdapterFactory.createMemoryAdapter()` returns a `NoopMemoryAdapter`
 *     (`query → []`, `store/delete/clear` → no-op).
 *   - The `learn` job (codebase indexing) short-circuits with a
 *     "vector-db-disabled" status; UI hides the `learn` agent option.
 *   - The RAG pipeline degrades gracefully: vector step yields `[]`,
 *     git-changes + keyword-search steps cover the quota.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Whether the Chroma-backed `MemoryPort` is enabled for this process.
 *
 * Reads `process.env.ANT_VECTOR_DB_ENABLED` lazily on every call so tests
 * can flip the flag at runtime without re-importing modules.
 */
export function isVectorDbEnabled(): boolean {
  const raw = process.env.ANT_VECTOR_DB_ENABLED;
  if (raw === undefined) return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Throws when vector DB is disabled. Use at command-handler boundaries
 * that have no graceful fallback (e.g. `ant index` CLI).
 */
export function assertVectorDbEnabled(reason: string): void {
  if (!isVectorDbEnabled()) {
    throw new VectorDbDisabledError(reason);
  }
}

export class VectorDbDisabledError extends Error {
  constructor(reason: string) {
    super(
      `Vector DB is disabled (ANT_VECTOR_DB_ENABLED=false). ${reason} ` +
        `Set ANT_VECTOR_DB_ENABLED=true and start ChromaDB (pnpm dev:infra:vector) to enable.`
    );
    this.name = "VectorDbDisabledError";
  }
}
