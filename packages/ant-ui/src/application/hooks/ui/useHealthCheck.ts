import { useEffect } from 'react';
import { checkHealth } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

/**
 * Initialize connection and load projects on mount
 * No polling - projects are loaded only when explicitly requested
 * Server connection status is managed by SSE connections
 */
export function useHealthCheck() {
  const backendMode = useStore((state) => state.backendMode);
  const userEmail = useStore((state) => state.userEmail);
  
  useEffect(() => {
    // Skip on /local page (setup guide)
    if (window.location.pathname === '/local') {
      return;
    }
    
    async function initialize() {
      try {
        const isHealthy = await checkHealth();
        const store = useStore.getState();
        
        if (!isHealthy) {
          store.setConnectionStatus('error');
          store.setProjects([]);
          return;
        }
        
        // Cloud Mode: Skip project loading if not signed in
        if (store.backendMode === 'cloud' && !store.userEmail) {
          store.setConnectionStatus('connected');
          store.setProjects([]);
          return;
        }
        
        // Load projects once on initialization
        await store.fetchProjects();
        store.setConnectionStatus('connected');
      } catch (error) {
        console.error('[useHealthCheck] Initialization failed:', error);
        useStore.getState().setConnectionStatus('error');
        useStore.getState().setProjects([]);
      }
    }
    
    initialize();
  }, [backendMode, userEmail]);
}


