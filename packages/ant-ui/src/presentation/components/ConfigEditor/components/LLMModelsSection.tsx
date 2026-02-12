import { useTranslation } from 'react-i18next';
import { ProjectConfig, JobLLMConfig } from '@/infrastructure/http/api';
import { AvailableModel } from '../hooks/useAvailableModels';

interface LLMModelsSectionProps {
  editedConfig: ProjectConfig;
  availableModels: AvailableModel[];
  isLoadingModels: boolean;
  onModelChange: (job: string, nodeType: string, modelId: string) => void;
}

interface NodeConfig {
  key: keyof JobLLMConfig;
  labelKey: string;
  description: string;
}

const DESIGN_NODES: NodeConfig[] = [
  { key: 'default', labelKey: 'llmModels.default', description: 'Default model for all design nodes' },
  { key: 'decompose', labelKey: 'llmModels.decompose', description: 'Task decomposition and planning' },
  { key: 'docGen', labelKey: 'llmModels.docGeneration', description: 'Documentation generation' },
  { key: 'plan', labelKey: 'llmModels.plan', description: 'Context gathering and planning' },
];

const CODE_NODES: NodeConfig[] = [
  { key: 'default', labelKey: 'llmModels.default', description: 'Default model for all code nodes' },
  { key: 'decompose', labelKey: 'llmModels.decompose', description: 'Task decomposition and planning' },
  { key: 'codeGen', labelKey: 'llmModels.codeGeneration', description: 'Code generation and editing' },
  { key: 'plan', labelKey: 'llmModels.plan', description: 'Context gathering and planning' },
];

const LEARN_NODES: NodeConfig[] = [
  { key: 'default', labelKey: 'llmModels.default', description: 'Default model for learning tasks' },
];

export function LLMModelsSection({
  editedConfig,
  availableModels,
  isLoadingModels,
  onModelChange
}: LLMModelsSectionProps) {
  const { t } = useTranslation('config');
  const renderJobSection = (
    jobName: string,
    jobKey: 'design' | 'code' | 'learn',
    nodes: NodeConfig[]
  ) => {
    const jobConfig = editedConfig.llmModels?.[jobKey];
    
    return (
      <div key={jobKey} className="space-y-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
        <h5 className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
          {jobName} Job
        </h5>
        
        {nodes.map(node => (
          <div key={node.key} className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t(node.labelKey)}
              {node.key === 'default' && <span className="text-red-500 ml-1">*</span>}
            </label>
            {node.description && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{node.description}</p>
            )}
            <select
              value={jobConfig?.[node.key] || ''}
              onChange={(e) => onModelChange(jobKey, node.key, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md 
                bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            >
              {node.key === 'default' ? (
                // Default is required, no empty option
                <>
                  {!jobConfig?.[node.key] && <option value="">-- Select Model --</option>}
                  {availableModels.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </>
              ) : (
                // Other nodes are optional, can use job default
                <>
                  <option value="">-- Use Job Default --</option>
                  {availableModels.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        ))}
      </div>
    );
  };
  
  return (
    <div className="space-y-4 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{t('llmModels.title')}</h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Configure models for different jobs and nodes. Each job requires a default model. 
          Nodes can optionally use a different model, otherwise they use the job default.
        </p>
      </div>
      
      {isLoadingModels ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">{t('llmModels.loading')}</div>
      ) : (
        <div className="space-y-4">
          {renderJobSection('Design', 'design', DESIGN_NODES)}
          {renderJobSection('Code', 'code', CODE_NODES)}
          {renderJobSection('Learn', 'learn', LEARN_NODES)}
        </div>
      )}
    </div>
  );
}
