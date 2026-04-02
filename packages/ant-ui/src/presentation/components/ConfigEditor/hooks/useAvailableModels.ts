import { useState, useEffect } from 'react';

export interface AvailableModel {
  id: string;
  displayName: string;
  provider: string;
  recommended?: boolean;
}

export function useAvailableModels() {
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [defaultModelId, setDefaultModelId] = useState<string>('');

  useEffect(() => {
    async function loadModels() {
      setIsLoadingModels(true);
      try {
        const { fetchAvailableModels } = await import('@/infrastructure/http/api');
        const response = await fetchAvailableModels();
        
        setAvailableModels(response.models.map(m => ({
          id: m.id,
          displayName: m.displayName,
          provider: m.provider,
          recommended: m.recommended,
        })));
        
        setDefaultModelId(response.default);
      } catch (error) {
        console.error('Failed to load available models:', error);
      } finally {
        setIsLoadingModels(false);
      }
    }
    
    loadModels();
  }, []);

  return { availableModels, isLoadingModels, defaultModelId };
}
