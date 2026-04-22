import type { SlotDef, UiSource } from '@ant/shared';

export interface SlotWarning {
  type: 'invalid-file' | 'invalid-env';
  message: { en: string; ko: string };
  fixLabel?: { en: string; ko: string };
  onFix?: () => void;
}

export interface SlotFileEntry {
  name: string;
  path: string;
  size?: number;
  warnings: SlotWarning[];
}

/**
 * A subgroup inside a `type: 'ui-source'` slot. Each subgroup maps to one
 * of the three hard-exclusive UiSource kinds (`ant`, `figma`, `handoff`).
 * The UI renders these as grouped cards so the user picks exactly one.
 */
export interface SlotSubgroup {
  id: UiSource;
  dir: string;
  label: { en: string; ko: string };
  humanLabel?: { en: string; ko: string };
  files: SlotFileEntry[];
  hasFiles: boolean;
  hasValidFiles: boolean;
}

export interface SlotEntry {
  def: SlotDef;
  /** Flat file list — used when `def.type !== 'ui-source'`. */
  files: SlotFileEntry[];
  hasFiles: boolean;
  hasValidFiles: boolean;
  /**
   * Populated only when `def.type === 'ui-source'`. When present the caller
   * MUST render grouped cards and enforce hard-exclusive selection across
   * the subgroups (`files` is still populated as a flat union for legacy
   * code paths but should not be used for rendering).
   */
  subgroups?: SlotSubgroup[];
}

export interface FileWarningContext {
  figmaPopulated: boolean | null;
  bridgeConnected: boolean | null;
  figmaDesktopReachable: boolean;
  onOpenFigmaSettings: () => void;
}
