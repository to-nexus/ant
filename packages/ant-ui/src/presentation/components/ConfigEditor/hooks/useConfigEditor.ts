import { useState, useEffect } from 'react';
import { ProjectConfig } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { selectServerMode } from '@/domain/store/selectors/auth';

/**
 * Editor state for a `ProjectConfig`.
 *
 * There is deliberately NO local "seed empty llmModels with defaults" step: the BE
 * `GET /projects/:id/config` heals every job slot from the single binding table
 * (`ant-cli/src/core/config/defaultModels.ts`) before responding, so a config that
 * reaches here always carries a complete table. A parallel FE copy of those defaults
 * is what let the `commit` slot go missing from the picker.
 */
export function useConfigEditor(config: ProjectConfig) {
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
