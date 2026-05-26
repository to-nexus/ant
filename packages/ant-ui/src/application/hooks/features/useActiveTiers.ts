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
  pathsContainUiDoc,
  type BasisSlotConfig,
  type TierKey,
} from '@ant/shared';

export {
  actionMetadataToTierRuntime,
  decideActionsStepAfterIntent,
} from './tierRouting';

export function useActiveTiers(slot: BasisSlotConfig | undefined): TierKey[] {
  const domain = useStore(s => s.actionMetadata.domain);
  const techTier = useStore(s => s.actionMetadata.basis?.techTier);
  const refs = useStore(s => s.actionMetadata.refs);
  const ctx = useStore(s => s.actionMetadata.context);
  // D27 runtime suppressor input: when the workspace already has a codebase,
  // techTier is implicit from the existing code and RUNTIME_SUPPRESSORS.techTier
  // collapses it out of the active set. Falls back to `false` while the
  // snapshot is still loading so greenfield behaviour is preserved.
  const snapshot = useGitSnapshot();
  const hasCodebase = snapshot?.hasCodebase ?? false;
  return useMemo(
    () => listActiveTiers(slot, domain, {
      techTier,
      hasUiDoc: pathsContainUiDoc([...(refs ?? []), ...(ctx ?? [])]),
      hasCodebase,
    }),
    [slot, domain, techTier, refs, ctx, hasCodebase],
  );
}
