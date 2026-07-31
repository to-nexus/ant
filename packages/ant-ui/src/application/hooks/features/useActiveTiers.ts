/**
 * SSOT facade for FE callers that need the live set of active tiers for a
 * given basis slot. Wraps `@ant/shared`'s `listActiveTiers` (the only
 * predicate that knows the tier × domain × runtime matrix) with the
 * `actionMetadata` channels (domain + RAC pool + saved techTier).
 *
 * Why this hook exists:
 *
 *   `AGENTS.md` D27 mandates `isTierActive(tier, slot, domain, runtime)`
 *   as the single SSOT, with FE wizard / FE summary / BE decompose / BE
 *   prompt-build as the only call surfaces. Before this hook, FE had its
 *   own per-tier inline calls in `useBasisWizard`, `BasisSummaryBar`, and
 *   the ActionsPanel routing branches — multiple copies of the same gate
 *   computation, each free to drift. This hook collapses every FE caller
 *   to a single line and lets a grep-guard enforce zero direct
 *   `isTierActive(` calls under `packages/ant-ui/src/`.
 *
 *   For callbacks (where hooks can't be used), import
 *   `decideActionsStepAfterIntent` / `actionMetadataToTierRuntime` from
 *   the sibling `tierRouting.ts` — they share the same input shape so
 *   inputs stay aligned with this hook.
 */

import { useMemo } from 'react';
import { useStore } from '@/domain/store';
import { useGitSnapshot } from '@/domain/git-world';
import {
  listActiveTiers,
  type BasisSlotConfig,
  type TierKey,
  type TierRuntimeContext,
} from '@ant/shared';
import { actionMetadataToTierRuntime } from './tierRouting';

export {
  actionMetadataToTierRuntime,
  decideActionsStepAfterIntent,
} from './tierRouting';

/**
 * Whether the workspace already holds a real codebase (manifest-based —
 * `GitSnapshot.hasCodebase`). Falls back to `false` while the snapshot is
 * still loading so greenfield behaviour is the safe default.
 */
export function useHasCodebase(): boolean {
  const snapshot = useGitSnapshot();
  return snapshot?.hasCodebase ?? false;
}

/**
 * @param overrides Shallow-merged over the store-derived runtime context.
 *   The BasisWizard needs this: its tier gate must react to the user's
 *   *live* stack pick rather than the saved `basis.techTier`, and a manual
 *   override entry re-opens the codebase-suppressed tiers with
 *   `{ hasCodebase: false }`.
 */
export function useActiveTiers(
  slot: BasisSlotConfig | undefined,
  overrides?: Partial<TierRuntimeContext>,
): TierKey[] {
  const metadata = useStore(s => s.actionMetadata);
  // D27 runtime suppressor input: when the workspace already has a codebase,
  // techTier AND visualTier are implicit from the existing code and
  // RUNTIME_SUPPRESSORS collapses them out of the active set.
  const hasCodebase = useHasCodebase();
  return useMemo(
    () => listActiveTiers(slot, metadata.domain, {
      ...actionMetadataToTierRuntime(metadata, hasCodebase),
      ...overrides,
    }),
    // `overrides` is an inline literal at every call site; depend on its
    // fields rather than identity so the memo is not defeated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slot, metadata, hasCodebase, overrides?.techTier, overrides?.hasUiDoc,
      overrides?.hasGameArtDoc, overrides?.hasCodebase],
  );
}
