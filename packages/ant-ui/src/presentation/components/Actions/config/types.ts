import type { SlotDef } from '@ant/shared';

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

export interface SlotEntry {
  def: SlotDef;
  files: SlotFileEntry[];
  hasFiles: boolean;
  hasValidFiles: boolean;
}

export interface FileWarningContext {
  figmaPopulated: boolean | null;
  bridgeConnected: boolean | null;
  figmaDesktopReachable: boolean;
  onOpenFigmaSettings: () => void;
}
