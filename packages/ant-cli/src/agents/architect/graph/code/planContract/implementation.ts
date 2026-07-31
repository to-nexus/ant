/**
 * Plan `implementation` contract — the single owner of "what counts as work
 * declared by a plan".
 *
 * The prompt (`templates/jobs/code/nodes/plan/rules.md`) teaches the legal keys
 * of `implementation`. Every predicate that asks "did this plan declare work?"
 * MUST derive from {@link PLAN_MUTATION_KEYS} here. A key taught by the prompt
 * but absent from this list silently degrades into "nothing to do".
 *
 * That is exactly the `level-dashing-plumb` defect: `assets[]` was documented in
 * the plan schema (`rules.md` output skeleton + JSON schema) and read by nobody,
 * so a plan whose only content was an asset placement was byte-indistinguishable
 * from the mandatory empty-plan sentinel — the plan body was discarded, execute
 * was skipped, and the task completed reporting success with zero writes.
 *
 * `tests/policy/plan-implementation-contract.test.ts` locks this list against the
 * keys the prompt actually teaches, so the two can no longer drift apart.
 */

/** Keys of `implementation` that represent real work. Prompt-facing contract. */
export const PLAN_MUTATION_KEYS = ['create', 'modify', 'delete', 'assets'] as const;
export type PlanMutationKey = (typeof PLAN_MUTATION_KEYS)[number];

/**
 * Top-level keys that fan a plan out into child batches instead of declaring
 * work inline. A plan carrying either is NEVER "no work" — its work lives in
 * the children.
 *
 * `regions` matters as much as `batches`: a seam classifying parent emits
 * `regions[]`, and those are only rewritten into `parsed.batches` later, inside
 * `batchSplit/process.ts`. Callers that run before that rewrite (the plan
 * tool-loop sentinel) would otherwise see a fan-out plan as empty.
 */
export const PLAN_FAN_OUT_KEYS = ['batches', 'regions'] as const;

export interface AssetPlacement {
  source: string;
  destination: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function implementationOf(parsed: unknown): Record<string, unknown> {
  return asRecord(asRecord(parsed).implementation);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Total declared mutation entries across every key in {@link PLAN_MUTATION_KEYS}.
 * Absent and non-array keys count as 0. Observability + emptiness share this.
 */
export function countPlanMutations(parsed: unknown): number {
  const impl = implementationOf(parsed);
  return PLAN_MUTATION_KEYS.reduce((sum, key) => sum + arrayLength(impl[key]), 0);
}

/** True when the plan delegates its work to child batches / regions. */
export function planDeclaresFanOut(parsed: unknown): boolean {
  const root = asRecord(parsed);
  return PLAN_FAN_OUT_KEYS.some((key) => arrayLength(root[key]) > 0);
}

/**
 * True when the plan declares no work at all: no mutation entries under any
 * {@link PLAN_MUTATION_KEYS} key AND no fan-out.
 *
 * Absent keys count as empty — generalizing the `?? 0` the legacy predicate
 * applied to `delete` alone, so `{ modify: [] }` with `create` omitted is now
 * correctly "no work" instead of entering execute with an empty implementation.
 * The fan-out guard is what keeps that generalization safe.
 */
export function planDeclaresNoWork(parsed: unknown): boolean {
  if (planDeclaresFanOut(parsed)) return false;
  return countPlanMutations(parsed) === 0;
}

/**
 * Asset placements declared by the plan — the `{source, destination}` pairs the
 * execute phase owes a `copy_file` for. Malformed entries are dropped rather
 * than throwing: a plan is LLM-authored text, and a bad entry must not take down
 * the phase that would otherwise do the remaining valid work.
 */
export function extractAssetPlacements(parsed: unknown): AssetPlacement[] {
  const raw = implementationOf(parsed).assets;
  if (!Array.isArray(raw)) return [];
  const placements: AssetPlacement[] = [];
  for (const entry of raw) {
    const { source, destination } = asRecord(entry);
    if (typeof source === 'string' && source.trim() && typeof destination === 'string' && destination.trim()) {
      placements.push({ source: source.trim(), destination: destination.trim() });
    }
  }
  return placements;
}
