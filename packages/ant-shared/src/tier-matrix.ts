/**
 * Tier Matrix — Single Source of Truth (SSOT-1, Phase 1)
 *
 * Domain × Tier × Runtime activation policy. Three primitives:
 *
 *   1. `TIER_DOMAIN_MATRIX` — declarative table of which (tier, domain)
 *      pairs are even possible. Adding a new domain = single row edit.
 *
 *   2. `RUNTIME_SUPPRESSORS` — runtime predicates that can suppress an
 *      otherwise-active tier (e.g. `visualTier` is suppressed when stack
 *      is backend-only or when a UI design doc already authoritatively
 *      defines visual policy).
 *
 *   3. `isTierActive(tier, slot, domain, runtime)` — the only predicate
 *      anyone is allowed to call. FE wizard / FE summary / BE decompose /
 *      BE prompt building all funnel through this single function.
 *
 * Design intent (D7 / D9):
 *   - No bespoke `isVisualTierActive`, `isArtTierActive`, etc. The
 *     per-tier predicates have been retired in favour of the matrix lookup.
 *   - The `tiers` array on `BasisSlotConfig` is the static gate (does this
 *     intent even opt into this tier?). Domain compatibility is the matrix
 *     row. Runtime suppression layers on top.
 *
 * Motion locality invariant (I5):
 *   - `interactionGrammar` (visualTier layer) and `motionPattern` /
 *     `particleProfile` / `projectilePolicy` (artTier axes) describe
 *     DIFFERENT surfaces (HUD vs engine). The matrix declares both tiers
 *     active simultaneously for `react+phaser` so each surface gets the
 *     correct partial; `tests/motion-locality.test.ts` enforces no
 *     cross-pollution in the partial bodies.
 *
 * Future-domain extension (Phase 4+):
 *   - Adding `'3d'` / `'data-viz'` / `'interactive-art'` is a Domain union
 *     edit ([detection.ts]) plus row updates here. The
 *     `gameContentTier` row stays game-only; non-game domains will simply
 *     have `gameContentTier=false` automatically.
 */

import type { BasisSlotConfig } from './action-config-matrix';
import type { Domain } from './detection';
import type { TechTierConfig } from './rac';

// ============================================
// TierKey — universe of supported tiers
// ============================================

/**
 * Phase 1 tier universe. Adding a new tier:
 *   1. extend this union,
 *   2. add a row to `TIER_DOMAIN_MATRIX`,
 *   3. (optional) add a `RUNTIME_SUPPRESSORS` entry,
 *   4. handle in PromptBuilder's `buildBasisSection` dispatch.
 */
export type TierKey =
  | 'domain'
  | 'techTier'
  | 'visualTier'
  | 'artTier'
  | 'gameContentTier';

export const TIER_KEYS: ReadonlyArray<TierKey> = [
  'domain',
  'techTier',
  'visualTier',
  'artTier',
  'gameContentTier',
] as const;

// ============================================
// SSOT-1: Tier × Domain matrix
// ============================================
//
// `domain` itself is included as a tier so the partial-injection gate
// (basis/domain/{d}.md) is uniform with the others — the matrix decides
// whether to inject domain identity.
//
// The matrix is intentionally a flat literal so its consumers (UI wizards,
// BE prompt builders, decompose tag-emit gates) can introspect at runtime.

export const TIER_DOMAIN_MATRIX: Readonly<Record<TierKey, ReadonlyArray<Domain>>> = {
  domain:          ['service', 'game'],
  techTier:        ['service', 'game'],
  visualTier:      ['service', 'game'],
  artTier:         ['game'],
  gameContentTier: ['game'],
} as const;

// ============================================
// Runtime context + suppressors
// ============================================

/**
 * Live signals consulted by runtime suppressors. All fields optional —
 * suppressors must tolerate partial context (e.g. before decompose has
 * resolved techTier).
 */
export interface TierRuntimeContext {
  /** Live tech tier config — used by the visualTier suppressor for backend stacks. */
  techTier?: TechTierConfig;
  /**
   * Whether a UI design document (ant / figma / handoff) is already in the
   * RAC pool. When true, the doc IS the visual authority — visualTier is
   * suppressed to avoid conflicting parallel injection.
   */
  hasUiDoc?: boolean;
}

type RuntimeSuppressor = (ctx: TierRuntimeContext) => boolean;

/**
 * Per-tier suppression predicates. A tier passes the static (slot + matrix)
 * gates only to be vetoed by these runtime checks. Returning `true` means
 * "suppress this tier".
 *
 * Inherits exactly the three suppressors that previously lived inside
 * `isVisualTierActive` (now deleted — D9):
 *   - slot opt-in (handled by `slot.tiers?.includes(tier)`)
 *   - backend-only stack
 *   - hasUiDoc=true
 */
const RUNTIME_SUPPRESSORS: Partial<Record<TierKey, RuntimeSuppressor>> = {
  visualTier: (ctx) =>
    ctx.techTier?.stack === 'backend' || ctx.hasUiDoc === true,
};

// ============================================
// isTierActive — the only public predicate
// ============================================

/**
 * @returns true iff:
 *   1. the slot opts in (`slot.tiers` contains the tier), AND
 *   2. the tier×domain matrix permits this domain, AND
 *   3. no runtime suppressor vetoes it.
 *
 * Callers MUST NOT inline these checks elsewhere. New tiers / new
 * suppressors land here so the matrix stays the single authority.
 */
export function isTierActive(
  tier: TierKey,
  slot: BasisSlotConfig | undefined,
  domain: Domain | undefined,
  runtime?: TierRuntimeContext,
): boolean {
  if (!slot?.tiers?.includes(tier)) return false;
  if (!domain || !TIER_DOMAIN_MATRIX[tier].includes(domain)) return false;
  const suppressor = RUNTIME_SUPPRESSORS[tier];
  if (suppressor && suppressor(runtime ?? {})) return false;
  return true;
}

/**
 * Active-tier list helper — convenience for callers that need the full set.
 * Returns tiers in stable `TIER_KEYS` order.
 */
export function listActiveTiers(
  slot: BasisSlotConfig | undefined,
  domain: Domain | undefined,
  runtime?: TierRuntimeContext,
): TierKey[] {
  return TIER_KEYS.filter((tier) => isTierActive(tier, slot, domain, runtime));
}

/**
 * Effective domain for a given RAC. Phase 1 default: `'service'` when the
 * RAC has no domain (preserves backward-compat for legacy SaaS PRD flows).
 */
export function getEffectiveDomain(domain: Domain | undefined): Domain {
  return domain ?? 'service';
}
