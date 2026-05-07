import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { checkHealth } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { selectIsAuthBlocked } from '@/domain/store/selectors';

/**
 * Initialize connection and load projects on mount
 * No polling - projects are loaded only when explicitly requested
 * Server connection status is managed by SSE connections
 */
export function useHealthCheck() {
  const backendMode = useStore((state) => state.backendMode);
  const userEmail = useStore((state) => state.userEmail);
  const authStatus = useStore((state) => state.authStatus);
  const { pathname } = useLocation();
  
  useEffect(() => {
    if (pathname === '/local') {
      return;
    }
    
    async function initialize() {
      try {
        const t0 = performance.now();
        console.log(`[Timing] useHealthCheck start @${Math.round(t0)}ms`);

        const isHealthy = await checkHealth();
        console.log(`[Timing] checkHealth done +${Math.round(performance.now() - t0)}ms`);
        const store = useStore.getState();
        
        if (!isHealthy) {
          store.setConnectionStatus('error');
          store.setProjects([]);
          return;
        }
        
        await store.loadSystemConfig();
        console.log(`[Timing] loadSystemConfig done +${Math.round(performance.now() - t0)}ms`);

        // Cloud Mode: Skip project loading if not signed in or still verifying.
        // `selectIsAuthBlocked` covers both branches (no userEmail or
        // authStatus==='verifying'), so cloud-mode boot stays quiet until
        // `fetchAuthMe` lands and decides verified/expired.
        if (selectIsAuthBlocked(useStore.getState())) {
          store.setConnectionStatus('connected');
          store.setProjects([]);
          console.log(`[Timing] setConnectionStatus('connected') (auth blocked) +${Math.round(performance.now() - t0)}ms`);
          return;
        }

        await store.fetchProjects();
        console.log(`[Timing] fetchProjects done +${Math.round(performance.now() - t0)}ms`);
        store.setConnectionStatus('connected');
        console.log(`[Timing] setConnectionStatus('connected') +${Math.round(performance.now() - t0)}ms`);
      } catch (error) {
        console.error('[useHealthCheck] Initialization failed:', error);
        useStore.getState().setConnectionStatus('error');
        useStore.getState().setProjects([]);
      }
    }
    
    initialize();
    // `authStatus` is in deps so cloud-mode 'verifying' → 'verified'
    // re-runs `fetchProjects` after the JWT cookie is confirmed.
  }, [backendMode, userEmail, authStatus, pathname]);
}


