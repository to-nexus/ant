import { useEffect } from 'react';
import { checkHealth } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

/**
 * Manages server health checks and connection status
 */
export function useHealthCheck() {
  useEffect(() => {
    async function checkConnectionAndLoadProjects() {
      try {
        console.log('[useHealthCheck] Checking health...');
        useStore.getState().setConnectionStatus('disconnected');
        
        const isHealthy = await checkHealth();
        if (!isHealthy) {
          console.error('[useHealthCheck] Health check failed');
          useStore.getState().setConnectionStatus('error');
          useStore.getState().setProjects([]);
          return;
        }
        
        console.log('[useHealthCheck] Health check passed, loading projects...');
        await useStore.getState().fetchProjects();
        useStore.getState().setConnectionStatus('connected');
      } catch (error) {
        console.error('[useHealthCheck] Failed to check health or load projects:', error);
        useStore.getState().setProjects([]);
        useStore.getState().setConnectionStatus('error');
      }
    }

    // Initial check
    checkConnectionAndLoadProjects();

    // Periodic health check every 5 seconds
    const healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = await checkHealth();
        const store = useStore.getState();
        const currentStatus = store.connectionStatus;
        
        if (!isHealthy) {
          console.warn('[useHealthCheck] Health check failed during periodic check');
          store.setConnectionStatus('error');
          store.setProjects([]);
        } else if (currentStatus === 'error' || currentStatus === 'disconnected') {
          console.log('[useHealthCheck] Connection restored, reloading...');
          await store.fetchProjects();
          store.setConnectionStatus('connected');
        }
      } catch (error) {
        console.error('[useHealthCheck] Periodic health check error:', error);
      }
    }, 5000);

    return () => {
      clearInterval(healthCheckInterval);
    };
  }, []); // ✅ Empty deps - use getState() internally
}

