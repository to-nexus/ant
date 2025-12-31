import { useState } from 'react';
import { ProjectConfig } from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useAvailableModels } from './hooks/useAvailableModels';
import { useConfigEditor } from './hooks/useConfigEditor';
import { CONFIG_SCHEMA } from './configSchema';
import { ConfigEditorHeader } from './components/ConfigEditorHeader';
import { ConfigField } from './components/ConfigField';
import { LLMModelsSection } from './components/LLMModelsSection';

interface ConfigEditorProps {
  config: ProjectConfig;
  onSave: (config: ProjectConfig) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

export function ConfigEditor({ config, onSave, onClose }: ConfigEditorProps) {
  // onClose is handled by MainPanel tab close button (kept for API compatibility)
  void onClose;
  const { availableModels, isLoadingModels, defaultModelId } = useAvailableModels();
  const {
    editedConfig,
    setEditedConfig,
    errors,
    setErrors,
    hasChanges,
    backendMode
  } = useConfigEditor(config, defaultModelId);
  
  const [isSaving, setIsSaving] = useState(false);
  const { showSuccess, showError, showConfirm } = useAlertModalContext();

  const handleChange = (key: keyof ProjectConfig, value: any) => {
    setEditedConfig(prev => {
      const newConfig = {
        ...prev,
        [key]: value
      };
      
      // Provider 변경 시 model 초기화
      if (key === 'llmProvider' && value !== prev.llmProvider) {
        newConfig.llmModel = undefined;
      }
      
      return newConfig;
    });
    
    // Clear error for this field
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    CONFIG_SCHEMA.forEach(field => {
      if (field.required && !editedConfig[field.key]) {
        newErrors[field.key] = `${field.label} is required`;
      }
    });
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      return;
    }
    
    setIsSaving(true);
    try {
      const result = await onSave(editedConfig);
      if (result.success) {
        showSuccess('Configuration saved successfully!');
      } else {
        showError(result.error || 'Failed to save configuration. Please try again.');
      }
    } catch (error) {
      showError('Failed to save configuration. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleModelChange = (nodeType: string, modelId: string) => {
    setEditedConfig(prev => ({
      ...prev,
      llmModels: {
        ...prev.llmModels,
        [nodeType]: modelId
      }
    }));
  };

  const handleDiscardChanges = () => {
    if (!hasChanges) return;
    showConfirm('변경사항을 모두 되돌릴까요?', {
      type: 'warning',
      title: 'Discard changes?',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      onConfirm: () => {
        setEditedConfig(config);
        setErrors({});
      }
    });
  };

  // Cloud 모드에서 repoType 비활성화 여부
  const isRepoTypeDisabled = (fieldKey: string) => {
    return backendMode === 'cloud' && fieldKey === 'repoType';
  };

  return (
    <div className="h-full overflow-hidden flex flex-col bg-white dark:bg-gray-800">
      <ConfigEditorHeader
        hasChanges={hasChanges}
        isSaving={isSaving}
        onSave={handleSave}
        onDiscardChanges={handleDiscardChanges}
      />
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {CONFIG_SCHEMA.map(field => (
            <ConfigField
              key={field.key}
              field={field}
              value={editedConfig[field.key]}
              hasError={!!errors[field.key]}
              errorMessage={errors[field.key]}
              isRepoTypeDisabled={isRepoTypeDisabled(field.key)}
              showLocalPath={backendMode !== 'cloud'}
              onChange={handleChange}
            />
          ))}
          
          {/* LLM Models Section */}
          <LLMModelsSection
            editedConfig={editedConfig}
            availableModels={availableModels}
            isLoadingModels={isLoadingModels}
            onModelChange={handleModelChange}
          />
        </div>
      </div>
    </div>
  );
}
