import type { BasisSlotConfig } from '@ant/shared';

export interface BasisWizardState {
  activeTier: 'techTier' | 'visualTier';
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
      spatialSystem?: string;
    };
  };
}

export interface WizardStepDef {
  id: string;
  tierKey: 'techTier' | 'visualTier';
  layerKey: string;
  title: { en: string; ko: string };
  description: { en: string; ko: string };
  /** Group identifier for visual grouping and pause-at-boundary behavior (e.g. 'fe', 'be') */
  group?: string;
}

export interface WizardTierTabItem {
  id: 'techTier' | 'visualTier';
  label: { en: string; ko: string };
  description: { en: string; ko: string };
}

export interface BasisWizardProps {
  basisSlot: BasisSlotConfig;
  onBack: () => void;
  lang: 'en' | 'ko';
}
