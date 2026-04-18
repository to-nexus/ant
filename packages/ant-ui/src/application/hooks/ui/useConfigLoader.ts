import { useState, useEffect } from 'react';
import { fetchProjectConfig, updateProjectConfig, ProjectConfig } from '@/infrastructure/http/api';

interface UseConfigLoaderReturn {
  projectConfigData: ProjectConfig | null;
  isLoadingProjectConfig: boolean;
  handleSaveProjectConfig: (config: ProjectConfig) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Manages project configuration loading and saving
 */
export function useConfigLoader(
  shouldLoad: boolean,
  selectedProject: string | null,
  onSaveSuccess?: () => void,
): UseConfigLoaderReturn {
  const [projectConfigData, setProjectConfigData] = useState<ProjectConfig | null>(null);
  const [isLoadingProjectConfig, setIsLoadingProjectConfig] = useState(false);

  // Load config when editor is opened
  useEffect(() => {
    async function loadProjectConfig() {
      if (!shouldLoad || !selectedProject) {
        setProjectConfigData(null);
        return;
      }

      setIsLoadingProjectConfig(true);
      try {
        const config = await fetchProjectConfig(selectedProject);
        if (config) {
          setProjectConfigData(config);
        }
      } catch (error) {
        console.error('[useConfigLoader] Failed to load project config:', error);
      } finally {
        setIsLoadingProjectConfig(false);
      }
    }

    loadProjectConfig();
  }, [shouldLoad, selectedProject]);

  const handleSaveProjectConfig = async (config: ProjectConfig): Promise<{ success: boolean; error?: string }> => {
    if (!selectedProject) {
      return { success: false, error: 'No project selected' };
    }

    try {
      // Backend now returns the saved config directly
      const savedConfig = await updateProjectConfig(selectedProject, config);
      if (savedConfig) {
        setProjectConfigData(savedConfig);
        
        // ✅ NEW: Trigger callback on successful save
        if (onSaveSuccess) {
          onSaveSuccess();
        }
      }
      return { success: true };
    } catch (error) {
      console.error('[useConfigLoader] Failed to save project config:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to save project configuration'
      };
    }
  };

  return {
    projectConfigData,
    isLoadingProjectConfig,
    handleSaveProjectConfig,
  };
}

