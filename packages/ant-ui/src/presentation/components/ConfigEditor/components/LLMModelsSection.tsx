import { ProjectConfig } from '@/infrastructure/http/api';
import { AvailableModel } from '../hooks/useAvailableModels';

interface LLMModelsSectionProps {
  editedConfig: ProjectConfig;
  availableModels: AvailableModel[];
  isLoadingModels: boolean;
  onModelChange: (nodeType: string, modelId: string) => void;
}

const NODE_TYPES = [
  { key: 'designDecompose', label: 'Design Decompose', description: 'Model for design job decomposition phase' },
  { key: 'designDefault', label: 'Design Default', description: 'Default model for design job nodes' },
  { key: 'codeDecompose', label: 'Code Decompose', description: 'Model for code job decomposition phase (task planning)' },
  { key: 'codeError', label: 'Code Error', description: 'Model for error tasks' },
  { key: 'codeFinal', label: 'Code Final', description: 'Model for final verification tasks (priority=1000)' },
  { key: 'codeSetup', label: 'Code Setup', description: 'Model for setup tasks' },
  { key: 'codeDefault', label: 'Code Default', description: 'Default model for all other code tasks' },
];

export function LLMModelsSection({
  editedConfig,
  availableModels,
  isLoadingModels,
  onModelChange
}: LLMModelsSectionProps) {
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
          {NODE_TYPES.map(nodeType => (
            <div key={nodeType.key} className="space-y-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {nodeType.label}
              </label>
              {nodeType.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{nodeType.description}</p>
              )}
              <select
                value={editedConfig.llmModels?.[nodeType.key as keyof typeof editedConfig.llmModels] || ''}
                onChange={(e) => onModelChange(nodeType.key, e.target.value)}
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
}
