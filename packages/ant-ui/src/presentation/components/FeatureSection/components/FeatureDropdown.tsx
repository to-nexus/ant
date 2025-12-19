import { GitBranch } from 'lucide-react';
import { ItemDropdown } from '../../ItemDropdown';

interface FeatureDropdownProps {
  features: Array<{ name: string; path: string }>;
  selectedFeature: string | undefined;
  isDevServerLoading: boolean;
  devServerRunning: boolean;
  canChangeFeature: boolean;
  canStartDevServer: boolean;
  canStopDevServer: boolean;
  disabledReason?: string;
  onFeatureChange: (featureName: string | null) => void;
  onCreate: (featureName: string) => Promise<void>;
  onDelete: (featureName: string) => Promise<void>;
  onItemCreated: () => void;
  onPlayClick: () => void;
  onStopClick: () => void;
}

export function FeatureDropdown({
  features,
  selectedFeature,
  isDevServerLoading,
  devServerRunning,
  canChangeFeature,
  canStartDevServer,
  canStopDevServer,
  disabledReason,
  onFeatureChange,
  onCreate,
  onDelete,
  onItemCreated,
  onPlayClick,
  onStopClick
}: FeatureDropdownProps) {
  // Filter out 'main' feature (internal use only)
  const featureItems = features
    .filter((f) => f.name !== 'main')
    .map((f) => ({ name: f.name, path: f.path }));

  return (
    <ItemDropdown
      title="Features"
      icon={GitBranch}
      items={featureItems}
      selectedItem={selectedFeature}
      onSelect={onFeatureChange}
      onCreate={onCreate}
      onDelete={onDelete}
      onItemCreated={onItemCreated}
      placeholder="Select a feature..."
      inputPlaceholder="Feature name..."
      onPlayClick={onPlayClick}
      onStopClick={onStopClick}
      isPlaying={devServerRunning}
      disabled={!canChangeFeature}
      disabledReason={disabledReason}
      playButtonDisabled={!canStartDevServer && !canStopDevServer}
      playButtonLoading={isDevServerLoading}
    />
  );
}
