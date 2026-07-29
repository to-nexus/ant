import { useState, useEffect } from 'react';
import { DEFAULT_MODELS } from '@ant/shared';
import { ProjectConfig } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { selectServerMode } from '@/domain/store/selectors/auth';

export function useConfigEditor(
  config: ProjectConfig,
  defaultModelId: string
) {
  const serverMode = useStore((state) => selectServerMode(state));
  const [editedConfig, setEditedConfig] = useState<ProjectConfig>(config);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Cloud BE 에서는 repoType 을 'cloud' 로 강제. serverMode 미해석 동안은
  // 강제 변경하지 않아 한 차례 깜빡임을 방지.
  useEffect(() => {
    if ((serverMode === 'cloud' || serverMode === 'local') && config.repoType !== 'cloud') {
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
  }, [config, serverMode]);

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
            design: {
              default: defaultModelId,
              decompose: defaultModelId,
              plan: DEFAULT_MODELS.opusTier,
              execute: defaultModelId,
            },
            code: {
              default: defaultModelId,
              decompose: DEFAULT_MODELS.opusTier,
              plan: defaultModelId,
              execute: defaultModelId,
            },
            learn: { default: defaultModelId },
            plan: {
              default: defaultModelId,
              plan: DEFAULT_MODELS.opusTier,
              execute: defaultModelId,
            },
            visual: {
              default: 'gemini-3-flash',
              direct: 'gemini-3.1-pro-preview',
              explain: 'gemini-3.1-pro-preview',
              sketch: 'gemini-3.1-flash-image',
              render: 'gemini-3-pro-image',
              engrave: 'gemini-3.1-pro-preview',
            },
            reviewer: { default: DEFAULT_MODELS.opusTier },
            doc: { default: DEFAULT_MODELS.opusTier },
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
    serverMode,
  };
}
