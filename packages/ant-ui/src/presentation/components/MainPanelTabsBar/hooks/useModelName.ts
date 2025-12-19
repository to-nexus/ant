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
        
        if (config?.llmModels) {
          let modelId: string | undefined;
          
          if (selectedJobType === 'design') {
            // Design job: decompose or default
            if (currentTask) {
              modelId = config.llmModels.designDefault;
            } else {
              modelId = config.llmModels.designDecompose || config.llmModels.designDefault;
            }
          } else if (selectedJobType === 'code') {
            // Code job: task type에 따라 선택
            if (currentTask) {
              const taskType = currentTask.type;
              const taskPriority = currentTask.priority;
              
              if (taskType === 'error') {
                modelId = config.llmModels.codeError || config.llmModels.codeDefault;
              } else if (taskType === 'setup') {
                modelId = config.llmModels.codeSetup || config.llmModels.codeDefault;
              } else if (taskType === 'feature' && taskPriority === 1000) {
                modelId = config.llmModels.codeFinal || config.llmModels.codeDefault;
              } else {
                modelId = config.llmModels.codeDefault;
              }
            } else {
              // No current task = decompose phase
              modelId = config.llmModels.codeDecompose || config.llmModels.codeDefault;
            }
          } else {
            // Unknown job type, use decompose or default
            modelId = config.llmModels.codeDecompose || 
                     config.llmModels.codeDefault || 
                     config.llmModels.designDecompose ||
                     config.llmModels.designDefault;
          }
          
          if (modelId) {
            const displayName = availableModels.get(modelId);
            setModelName(displayName || modelId);
          } else {
            setModelName(null);
          }
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
