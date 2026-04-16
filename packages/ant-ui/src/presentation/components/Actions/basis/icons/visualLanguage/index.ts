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

import type { FC } from 'react';
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

type PreviewComponent = FC<{ className?: string }>;

export const VL_ICON_MAP: Record<string, PreviewComponent> = {
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
};

export const VL_FULL_MAP: Record<string, PreviewComponent> = {
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
};
