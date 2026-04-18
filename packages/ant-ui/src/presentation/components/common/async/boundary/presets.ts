import type { LoadingShape } from './fallbacks';

export type Surface = 'page' | 'panel' | 'region' | 'modal' | 'inline';

export interface SurfacePreset {
  /** Delay before showing the loading UI. Keeps fast responses flash-free. */
  delayMs: number;
  /** Minimum visible duration once the loading UI has been shown. Avoids flicker. */
  minShowMs: number;
  /** Threshold after which `longWait` affordances (message/Cancel) become available. */
  longWaitMs: number;
  /** The shape rendered by <LoadingFallback>. Centralised so surface identity is consistent. */
  loadingShape: LoadingShape;
}

export const PRESETS: Record<Surface, SurfacePreset> = {
  page: {
    delayMs: 200,
    minShowMs: 400,
    longWaitMs: 5000,
    loadingShape: 'page-skeleton',
  },
  panel: {
    delayMs: 200,
    minShowMs: 400,
    longWaitMs: 5000,
    loadingShape: 'panel-skeleton',
  },
  region: {
    delayMs: 200,
    minShowMs: 400,
    longWaitMs: 5000,
    loadingShape: 'region-skeleton',
  },
  modal: {
    delayMs: 100,
    minShowMs: 300,
    longWaitMs: 5000,
    loadingShape: 'spinner-center',
  },
  inline: {
    delayMs: 0,
    minShowMs: 200,
    longWaitMs: 5000,
    loadingShape: 'inline',
  },
};
