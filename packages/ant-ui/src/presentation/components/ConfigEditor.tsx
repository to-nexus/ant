import { useState, useEffect } from 'react';
import { ProjectConfig } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';

interface ConfigEditorProps {
  config: ProjectConfig;
  onSave: (config: ProjectConfig) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

interface ConfigField {
  key: keyof ProjectConfig;
  label: string;
  type: 'text' | 'boolean' | 'select';
  required: boolean;
  options?: string[];
  description?: string;
}

// LLM Model options by provider (optimized for coding)
const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude 4.5 Sonnet (Latest, best for coding)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude 4.5 Haiku (Fast & efficient)' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o (Optimized)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
    { value: 'o1-preview', label: 'o1 Preview (Advanced reasoning)' },
    { value: 'o1-mini', label: 'o1 Mini (Efficient reasoning)' },
  ],
};

const CONFIG_SCHEMA: ConfigField[] = [
  {
    key: 'repositoryName',
    label: 'Repository Name',
    type: 'text',
    required: true,
    description: 'Name of the codebase/repository'
  },
  {
    key: 'repoType',
    label: 'Repository Type',
    type: 'select',
    required: false,
    options: ['local', 'cloud', 'github'],
    description: 'Type of repository (local, cloud, or GitHub)'
  },
  {
    key: 'localPath',
    label: 'Local Path',
    type: 'text',
    required: false,
    description: 'Path to local repository. Supports: absolute (/Users/...), home (~/ ), or relative from ant-cli (../../../my-repo)'
  },
  {
    key: 'githubRepo',
    label: 'GitHub Repository',
    type: 'text',
    required: false,
    description: 'GitHub repository URL (for github repo type)'
  },
  {
    key: 'branchBase',
    label: 'Base Branch',
    type: 'text',
    required: true,
    description: 'Base branch name (e.g., main, master)'
  },
  {
    key: 'autoLearn',
    label: 'Auto Learn',
    type: 'boolean',
    required: true,
    description: 'Enable automatic learning from code changes'
  },
  {
    key: 'strictValidation',
    label: 'Strict Validation',
    type: 'boolean',
    required: false,
    description: 'Enable strict validation mode'
  }
];

export function ConfigEditor({ config, onSave, onClose }: ConfigEditorProps) {
  const backendMode = useStore((state) => state.backendMode);
  const [editedConfig, setEditedConfig] = useState<ProjectConfig>(config);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const { showSuccess, showError, AlertModal } = useAlertModal();
  
  // ✅ Available models from backend
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; displayName: string; provider: string }>>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  
  useEffect(() => {
    async function loadModels() {
      setIsLoadingModels(true);
      try {
        const response = await import('@/infrastructure/http/api').then(m => m.fetchAvailableModels());
        setAvailableModels(response.models.map(m => ({
          id: m.id,
          displayName: m.displayName,
          provider: m.provider
        })));
        
        // ✅ Set default model from backend if config has empty llmModels
        if (!editedConfig.llmModels || Object.keys(editedConfig.llmModels).filter(k => editedConfig.llmModels![k as keyof typeof editedConfig.llmModels]).length === 0) {
          const defaultModelId = response.default;
          setEditedConfig(prev => ({
            ...prev,
            llmModels: {
              designDecompose: defaultModelId,
              designDefault: defaultModelId,
              codeDecompose: defaultModelId,
              codeError: defaultModelId,
              codeFinal: defaultModelId,
              codeSetup: defaultModelId,  // ✅ Setup tasks
              codeDefault: defaultModelId,
            }
          }));
        }
      } catch (error) {
        console.error('Failed to load available models:', error);
      } finally {
        setIsLoadingModels(false);
      }
    }
    loadModels();
  }, []);

  // ✅ Cloud 모드일 때 repoType을 'cloud'로 강제 설정
  useEffect(() => {
    if (backendMode === 'cloud' && config.repoType !== 'cloud') {
      const cloudConfig = {
        ...config,
        repoType: 'cloud' as const,
        localPath: undefined  // localPath 제거
      };
      setEditedConfig(cloudConfig);
    } else {
      setEditedConfig(config);
    }
    setHasChanges(false);
  }, [config, backendMode]);

  // Check for changes whenever editedConfig updates
  useEffect(() => {
    const configChanged = JSON.stringify(editedConfig) !== JSON.stringify(config);
    setHasChanges(configChanged);
  }, [editedConfig, config]);
  
  const handleChange = (key: keyof ProjectConfig, value: any) => {
    setEditedConfig(prev => {
      const newConfig = {
        ...prev,
        [key]: value
      };
      
      // ✅ Provider 변경 시 model 초기화
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
  
  // ✅ Handle LLM model changes
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
    
    if (confirm('Are you sure you want to discard all changes?')) {
      setEditedConfig(config);
      setErrors({});
    }
  };
  
  const renderField = (field: ConfigField) => {
    const value = editedConfig[field.key];
    const hasError = !!errors[field.key];
    
    // ✅ Cloud 모드에서 localPath 필드 숨김
    if (backendMode === 'cloud' && field.key === 'localPath') {
      return null;
    }
    
    // ✅ Cloud 모드에서 repoType 비활성화 (cloud로 고정)
    const isRepoTypeDisabled = backendMode === 'cloud' && field.key === 'repoType';

    return (
      <div key={field.key} className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {!field.required && (
            <span className="text-xs text-gray-400 dark:text-gray-500">Optional</span>
          )}
        </div>
        
        {field.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {field.description}
            {isRepoTypeDisabled && ' (Fixed in Cloud Mode)'}
            {field.key === 'llmModel' && !editedConfig.llmProvider && ' (Select provider first)'}
          </p>
        )}
        
        {field.type === 'text' && (
          <input
            type="text"
            value={value as string || ''}
            onChange={(e) => handleChange(field.key, e.target.value)}
            className={`w-full px-3 py-2 border rounded-md text-sm 
              bg-white dark:bg-gray-800 
              text-gray-900 dark:text-white
              ${
                hasError 
                  ? 'border-red-500 dark:border-red-400' 
                  : 'border-gray-300 dark:border-gray-600'
              } 
              focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
              placeholder:text-gray-400 dark:placeholder:text-gray-500`}
            placeholder={
              field.key === 'localPath' 
                ? '~/dev/my-repo or ../my-repo or /absolute/path' 
                : field.label
            }
          />
        )}
        
        {field.type === 'select' && (
          <select
            value={value as string || ''}
            onChange={(e) => handleChange(field.key, e.target.value || undefined)}
            disabled={isRepoTypeDisabled || (field.key === 'llmModel' && !editedConfig.llmProvider)}
            className={`w-full px-3 py-2 border rounded-md text-sm 
              bg-white dark:bg-gray-800 
              text-gray-900 dark:text-white
              ${
                hasError 
                  ? 'border-red-500 dark:border-red-400' 
                  : 'border-gray-300 dark:border-gray-600'
              } 
              ${isRepoTypeDisabled || (field.key === 'llmModel' && !editedConfig.llmProvider) ? 'opacity-50 cursor-not-allowed' : ''}
              focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400`}
          >
            {!isRepoTypeDisabled && <option value="">-- Select --</option>}
            {/* ✅ Dynamic model options based on provider */}
            {field.key === 'llmModel' && editedConfig.llmProvider ? (
              LLM_MODELS[editedConfig.llmProvider]?.map(model => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))
            ) : (
              field.options?.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))
            )}
          </select>
        )}
        
        {field.type === 'boolean' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value as boolean || false}
              onChange={(e) => handleChange(field.key, e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-700"
            />
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Enabled
            </span>
          </label>
        )}
        
        {hasError && (
          <p className="text-xs text-red-500">{errors[field.key]}</p>
        )}
      </div>
    );
  };
  
  const renderLLMModelsSection = () => {
    const nodeTypes = [
      { key: 'designDecompose', label: 'Design Decompose', description: 'Model for design job decomposition phase' },
      { key: 'designDefault', label: 'Design Default', description: 'Default model for design job nodes' },
      { key: 'codeDecompose', label: 'Code Decompose', description: 'Model for code job decomposition phase (task planning)' },
      { key: 'codeError', label: 'Code Error', description: 'Model for error tasks' },
      { key: 'codeFinal', label: 'Code Final', description: 'Model for final verification tasks (priority=1000)' },
      { key: 'codeSetup', label: 'Code Setup', description: 'Model for setup tasks' },
      { key: 'codeDefault', label: 'Code Default', description: 'Default model for all other code tasks' },
    ];
    
    return (
      <div className="space-y-4 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">LLM Models by Task Type</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Configure different models for different job phases and task types. Leave empty to use default model.
          </p>
        </div>
        
        {isLoadingModels ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading available models...</div>
        ) : (
          <div className="space-y-3">
            {nodeTypes.map(nodeType => (
              <div key={nodeType.key} className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {nodeType.label}
                </label>
                {nodeType.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{nodeType.description}</p>
                )}
                <select
                  value={editedConfig.llmModels?.[nodeType.key as keyof typeof editedConfig.llmModels] || ''}
                  onChange={(e) => handleModelChange(nodeType.key, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md 
                    bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                >
                  <option value="">-- Use Default --</option>
                  {availableModels.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-hidden flex flex-col bg-white dark:bg-gray-800">
      <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
            <span>⚙️</span>
            <span>Project Configuration</span>
          </h3>
          <div className="flex items-center gap-4">
            <button
              onClick={handleDiscardChanges}
              disabled={!hasChanges}
              className={`transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xl ${
                hasChanges
                  ? 'text-yellow-600 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300'
                  : 'text-gray-400 dark:text-gray-600'
              }`}
              title={
                !hasChanges
                  ? 'No changes to discard'
                  : 'Discard Changes'
              }
            >
              ↺
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className={`transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xl ${
                hasChanges && !isSaving
                  ? 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300'
                  : 'text-gray-400 dark:text-gray-600'
              }`}
              title={
                isSaving
                  ? 'Saving...'
                  : !hasChanges
                  ? 'No changes to save'
                  : 'Save Changes'
              }
            >
              ✓
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {CONFIG_SCHEMA.map(field => renderField(field))}
          
          {/* LLM Models Section */}
          {renderLLMModelsSection()}
        </div>
      </div>
      
      {/* Alert Modal */}
      <AlertModal />
    </div>
  );
}
