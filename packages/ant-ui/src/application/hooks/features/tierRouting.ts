/**
 * Pure helpers for the FE tier-active SSOT facade. Kept separate from
 * `useActiveTiers.ts` (the React hook surface) so unit tests can import
 * them without pulling in `useStore` and the SSE / window-bound store
 * tree it transitively imports.
 *
 * The `useActiveTiers` hook delegates here for the runtime-context
 * adapter so both hook and direct callers stay aligned on the inputs
 * fed to `@ant/shared`'s `listActiveTiers`.
 */

import {
  listActiveTiers,
  pathsContainUiDoc,
  type ActionMetadata,
  type BasisSlotConfig,
  type TierRuntimeContext,
} from '@ant/shared';

/**
 * Build the `TierRuntimeContext` consumed by `listActiveTiers` /
 * `isTierActive` from any `ActionMetadata` snapshot. Pure — call from
 * either render code or callbacks.
 */
export function actionMetadataToTierRuntime(metadata: ActionMetadata): TierRuntimeContext {
  return {
    techTier: metadata.basis?.techTier,
    hasUiDoc: pathsContainUiDoc([
      ...(metadata.refs ?? []),
      ...(metadata.context ?? []),
    ]),
  };
}

/**
 * Step-routing decision after an intent is picked from the
 * `IntentChipGrid`. Pure — given the intent's basis slot and the user's
 * current `actionMetadata`, returns whether the panel should land on
 * `'basis-edit'` (at least one tier is actually active for the current
 * domain × runtime AND no basis has been saved yet) or `'config'`.
 *
 * Centralised so the routing rule lives in one line and can be exercised
 * by unit tests without mounting the React tree. Both
 * `ActionsPanel.handleIntentSelect` and the `basis-edit` render guard
 * funnel through this; drift between them was the original bug
 * (handler routed to `basis-edit` while the wizard rendered `null`,
 * leaving the panel completely blank).
 */
export function decideActionsStepAfterIntent(
  slot: BasisSlotConfig | undefined,
  metadata: ActionMetadata,
): 'basis-edit' | 'config' {
  const tiers = listActiveTiers(slot, metadata.domain, actionMetadataToTierRuntime(metadata));
  return tiers.length > 0 && !metadata.basis ? 'basis-edit' : 'config';
}
