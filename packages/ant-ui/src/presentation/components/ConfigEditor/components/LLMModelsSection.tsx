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
  { key: 'default', labelKey: 'llmModels.default', description: 'llmModels.defaultDesignDesc' },
  { key: 'decompose', labelKey: 'llmModels.decompose', description: 'llmModels.decomposeDesc' },
  { key: 'docGen', labelKey: 'llmModels.docGeneration', description: 'llmModels.docGenDesc' },
  { key: 'plan', labelKey: 'llmModels.plan', description: 'llmModels.planDesc' },
];

const CODE_NODES: NodeConfig[] = [
  { key: 'default', labelKey: 'llmModels.default', description: 'llmModels.defaultCodeDesc' },
  { key: 'decompose', labelKey: 'llmModels.decompose', description: 'llmModels.decomposeDesc' },
  { key: 'execute', labelKey: 'llmModels.codeGeneration', description: 'llmModels.codeGenDesc' },
  { key: 'plan', labelKey: 'llmModels.plan', description: 'llmModels.planDesc' },
];

const LEARN_NODES: NodeConfig[] = [
  { key: 'default', labelKey: 'llmModels.default', description: 'llmModels.defaultLearnDesc' },
];

const PLAN_NODES: NodeConfig[] = [
  { key: 'default', labelKey: 'llmModels.default', description: 'llmModels.defaultPlanDesc' },
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
    jobKey: 'design' | 'code' | 'learn' | 'plan',
    nodes: NodeConfig[]
  ) => {
    const jobConfig = editedConfig.llmModels?.[jobKey];
    
    return (
      <div key={jobKey} className="space-y-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
        <h5 className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
          {t('projectEditor.jobTitle', { name: jobName })}
        </h5>
        
        {nodes.map(node => (
          <div key={node.key} className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t(node.labelKey)}
              {node.key === 'default' && <span className="text-red-500 ml-1">*</span>}
            </label>
            {node.description && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{t(node.description)}</p>
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
                  {!jobConfig?.[node.key] && <option value="">{t('projectEditor.selectModel')}</option>}
                  {availableModels.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </>
              ) : (
                // Other nodes are optional, can use job default
                <>
                  <option value="">{t('projectEditor.useJobDefault')}</option>
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
          {t('projectEditor.llmDescription')}
        </p>
      </div>
      
      {isLoadingModels ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">{t('llmModels.loading')}</div>
      ) : (
        <div className="space-y-4">
          {renderJobSection('Design', 'design', DESIGN_NODES)}
          {renderJobSection('Code', 'code', CODE_NODES)}
          {renderJobSection('Plan', 'plan', PLAN_NODES)}
          {renderJobSection('Learn', 'learn', LEARN_NODES)}
        </div>
      )}
    </div>
  );
}
