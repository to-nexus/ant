import { removeFromStorage, STORAGE_KEYS } from '../../storage';

/**
 * Configures SSEManager connection lifecycle callbacks:
 * - Status callback: syncs connectionStatus, re-fetches bridge on connect
 * - Reconnect callback: enables grace period, expires after 15s timeout
 */
export function setupConnectionPolicy(manager: any, set: any, get: any): void {
  manager.setStatusCallback((status: 'connected' | 'disconnected' | 'error') => {
    const currentStatus = get().connectionStatus;
    if (currentStatus !== status) {
      set({ connectionStatus: status });
      console.log(`[Timing] SSE connectionStatus: ${currentStatus} -> ${status} @${Math.round(performance.now())}ms`);
    }

    // Re-fetch bridge status on every SSE connect (initial + reconnect).
    if (status === 'connected') {
      import('@/infrastructure/http/api/desktop').then(({ checkBridgeStatus }) => {
        checkBridgeStatus().then((bs) => get().setBridgeStatus(bs)).catch(() => {});
      }).catch(() => {});
    }
  });

  manager.setOnReconnectCallback(() => {
    console.log('[Store] SSE reconnected, enabling grace period');
    set({ sseReconnectGrace: true });

    get().refreshFigmaPopulated?.();

    setTimeout(() => {
      if (get().sseReconnectGrace) {
        console.log('[Store] SSE reconnect grace expired (timeout)');
        set({ sseReconnectGrace: false });

        const { kanban, isRunning, activeJobs, jobStartPending, selectedJobType } = get();
        if (kanban && isRunning && !jobStartPending) {
          const stillRunning = kanban.dataSource === 'live' || kanban.dataSource === 'estimating';
          const activeJobEntry = activeJobs?.[selectedJobType];
          const hasActiveJob = activeJobEntry &&
              (activeJobEntry.status === 'running' || activeJobEntry.status === 'queued');
          if (!stillRunning && !hasActiveJob) {
            console.log('[Store] SSE grace expired: no live data received — job completed during grace');
            set({
              isRunning: false,
              currentMode: undefined,
              jobStartPending: false,
            });
            removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
            removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
            removeFromStorage(STORAGE_KEYS.TASK_MODE);
          } else if (!stillRunning) {
            console.log('[Store] SSE grace expired: no live kanban but activeJob present — keeping isRunning');
          }
        }
      }
    // 15s grace: large session files on EFS can take several seconds to read.
    }, 15000);
  });
}
