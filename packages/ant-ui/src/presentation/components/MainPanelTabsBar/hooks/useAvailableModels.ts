import * as React from 'react';

export function useAvailableModels() {
  const [availableModels, setAvailableModels] = React.useState<Map<string, string>>(new Map());
  
  React.useEffect(() => {
    const loadAvailableModels = async () => {
      try {
        const { fetchAvailableModels } = await import('@/infrastructure/http/api');
        const response = await fetchAvailableModels();
        
        const modelsMap = new Map<string, string>();
        response.models.forEach(model => {
          modelsMap.set(model.id, model.displayName);
        });
        setAvailableModels(modelsMap);
      } catch (error) {
        console.warn('[useAvailableModels] Failed to load available models:', error);
      }
    };
    
    loadAvailableModels();
  }, []);
  
  return availableModels;
}
