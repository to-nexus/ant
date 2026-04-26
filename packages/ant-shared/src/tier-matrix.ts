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
 * Phase 2 tier universe (D22 + D23 + D28). Adding a new tier:
 *   1. extend this union,
 *   2. add a row to `TIER_DOMAIN_MATRIX`,
 *   3. (optional) add a `RUNTIME_SUPPRESSORS` entry,
 *   4. handle in PromptBuilder's `buildBasisSection` dispatch.
 *
 * D23 — `'domain'` is NOT a TierKey. Domain is a workspace-level 1st-class
 * slot (D22) and acts as the matrix gate argument, not a wizard tier.
 * Service-domain plan/spec basis wizards thus auto-collapse (no tier rows
 * for service in the gameContentTier-only PLAN_TIERS / SPEC_TIERS).
 *
 * D28 — `visualTier` is service-domain-only (vertical split). The game
 * domain has `gameArtTier` as its sole art SSOT and never sees visualTier
 * / ui-* artifacts. service domain is unchanged.
 */
export type TierKey =
  | 'techTier'
  | 'visualTier'
  | 'gameArtTier'
  | 'gameContentTier';

export const TIER_KEYS: ReadonlyArray<TierKey> = [
  'techTier',
  'visualTier',
  'gameArtTier',
  'gameContentTier',
] as const;

// ============================================
// SSOT-1: Tier × Domain matrix
// ============================================
//
// The matrix is intentionally a flat literal so its consumers (UI wizards,
// BE prompt builders, decompose tag-emit gates) can introspect at runtime.
// `domain` is NOT in this map — it is the gate argument, not a tier (D23).

export const TIER_DOMAIN_MATRIX: Readonly<Record<TierKey, ReadonlyArray<Domain>>> = {
  techTier:        ['service', 'game'],
  visualTier:      ['service'],       // D28 — service-domain only (vertical split)
  gameArtTier:     ['game'],          // D12-revised — game-domain only
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
 * Inherits the three suppressors that previously lived inside
 * `isVisualTierActive` (deleted — D9):
 *   - slot opt-in (handled by `slot.tiers?.includes(tier)`)
 *   - backend-only stack
 *   - hasUiDoc=true
 *
 * D28 note — visualTier is gated to `['service']` at the matrix layer, so
 * these suppressors only ever run on service-domain RACs. The hasUiDoc
 * branch keeps its meaning (a service workspace with a finalized UI doc
 * gets the tier suppressed because the artifact IS the visual authority).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
