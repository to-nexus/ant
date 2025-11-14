import { useEffect } from 'react';
import { checkHealth } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

/**
 * Manages server health checks and connection status
 */
export function useHealthCheck() {
  const deploymentMode = useStore((state) => state.deploymentMode);
  const userEmail = useStore((state) => state.userEmail);
  
  useEffect(() => {
    // ✅ Skip health check on /local page (setup guide)
    if (window.location.pathname === '/local') {
      console.log('[useHealthCheck] Skipping health check on /local page');
      return;
    }
    
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
        
        const store = useStore.getState();
        
        // ✅ Cloud Mode: Skip project loading if not signed in
        if (store.deploymentMode === 'cloud' && !store.userEmail) {
          console.log('[useHealthCheck] Cloud mode - waiting for sign in');
          store.setConnectionStatus('connected');
          store.setProjects([]);
          return;
        }
        
        console.log('[useHealthCheck] Health check passed, loading projects...');
        await store.fetchProjects();
        store.setConnectionStatus('connected');
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
          
          // ✅ Cloud Mode: Skip project loading if not signed in
          if (store.deploymentMode === 'cloud' && !store.userEmail) {
            console.log('[useHealthCheck] Cloud mode - waiting for sign in');
            store.setConnectionStatus('connected');
            store.setProjects([]);
            return;
          }
          
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
  }, [deploymentMode, userEmail]); // ✅ Re-run when deploymentMode or userEmail changes
}

