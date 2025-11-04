import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { fetchFeatures, createFeature, deleteFeature } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { GitBranch } from 'lucide-react';

export function FeatureList() {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const features = useStore((state) => state.features);
  const selectFeature = useStore((state) => state.selectFeature);
  const setFeatures = useStore((state) => state.setFeatures);
  
  const [isCreating, setIsCreating] = useState(false);
  const [newFeatureName, setNewFeatureName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedProject) {
      setFeatures([]);
      return;
    }

    loadFeatures();
  }, [selectedProject]);

  const loadFeatures = async () => {
    if (!selectedProject) return;
    
    try {
      setLoading(true);
      const featureList = await fetchFeatures(selectedProject);
      setFeatures(featureList);
    } catch (error) {
      console.error('Failed to load features:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFeature = async () => {
    if (!selectedProject || !newFeatureName.trim()) return;
    
    try {
      setLoading(true);
      await createFeature(selectedProject, newFeatureName.trim());
      setNewFeatureName('');
      setIsCreating(false);
      await loadFeatures();
    } catch (error) {
      console.error('Failed to create feature:', error);
      alert('Failed to create feature');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFeature = async (featureName: string) => {
    if (!selectedProject) return;
    
    if (!confirm(`Are you sure you want to delete feature "${featureName}"?`)) {
      return;
    }
    
    try {
      setLoading(true);
      await deleteFeature(selectedProject, featureName);
      if (selectedFeature === featureName) {
        selectFeature('');
      }
      await loadFeatures();
    } catch (error) {
      console.error('Failed to delete feature:', error);
      alert('Failed to delete feature');
    } finally {
      setLoading(false);
    }
  };

  if (!selectedProject) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Select a project to view features
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Features
          </CardTitle>
          <Button 
            size="sm" 
            onClick={() => setIsCreating(!isCreating)}
            disabled={loading}
          >
            {isCreating ? 'Cancel' : '+ New'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isCreating && (
          <div className="mb-4 p-3 border rounded-lg bg-muted/50">
            <input
              type="text"
              placeholder="Feature name (e.g., add-user-auth)"
              value={newFeatureName}
              onChange={(e) => setNewFeatureName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFeature();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              className="w-full px-3 py-2 border rounded mb-2"
              autoFocus
            />
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={handleCreateFeature}
                disabled={!newFeatureName.trim() || loading}
              >
                Create
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => {
                  setIsCreating(false);
                  setNewFeatureName('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {loading && features.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : features.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No features yet. Create one to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {features.map((feature) => (
              <div
                key={feature.name}
                className={`
                  group p-3 rounded-lg border cursor-pointer transition-colors
                  ${selectedFeature === feature.name 
                    ? 'border-primary-500 bg-primary-50 shadow-md' 
                    : 'border-gray-200 hover:bg-gray-50'
                  }
                `}
                onClick={() => selectFeature(feature.name)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${selectedFeature === feature.name ? 'text-gray-900' : 'text-gray-700'}`}>
                      {feature.name}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFeature(feature.name);
                    }}
                    disabled={loading}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-red-600 hover:bg-red-50 h-6 w-6 p-0 text-xs"
                  >
                    ❌
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
