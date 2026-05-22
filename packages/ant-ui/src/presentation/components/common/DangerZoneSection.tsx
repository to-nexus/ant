import { DangerZone } from '../ConfigEditor/aurora';

export interface DangerZoneSectionProps {
  title: string;
  description: string;
  buttonText: string;
  loadingText?: string;
  isLoading?: boolean;
  onAction: () => void | Promise<void>;
}

/**
 * Backwards-compatible wrapper that delegates to the Aurora `DangerZone`
 * primitive. Existing call-sites (ConfigEditor, AccountConfigEditor,
 * ProjectDeletionPanel) continue to import `DangerZoneSection` from this
 * path with no signature changes.
 */
export function DangerZoneSection(props: DangerZoneSectionProps) {
  return <DangerZone {...props} />;
}
