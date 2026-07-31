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
 *     edit ([detection.ts]) plus row updates here. The `gameArtTier` row
 *     stays game-only; non-game domains simply have `gameArtTier=false`
 *     automatically.
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
 * Service-domain plan/spec basis wizards thus auto-collapse (PLAN_TIERS is
 * empty — plan/spec expose no wizard tiers).
 *
 * D28 — `visualTier` is service-domain-only (vertical split). The game
 * domain has `gameArtTier` as its sole art SSOT and never sees visualTier
 * / ui-* artifacts. service domain is unchanged.
 */
export type TierKey =
  | 'techTier'
  | 'visualTier'
  | 'gameArtTier';

export const TIER_KEYS: ReadonlyArray<TierKey> = [
  'techTier',
  'visualTier',
  'gameArtTier',
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
  /**
   * Game-domain twin of `hasUiDoc`: whether a game-art reference document
   * (ant-json / figma / handoff under `visual/game-art/**`) is already in the
   * RAC pool. When true the reference IS the art authority, so the gameArtTier
   * `concept` design-language layer is withheld (`shouldEmitGameArtConcept`)
   * to avoid a conflicting parallel art direction. The mechanical axes
   * (perspective + policy axes) always survive — unlike visualTier this does
   * NOT suppress the whole tier. When bootstrapping a handoff (no reference yet)
   * this is false and `concept` seeds the output.
   */
  hasGameArtDoc?: boolean;
  /**
   * Whether the workspace already contains a codebase (see
   * `GitSnapshot.hasCodebase` — true when `codebase/` is populated or the
   * memory-index sentinel is present). When true, EVERY tier is fixed
   * implicitly by the existing code: the BasisWizard MUST NOT prompt the
   * user to re-pick them, and the corresponding runtime suppressors
   * (below) collapse those tiers out of `listActiveTiers` so downstream
   * routing (`decideActionsStepAfterIntent`, `BasisSummaryBar`) reflects
   * the implicit lock. The rationale for visualTier / gameArtTier mirrors
   * techTier — an existing codebase carries its own visual identity (CSS /
   * design tokens / component library, or sprites / palette / render
   * dimension) that the BasisWizard re-prompt would conflict with.
   *
   * Optional + compared with `=== true` in the suppressor, so existing
   * callers that omit the field (e.g. BE prompt-build) keep their prior
   * behavior unchanged.
   */
  hasCodebase?: boolean;
}

type RuntimeSuppressor = (ctx: TierRuntimeContext) => boolean;

/**
 * Per-tier suppression predicates. A tier passes the static (slot + matrix)
 * gates only to be vetoed by these runtime checks. Returning `true` means
 * "suppress this tier".
 *
 * Inherits the suppressors that previously lived inside
 * `isVisualTierActive` (deleted — D9):
 *   - slot opt-in (handled by `slot.tiers?.includes(tier)`)
 *   - backend-only stack
 *   - hasUiDoc=true
 *   - hasCodebase=true — existing codebase implicitly fixes the visual
 *     identity (CSS / design tokens / component library), so re-prompting
 *     via the BasisWizard would conflict with the established choices.
 *
 * D28 note — visualTier is gated to `['service']` at the matrix layer, so
 * these suppressors only ever run on service-domain RACs. The hasUiDoc
 * branch keeps its meaning (a service workspace with a finalized UI doc
 * gets the tier suppressed because the artifact IS the visual authority).
 *
 * techTier SSOT — when the workspace already contains a codebase
 * (`ctx.hasCodebase === true`), the techTier is implicitly fixed by the
 * existing code. The suppressor collapses the tier out of
 * `listActiveTiers` so the BasisWizard does not re-prompt and downstream
 * routing (`decideActionsStepAfterIntent`, `BasisSummaryBar`) reflects the
 * implicit lock. Greenfield workspaces (`hasCodebase` falsy) keep prior
 * behavior — the tier remains active and the wizard runs as before.
 *
 * visualTier SSOT (D27) — the same `hasCodebase === true` signal
 * additionally suppresses visualTier. Service-domain workspaces with an
 * existing codebase have an implicit visual identity baked into their
 * stylesheets / token files / component library, so the wizard MUST NOT
 * re-derive it. All FE/BE call surfaces funnel through `isTierActive`, so
 * this single predicate change propagates automatically to
 * `useActiveTiers`, `decideActionsStepAfterIntent`, `BasisSummaryBar`,
 * the ActionConfigView Edit gate, and the BE PromptBuilder visualTier
 * dispatch.
 *
 * gameArtTier SSOT (D28 vertical split) — gameArtTier is the game domain's
 * counterpart of visualTier, so it takes the SAME `hasCodebase` treatment.
 * An existing game codebase already fixes both the art direction (its
 * sprites / palette / HUD tokens) and the render dimension (a Phaser
 * `Scene` vs an enable3d `Scene3D` is written into the code), so the wizard
 * MUST NOT re-prompt for `concept` / `perspective`. Suppressing only
 * visualTier here left the split asymmetric: a game project with existing
 * code skipped techTier but was still forced through the game-art picker.
 *
 * Do NOT read this as contradicting `shouldEmitGameArtConcept` below. That
 * predicate is about `hasGameArtDoc` — a *reference document* pins the
 * aesthetic but says nothing about the render dimension, so only the
 * `concept` layer is withheld there. `hasCodebase` is a stronger signal:
 * running code determines both axes, so the whole tier collapses.
 *
 * BE is unaffected by all three suppressors: `decompose`'s `_runtime` and
 * `PromptBuilder.buildBasisSection`'s `runtime` both omit `hasCodebase` on
 * purpose, keeping the `<techTier>` / `<gameArtTier>` emit contracts alive.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RUNTIME_SUPPRESSORS: Partial<Record<TierKey, RuntimeSuppressor>> = {
  visualTier: (ctx) =>
    ctx.techTier?.stack === 'backend' ||
    ctx.hasUiDoc === true ||
    ctx.hasCodebase === true,
  techTier: (ctx) => ctx.hasCodebase === true,
  gameArtTier: (ctx) => ctx.hasCodebase === true,
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
 * Layer-selective survivor of the `hasUiDoc` visualTier suppression.
 *
 * When a UI design doc is the visual authority, `isTierActive('visualTier')`
 * returns false and the doc owns the look — its design-LANGUAGE layers
 * (visualLanguage / surface / colour / typography / components / interaction)
 * are correctly withheld. But a source can omit a structural spacing value, and
 * with the whole tier gone nothing backstops it → content renders flush
 * (bright-causing-brick RCA). This predicate decides whether to emit ONLY the
 * spatial-validity floor (`basis/visualTier/spatialSystem/_floor`) — a property,
 * not a competing scale, so it cannot conflict with the source's own values.
 *
 * Emits iff visualTier is a real option for this slot+domain AND the reason it
 * is suppressed is specifically `hasUiDoc` — never for a backend stack (no UI
 * surface) or an existing codebase (which carries its own spacing). When no UI
 * doc is present the real `spatialSystem` preset already covers spacing, so the
 * floor stays off (no duplication / MECE).
 */
export function shouldEmitVisualTierSpatialFloor(
  slot: BasisSlotConfig | undefined,
  domain: Domain | undefined,
  runtime?: TierRuntimeContext,
): boolean {
  if (!slot?.tiers?.includes('visualTier')) return false;
  if (!domain || !TIER_DOMAIN_MATRIX.visualTier.includes(domain)) return false;
  const ctx = runtime ?? {};
  if (ctx.techTier?.stack === 'backend') return false;
  if (ctx.hasCodebase === true) return false;
  return ctx.hasUiDoc === true;
}

/**
 * Layer-selective gate for the gameArtTier `concept` design-language layer —
 * the game-domain twin of visualTier's `hasUiDoc` suppression, scoped to a
 * single axis.
 *
 * `gameArtTier` is game-domain's single visual SSOT and its `perspective`
 * axis is a load-bearing code render-path switch (2d vs 3d), so — unlike
 * visualTier — we do NOT suppress the whole tier. Instead only the `concept`
 * aesthetic layer is withheld when a game-art reference document is already
 * the art authority (`ctx.hasGameArtDoc === true`): its palette / silhouette /
 * lighting / motion / HUD direction would conflict with the reference. The
 * mechanical axes (perspective + entityCatalog / motionPattern /
 * particleProfile / projectilePolicy / audioProfile) always survive.
 *
 * Returns true (emit the concept layer) iff gameArtTier is a real option for
 * this slot+domain AND no game-art reference is present. Bootstrapping a
 * handoff (no reference yet) → emit, so `concept` seeds the output.
 */
export function shouldEmitGameArtConcept(
  slot: BasisSlotConfig | undefined,
  domain: Domain | undefined,
  runtime?: TierRuntimeContext,
): boolean {
  if (!slot?.tiers?.includes('gameArtTier')) return false;
  if (!domain || !TIER_DOMAIN_MATRIX.gameArtTier.includes(domain)) return false;
  return (runtime ?? {}).hasGameArtDoc !== true;
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
