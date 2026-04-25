import type { BasisSlotConfig } from '@ant/shared';

/**
 * Wizard-internal tier identifier (Phase 1 — five tiers).
 *
 * Mirrors the BE `TierKey` union from `@ant/shared/tier-matrix.ts`.
 * `domain` itself is not a wizard tier (it's a single-toggle decision
 * handled by `DomainToggle`); only tiers that present multi-step
 * selection appear here.
 *
 * Adding a new tier requires:
 *   1. extending this union,
 *   2. adding a TIER_REGISTRY entry,
 *   3. adding a TIER_STEP_DEF entry (per-tier WizardStepDef[] from `TierStepDef.ts`),
 *   4. extending the BasisWizardState.selections shape,
 *   5. wiring options inside `useBasisWizard.getOptionsForStep`,
 *   6. handling the new layerKeys inside `useBasisWizard.selectVariant`/`goToStep`.
 */
export type TierKey = 'techTier' | 'visualTier' | 'artTier' | 'gameContentTier';

export interface BasisWizardState {
  activeTier: TierKey;
  stepIndex: number;
  selections: {
    techTier: {
      stack?: string;
      language?: string;
      framework?: string;
      feLanguage?: string;
      feFramework?: string;
      beLanguage?: string;
      beFramework?: string;
      gameEngine?: string;
    };
    visualTier: {
      designSystem?: string;
      visualLanguage?: string;
      surfaceSystem?: string;
    };
    artTier: {
      concept?: string;
      perspective?: string;
    };
    gameContentTier: {
      genre?: string;
      coreLoop?: string;
    };
  };
}

export interface WizardStepDef {
  id: string;
  tierKey: TierKey;
  layerKey: string;
  title: { en: string; ko: string };
  description: { en: string; ko: string };
  /** Group identifier for visual grouping and pause-at-boundary behavior (e.g. 'fe', 'be') */
  group?: string;
}

export interface WizardTierTabItem {
  id: TierKey;
  label: { en: string; ko: string };
  description: { en: string; ko: string };
}

export interface BasisWizardProps {
  basisSlot: BasisSlotConfig;
  onBack: () => void;
  lang: 'en' | 'ko';
  /** Tier the wizard should land on. Falls back to the first configured tier
   * when omitted or when the requested tier isn't configured for this slot. */
  initialTier?: TierKey;
}
