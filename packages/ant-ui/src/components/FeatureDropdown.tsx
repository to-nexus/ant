import { GitBranch } from 'lucide-react';
import { useStore } from '../lib/store';
import { createFeature, deleteFeature } from '../lib/api';
import { ItemDropdown } from './ItemDropdown';

export function FeatureDropdown() {
  const { 
    features, 
    selectedProject, 
    selectedFeature, 
    setSelectedFeature, 
    fetchFeatures,
    refreshFileTree
  } = useStore();

  const handleCreateFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await createFeature(selectedProject, featureName);
    await refreshFileTree();
  };

  const handleDeleteFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await deleteFeature(selectedProject, featureName);
    await refreshFileTree();
  };

  const featureItems = features.map((f) => ({ name: f.name, path: f.path }));

  if (!selectedProject) {
    return null;
  }

  return (
    <ItemDropdown
      title="Features"
      icon={GitBranch}
      items={featureItems}
      selectedItem={selectedFeature}
      onSelect={setSelectedFeature}
      onCreate={handleCreateFeature}
      onDelete={handleDeleteFeature}
      onItemCreated={fetchFeatures}
      placeholder="Select a feature..."
      inputPlaceholder="Feature name..."
    />
  );
}
