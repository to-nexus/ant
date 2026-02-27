import * as React from 'react';

export function useModelName(
  selectedProject: string | undefined,
  selectedJobType: string | undefined,
  availableModels: Map<string, string>,
  currentTask: any
) {
  const [modelName, setModelName] = React.useState<string | null>(null);
  
  React.useEffect(() => {
    const loadModelName = async () => {
      if (!selectedProject || availableModels.size === 0) {
        setModelName(null);
        return;
      }
      
      try {
        const { fetchProjectConfig } = await import('@/infrastructure/http/api');
        const config = await fetchProjectConfig(selectedProject);
        
        if (!config?.llmModels) {
          setModelName(null);
          return;
        }
        
        // Get job-level configuration
        let jobConfig: any = null;
        if (selectedJobType === 'design') {
          jobConfig = config.llmModels.design;
        } else if (selectedJobType === 'code') {
          jobConfig = config.llmModels.code;
        } else if (selectedJobType === 'learn') {
          jobConfig = config.llmModels.learn;
        } else if (selectedJobType === 'plan') {
          jobConfig = config.llmModels.plan;
        }
        
        if (!jobConfig) {
          setModelName(null);
          return;
        }
        
        // For now, just use the job default
        // TODO: Determine current node based on workflow state to use node-specific model
        const modelId = jobConfig.default;
        
        if (modelId) {
          const displayName = availableModels.get(modelId);
          setModelName(displayName || modelId);
        } else {
          setModelName(null);
        }
      } catch (error) {
        console.warn('[useModelName] Failed to load model name:', error);
        setModelName(null);
      }
    };
    
    loadModelName();
  }, [selectedProject, selectedJobType, availableModels, currentTask]);
  
  return modelName;
}
