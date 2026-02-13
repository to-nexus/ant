import { useTranslation } from 'react-i18next';
import { GitBranch, Monitor } from 'lucide-react';
import { ItemDropdown } from '../../ItemDropdown';

interface FeatureDropdownProps {
  features: Array<{ name: string; path: string }>;
  selectedFeature: string | undefined;
  isPreviewLoading: boolean;
  previewRunning: boolean;
  canChangeFeature: boolean;
  canCreateFeature: boolean;
  canStartPreview: boolean;
  canStopPreview: boolean;
  disabledReason?: string;
  createDisabledReason?: string;
  onFeatureChange: (featureName: string | null) => void;
  onCreate: (featureName: string) => Promise<void>;
  onDelete: (featureName: string) => Promise<void>;
  onItemCreated?: () => void;
  onPlayClick: () => void;
  onStopClick: () => void;
  onSettingsClick?: () => void;
}

export function FeatureDropdown({
  features,
  selectedFeature,
  isPreviewLoading,
  previewRunning,
  canChangeFeature,
  canCreateFeature,
  canStartPreview,
  canStopPreview,
  disabledReason,
  createDisabledReason,
  onFeatureChange,
  onCreate,
  onDelete,
  onItemCreated,
  onPlayClick,
  onStopClick,
  onSettingsClick
}: FeatureDropdownProps) {
  const { t } = useTranslation('explorer');
  // Filter out 'main' feature (internal use only)
  const featureItems = features
    .filter((f) => f.name !== 'main')
    .map((f) => ({ name: f.name, path: f.path }));

  return (
    <ItemDropdown
      title={t('feature.title')}
      icon={GitBranch}
      items={featureItems}
      selectedItem={selectedFeature}
      onSelect={onFeatureChange}
      onCreate={onCreate}
      onDelete={onDelete}
      onItemCreated={onItemCreated}
      placeholder={t('feature.placeholder')}
      inputPlaceholder={t('featureDropdown.featureNamePlaceholder')}
      onPlayClick={onPlayClick}
      onStopClick={onStopClick}
      onSettingsClick={onSettingsClick}
      settingsIcon={Monitor}
      isPlaying={previewRunning}
      disabled={!canChangeFeature}
      disabledReason={disabledReason}
      canCreate={canCreateFeature}
      createDisabledReason={createDisabledReason}
      playButtonDisabled={!canStartPreview && !canStopPreview}
      playButtonLoading={isPreviewLoading}
    />
  );
}
