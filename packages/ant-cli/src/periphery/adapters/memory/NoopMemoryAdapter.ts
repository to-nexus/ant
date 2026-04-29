import { MemoryPort, QueryOptions, QueryResult } from "../../../core/ports";
import { CollectionType } from "../../../core/types";

/**
 * No-op `MemoryPort` used when `ANT_VECTOR_DB_ENABLED=false`.
 *
 * Contract:
 *   - `query()` resolves to `[]` so callers (RAG step 1, `retrieve()`,
 *     index-completion probes) flow through the empty-result branch.
 *   - `store/delete/clear` are no-ops — they never throw, never block.
 *
 * The adapter logs a single notice on its first construction so operators
 * can confirm the toggle took effect; subsequent instances stay silent.
 *
 * See [`vectorDbCapability.ts`](../../../core/config/vectorDbCapability.ts)
 * for the SSOT toggle definition.
 */
export class NoopMemoryAdapter implements MemoryPort {
  private static announced = false;

  constructor() {
    if (!NoopMemoryAdapter.announced) {
      console.log(
        "ℹ️  [Memory] Vector DB disabled (ANT_VECTOR_DB_ENABLED=false) — using no-op MemoryPort. " +
          "RAG vector step yields [] and falls back to git-changes + keyword search."
      );
      NoopMemoryAdapter.announced = true;
    }
  }

  async store(
    _documents: Array<{ content: string; metadata?: Record<string, any> }>,
    _project: string,
    _collectionType?: CollectionType
  ): Promise<void> {
    // intentional no-op
  }

  async query(
    _query: string,
    _project: string,
    _options?: QueryOptions
  ): Promise<QueryResult[]> {
    return [];
  }

  async delete(
    _project: string,
    _where: Record<string, any>,
    _collectionType?: CollectionType
  ): Promise<void> {
    // intentional no-op
  }

  async clear(_project: string): Promise<void> {
    // intentional no-op
  }
}
