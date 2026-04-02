import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { ProjectConfig, JobLLMConfig } from '@/infrastructure/http/api';
import { AvailableModel } from '../hooks/useAvailableModels';
import { StatusChip } from '../../StatusChip';
import { ModelSelectChip } from './ModelSelectChip';

interface LLMModelsSectionProps {
  editedConfig: ProjectConfig;
  availableModels: AvailableModel[];
  isLoadingModels: boolean;
  onModelChange: (job: string, nodeType: string, modelId: string) => void;
}

interface NodeConfig {
  key: keyof JobLLMConfig;
  label: string;
  description: string;
}

interface JobSectionConfig {
  jobKey: 'design' | 'code' | 'learn' | 'plan' | 'visual';
  jobLabel: string;
  agentLabel: string;
  nodes: NodeConfig[];
}

const DESIGN_NODES: NodeConfig[] = [
  { key: 'default', label: 'Default', description: 'llmModels.defaultDesignDesc' },
  { key: 'decompose', label: 'Decompose', description: 'llmModels.decomposeDesc' },
  { key: 'docGen', label: 'Doc Generation', description: 'llmModels.docGenDesc' },
  { key: 'plan', label: 'Plan', description: 'llmModels.planDesc' },
];

const CODE_NODES: NodeConfig[] = [
  { key: 'default', label: 'Default', description: 'llmModels.defaultCodeDesc' },
  { key: 'decompose', label: 'Decompose', description: 'llmModels.decomposeDesc' },
  { key: 'execute', label: 'Execute', description: 'llmModels.codeExecuteDesc' },
  { key: 'plan', label: 'Plan', description: 'llmModels.planDesc' },
];

const LEARN_NODES: NodeConfig[] = [
  { key: 'default', label: 'Default', description: 'llmModels.defaultLearnDesc' },
];

const PLAN_NODES: NodeConfig[] = [
  { key: 'default', label: 'Default', description: 'llmModels.defaultPlanDesc' },
];

const VISUAL_NODES: NodeConfig[] = [
  { key: 'default', label: 'Default', description: 'llmModels.defaultVisualDesc' },
  { key: 'direct', label: 'Direct', description: 'llmModels.directDesc' },
  { key: 'sketch', label: 'Sketch', description: 'llmModels.sketchDesc' },
  { key: 'render', label: 'Render', description: 'llmModels.renderDesc' },
  { key: 'engrave', label: 'Engrave', description: 'llmModels.engraveDesc' },
];

const JOB_SECTIONS: JobSectionConfig[] = [
  { jobKey: 'plan', jobLabel: 'Plan', agentLabel: 'Planner', nodes: PLAN_NODES },
  { jobKey: 'design', jobLabel: 'Design', agentLabel: 'Architect', nodes: DESIGN_NODES },
  { jobKey: 'code', jobLabel: 'Code', agentLabel: 'Architect', nodes: CODE_NODES },
  { jobKey: 'learn', jobLabel: 'Learn', agentLabel: 'Architect', nodes: LEARN_NODES },
  { jobKey: 'visual', jobLabel: 'Visual', agentLabel: 'Creator', nodes: VISUAL_NODES },
];

export function LLMModelsSection({
  editedConfig,
  availableModels,
  isLoadingModels,
  onModelChange
}: LLMModelsSectionProps) {
  const { t } = useTranslation('config');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (jobKey: string) => {
    setExpandedSections(prev => ({ ...prev, [jobKey]: !prev[jobKey] }));
  };

  const getInheritedModel = (jobConfig: JobLLMConfig | undefined) => {
    if (!jobConfig?.default) return undefined;
    const model = availableModels.find(m => m.id === jobConfig.default);
    if (!model) return undefined;
    return { id: model.id, displayName: model.displayName, provider: model.provider };
  };

  const renderJobSection = (section: JobSectionConfig) => {
    const { jobKey, jobLabel, agentLabel, nodes } = section;
    const jobConfig = editedConfig.llmModels?.[jobKey];
    const defaultNode = nodes.find(n => n.key === 'default')!;
    const overrideNodes = nodes.filter(n => n.key !== 'default');
    const isExpanded = !!expandedSections[jobKey];
    const inheritedModel = getInheritedModel(jobConfig);
    const hasCustomOverrides = overrideNodes.some(node => !!jobConfig?.[node.key]);

    return (
      <div key={jobKey} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3">
        {/* Header: Agent + Job chips + default model selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChip variant="info" label={`Agent: ${agentLabel}`} hideDot />
          <StatusChip variant="success" label={`Job: ${jobLabel}`} hideDot />
          <span className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight">
            {t(defaultNode.description)}
          </span>
          <div className="ml-auto">
            <ModelSelectChip
              value={jobConfig?.[defaultNode.key] || ''}
              models={availableModels}
              onChange={(modelId) => onModelChange(jobKey, defaultNode.key, modelId)}
              placeholder={t('projectEditor.selectModel')}
              showAsCustom={hasCustomOverrides}
            />
          </div>
        </div>

        {/* Accordion for node overrides */}
        {overrideNodes.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggleSection(jobKey)}
              className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 
                hover:text-gray-700 dark:hover:text-gray-300 transition-colors py-1"
            >
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              <span>{t('llmModels.nodeOverrides')} ({overrideNodes.length})</span>
            </button>

            {isExpanded && (
              <div className="mt-2 border border-gray-100 dark:border-gray-700/50 rounded-md divide-y divide-gray-100 dark:divide-gray-700/50">
                {overrideNodes.map(node => (
                  <div key={node.key} className="flex items-center gap-3 px-3 py-2.5 flex-wrap">
                    <div className="flex items-baseline gap-2 min-w-0 flex-1">
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400 shrink-0">
                        {node.label}
                      </span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight truncate">
                        {t(node.description)}
                      </span>
                    </div>
                    <ModelSelectChip
                      value={jobConfig?.[node.key] || ''}
                      models={availableModels}
                      onChange={(modelId) => onModelChange(jobKey, node.key, modelId)}
                      inheritedModel={inheritedModel}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
          {JOB_SECTIONS.map(section => renderJobSection(section))}
        </div>
      )}
    </div>
  );
}
