export { ModernSaasPreview, ModernSaasFullPreview } from './ModernSaas';
export { EnterprisePreview, EnterpriseFullPreview } from './Enterprise';
export { FintechPremiumPreview, FintechPremiumFullPreview } from './FintechPremium';
export { DevtoolDarkPreview, DevtoolDarkFullPreview } from './DevtoolDark';
export { MinimalNeutralPreview, MinimalNeutralFullPreview } from './MinimalNeutral';
export { CleanBrightPreview, CleanBrightFullPreview } from './CleanBright';
export { NeutralProPreview, NeutralProFullPreview } from './NeutralPro';
export { WarmNaturalPreview, WarmNaturalFullPreview } from './WarmNatural';
export { DeepMutedPreview, DeepMutedFullPreview } from './DeepMuted';
export { EditorialBoldPreview, EditorialBoldFullPreview } from './EditorialBold';
export { DarkLuxuryPreview, DarkLuxuryFullPreview } from './DarkLuxury';
export { BoldPlayfulPreview, BoldPlayfulFullPreview } from './BoldPlayful';
export { NeoBrutalistPreview, NeoBrutalistFullPreview } from './NeoBrutalist';
export { BentoModernPreview, BentoModernFullPreview } from './BentoModern';
export { SoftClayPreview, SoftClayFullPreview } from './SoftClay';
export { CyberpunkNeonPreview, CyberpunkNeonFullPreview } from './CyberpunkNeon';
export { CinematicDarkPreview, CinematicDarkFullPreview } from './CinematicDark';
export { CrispMinimalPreview, CrispMinimalFullPreview } from './CrispMinimal';
export { RetroFuturePreview, RetroFutureFullPreview } from './RetroFuture';
export { NexusDSPreview, NexusDSFullPreview } from './NexusDS';

import type { FC } from 'react';
import { ModernSaasPreview, ModernSaasFullPreview } from './ModernSaas';
import { EnterprisePreview, EnterpriseFullPreview } from './Enterprise';
import { FintechPremiumPreview, FintechPremiumFullPreview } from './FintechPremium';
import { DevtoolDarkPreview, DevtoolDarkFullPreview } from './DevtoolDark';
import { MinimalNeutralPreview, MinimalNeutralFullPreview } from './MinimalNeutral';
import { CleanBrightPreview, CleanBrightFullPreview } from './CleanBright';
import { NeutralProPreview, NeutralProFullPreview } from './NeutralPro';
import { WarmNaturalPreview, WarmNaturalFullPreview } from './WarmNatural';
import { DeepMutedPreview, DeepMutedFullPreview } from './DeepMuted';
import { EditorialBoldPreview, EditorialBoldFullPreview } from './EditorialBold';
import { DarkLuxuryPreview, DarkLuxuryFullPreview } from './DarkLuxury';
import { BoldPlayfulPreview, BoldPlayfulFullPreview } from './BoldPlayful';
import { NeoBrutalistPreview, NeoBrutalistFullPreview } from './NeoBrutalist';
import { BentoModernPreview, BentoModernFullPreview } from './BentoModern';
import { SoftClayPreview, SoftClayFullPreview } from './SoftClay';
import { CyberpunkNeonPreview, CyberpunkNeonFullPreview } from './CyberpunkNeon';
import { CinematicDarkPreview, CinematicDarkFullPreview } from './CinematicDark';
import { CrispMinimalPreview, CrispMinimalFullPreview } from './CrispMinimal';
import { RetroFuturePreview, RetroFutureFullPreview } from './RetroFuture';
import { NexusDSPreview, NexusDSFullPreview } from './NexusDS';

type PreviewComponent = FC<{ className?: string }>;

export const VL_ICON_MAP: Record<string, PreviewComponent> = {
  modernSaas: ModernSaasPreview,
  enterprise: EnterprisePreview,
  fintechPremium: FintechPremiumPreview,
  devtoolDark: DevtoolDarkPreview,
  minimalNeutral: MinimalNeutralPreview,
  cleanBright: CleanBrightPreview,
  neutralPro: NeutralProPreview,
  warmNatural: WarmNaturalPreview,
  deepMuted: DeepMutedPreview,
  editorialBold: EditorialBoldPreview,
  darkLuxury: DarkLuxuryPreview,
  boldPlayful: BoldPlayfulPreview,
  neoBrutalist: NeoBrutalistPreview,
  bentoModern: BentoModernPreview,
  softClay: SoftClayPreview,
  cyberpunkNeon: CyberpunkNeonPreview,
  cinematicDark: CinematicDarkPreview,
  crispMinimal: CrispMinimalPreview,
  retroFuture: RetroFuturePreview,
  nexusDS: NexusDSPreview,
};

export const VL_FULL_MAP: Record<string, PreviewComponent> = {
  modernSaas: ModernSaasFullPreview,
  enterprise: EnterpriseFullPreview,
  fintechPremium: FintechPremiumFullPreview,
  devtoolDark: DevtoolDarkFullPreview,
  minimalNeutral: MinimalNeutralFullPreview,
  cleanBright: CleanBrightFullPreview,
  neutralPro: NeutralProFullPreview,
  warmNatural: WarmNaturalFullPreview,
  deepMuted: DeepMutedFullPreview,
  editorialBold: EditorialBoldFullPreview,
  darkLuxury: DarkLuxuryFullPreview,
  boldPlayful: BoldPlayfulFullPreview,
  neoBrutalist: NeoBrutalistFullPreview,
  bentoModern: BentoModernFullPreview,
  softClay: SoftClayFullPreview,
  cyberpunkNeon: CyberpunkNeonFullPreview,
  cinematicDark: CinematicDarkFullPreview,
  crispMinimal: CrispMinimalFullPreview,
  retroFuture: RetroFutureFullPreview,
  nexusDS: NexusDSFullPreview,
};
