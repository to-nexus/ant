import { useState, useEffect } from 'react';
import type { ModelProvider } from '@ant/shared';

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
  // undefined = server did not report (older BE) → treat every provider as
  // configured (no warnings). An array = only these providers have a key.
  const [configuredProviders, setConfiguredProviders] = useState<ModelProvider[] | undefined>(undefined);

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
        setConfiguredProviders(response.configuredProviders);
      } catch (error) {
        console.error('Failed to load available models:', error);
      } finally {
        setIsLoadingModels(false);
      }
    }

    loadModels();
  }, []);

  return { availableModels, isLoadingModels, defaultModelId, configuredProviders };
}
