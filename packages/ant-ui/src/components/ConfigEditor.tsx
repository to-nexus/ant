import { useState, useEffect } from 'react';
import { ProjectConfig } from '@/lib/api';

interface ConfigEditorProps {
  config: ProjectConfig;
  onSave: (config: ProjectConfig) => Promise<void>;
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

const CONFIG_SCHEMA: ConfigField[] = [
  {
    key: 'projectName',
    label: 'Project Name',
    type: 'text',
    required: true,
    description: 'Name of the project'
  },
  {
    key: 'repoType',
    label: 'Repository Type',
    type: 'select',
    required: false,
    options: ['local', 'github'],
    description: 'Type of repository (local or GitHub)'
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
  },
  {
    key: 'llmProvider',
    label: 'LLM Provider',
    type: 'select',
    required: false,
    options: ['anthropic', 'openai'],
    description: 'LLM provider to use'
  },
  {
    key: 'llmModel',
    label: 'LLM Model',
    type: 'text',
    required: false,
    description: 'Specific LLM model name'
  }
];

export function ConfigEditor({ config, onSave, onClose }: ConfigEditorProps) {
  const [editedConfig, setEditedConfig] = useState<ProjectConfig>(config);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setEditedConfig(config);
    setHasChanges(false);
  }, [config]);

  // Check for changes whenever editedConfig updates
  useEffect(() => {
    const configChanged = JSON.stringify(editedConfig) !== JSON.stringify(config);
    setHasChanges(configChanged);
  }, [editedConfig, config]);

  const handleChange = (key: keyof ProjectConfig, value: any) => {
    setEditedConfig(prev => ({
      ...prev,
      [key]: value
    }));
    
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
      await onSave(editedConfig);
    } finally {
      setIsSaving(false);
    }
  };

  const renderField = (field: ConfigField) => {
    const value = editedConfig[field.key];
    const hasError = !!errors[field.key];

    return (
      <div key={field.key} className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {!field.required && (
            <span className="text-xs text-gray-400">Optional</span>
          )}
        </div>
        
        {field.description && (
          <p className="text-xs text-gray-500">{field.description}</p>
        )}
        
        {field.type === 'text' && (
          <input
            type="text"
            value={value as string || ''}
            onChange={(e) => handleChange(field.key, e.target.value)}
            className={`w-full px-3 py-2 border rounded-md text-sm ${
              hasError ? 'border-red-500' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
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
            className={`w-full px-3 py-2 border rounded-md text-sm ${
              hasError ? 'border-red-500' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <option value="">-- Select --</option>
            {field.options?.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}
        
        {field.type === 'boolean' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value as boolean || false}
              onChange={(e) => handleChange(field.key, e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">
              {value ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        )}
        
        {hasError && (
          <p className="text-xs text-red-500">{errors[field.key]}</p>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-hidden flex flex-col bg-white">
      <div className="border-b bg-gray-50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <span>⚙️</span>
            <span>Configuration</span>
          </h3>
          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className={`transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xl ${
                hasChanges && !isSaving
                  ? 'text-green-600 hover:text-green-700'
                  : 'text-gray-400'
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
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors text-xl"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {CONFIG_SCHEMA.map(field => renderField(field))}
        </div>
      </div>
    </div>
  );
}
