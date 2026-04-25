import type { BasisSlotConfig } from '@ant/shared';

/**
 * Wizard-internal tier identifier. The registry in `constants.ts` is the
 * single source of truth for which tiers exist; adding a new tier should be
 * a one-line registry entry plus extending this union.
 */
export type TierKey = 'techTier' | 'visualTier';

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
    };
    visualTier: {
      designSystem?: string;
      visualLanguage?: string;
      surfaceSystem?: string;
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
