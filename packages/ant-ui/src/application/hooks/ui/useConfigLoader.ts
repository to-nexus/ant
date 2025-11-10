import { useState, useEffect } from 'react';
import { fetchProjectConfig, updateProjectConfig, ProjectConfig } from '@/infrastructure/http/api';

interface UseConfigLoaderReturn {
  configData: ProjectConfig | null;
  isLoadingConfig: boolean;
  handleSaveConfig: (config: ProjectConfig) => Promise<void>;
}

/**
 * Manages project configuration loading and saving
 */
export function useConfigLoader(
  showConfigEditor: boolean,
  selectedProject: string | null
): UseConfigLoaderReturn {
  const [configData, setConfigData] = useState<ProjectConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  // Load config when editor is opened
  useEffect(() => {
    async function loadConfig() {
      if (!showConfigEditor || !selectedProject) {
        setConfigData(null);
        return;
      }

      setIsLoadingConfig(true);
      try {
        const config = await fetchProjectConfig(selectedProject);
        if (config) {
          setConfigData(config);
        }
      } catch (error) {
        console.error('[useConfigLoader] Failed to load config:', error);
      } finally {
        setIsLoadingConfig(false);
      }
    }

    loadConfig();
  }, [showConfigEditor, selectedProject]);

  const handleSaveConfig = async (config: ProjectConfig) => {
    if (!selectedProject) return;

    try {
      // Backend now returns the saved config directly
      const savedConfig = await updateProjectConfig(selectedProject, config);
      if (savedConfig) {
        setConfigData(savedConfig);
      }
      alert('Configuration saved successfully!');
    } catch (error) {
      console.error('[useConfigLoader] Failed to save config:', error);
      alert('Failed to save configuration. Please try again.');
    }
  };

  return {
    configData,
    isLoadingConfig,
    handleSaveConfig,
  };
}

