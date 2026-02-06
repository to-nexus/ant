import { useState, useEffect } from 'react';
import { ProjectConfig } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

export function useConfigEditor(
  config: ProjectConfig,
  defaultModelId: string
) {
  const backendMode = useStore((state) => state.backendMode);
  const [editedConfig, setEditedConfig] = useState<ProjectConfig>(config);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Cloud 모드일 때 repoType을 'cloud'로 강제 설정
  useEffect(() => {
    if (backendMode === 'cloud' && config.repoType !== 'cloud') {
      const cloudConfig = {
        ...config,
        repoType: 'cloud' as const,
        localPath: undefined
      };
      setEditedConfig(cloudConfig);
    } else {
      setEditedConfig(config);
    }
    setHasChanges(false);
  }, [config, backendMode]);

  // Set default model from backend if config has empty llmModels
  useEffect(() => {
    if (defaultModelId && editedConfig.llmModels) {
      const hasEmptyModels = Object.keys(editedConfig.llmModels)
        .filter(k => editedConfig.llmModels![k as keyof typeof editedConfig.llmModels])
        .length === 0;
      
      if (hasEmptyModels) {
        setEditedConfig(prev => ({
          ...prev,
          llmModels: {
            design: { default: defaultModelId, decompose: defaultModelId },
            code: { default: defaultModelId, decompose: defaultModelId },
            learn: { default: defaultModelId },
          }
        }));
      }
    }
  }, [defaultModelId, editedConfig.llmModels]);

  // Check for changes whenever editedConfig updates
  useEffect(() => {
    const configChanged = JSON.stringify(editedConfig) !== JSON.stringify(config);
    setHasChanges(configChanged);
  }, [editedConfig, config]);

  return {
    editedConfig,
    setEditedConfig,
    errors,
    setErrors,
    hasChanges,
    backendMode
  };
}
