/**
 * useJobStateSync Hook
 * 
 * 서버 SSE를 통해 Job 상태를 감지하고 전역 상태를 동기화합니다.
 * 
 * 책임:
 * - Kanban SSE를 통한 job 시작/종료 감지
 * - 전역 상태 복원 (setRunning, startLogStream)
 * - 다중 탭 동기화
 * 
 * KanbanBoard에서 분리된 이유:
 * - KanbanBoard는 단지 칸반 데이터를 표시하는 컴포넌트
 * - 전역 상태 관리는 앱 레벨의 책임
 * - 단일 책임 원칙 준수
 */

import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

interface KanbanSSEData {
  dataSource?: 'live' | 'estimating' | 'session';
  activeJobId?: string;
  [key: string]: any;
}

/**
 * Kanban SSE를 모니터링하여 Job 상태를 자동으로 동기화
 * 
 * 사용처: App.tsx (최상위 레벨)
 */
export function useJobStateSync() {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const isRunning = useStore(state => state.isRunning);
  const isStopping = useStore(state => state.isStopping);
  const userStoppedJobId = useStore(state => state.userStoppedJobId);
  const setRunning = useStore(state => state.setRunning);
  const setCurrentJob = useStore(state => state.setCurrentJob);
  const startLogStream = useStore(state => state.startLogStream);
  
  const previousDataSourceRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      return;
    }

    console.log('[useJobStateSync] Starting job state sync for:', selectedProject, selectedFeature);

    let eventSource: EventSource | null = null;
    let isMounted = true;

    // SSE 연결
    eventSource = new EventSource(
      `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/kanban/stream`
    );

    eventSource.onmessage = (event) => {
      if (!isMounted) return;

      try {
        const data: KanbanSSEData = JSON.parse(event.data);
        const currentDataSource = data.dataSource;
        const activeJobId = data.activeJobId;
        const previousDataSource = previousDataSourceRef.current;

        console.log('[useJobStateSync] SSE received:', {
          dataSource: currentDataSource,
          activeJobId: activeJobId,
          isRunning,
          isStopping,
          userStoppedJobId
        });

        // ✅ CRITICAL: Skip during stop process
        if (isStopping) {
          console.log('[useJobStateSync] ⏸️  Skipping (stopping in progress)');
          previousDataSourceRef.current = currentDataSource;
          return;
        }

        // ✅ Job started - Restore UI state
        if ((currentDataSource === 'live' || currentDataSource === 'estimating') && 
            !isRunning && 
            activeJobId &&
            activeJobId !== userStoppedJobId) {
          console.log('[useJobStateSync] ✅ Job started detected, restoring UI state');
          console.log('   activeJobId:', activeJobId);
          console.log('   dataSource:', currentDataSource);
          
          // Restore running state
          setRunning(true, activeJobId, 'generate');
          
          // Reconnect Log SSE
          startLogStream(activeJobId);
          
          console.log('[useJobStateSync] UI state restored');
        } else if (activeJobId === userStoppedJobId) {
          console.log('[useJobStateSync] 🚫 Skipping restore - user stopped this job:', activeJobId);
        }

        // ✅ Job ended - Clear UI state
        if (isRunning && (
          ((previousDataSource === 'live' || previousDataSource === 'estimating') && currentDataSource === 'session') ||
          (!activeJobId && currentDataSource === 'session')
        )) {
          console.log('[useJobStateSync] Task ended detected, clearing UI state');
          console.log('   Reason:', !activeJobId ? 'No activeJobId' : 'dataSource changed to session');
          
          setRunning(false);
          setCurrentJob(null);
          
          console.log('[useJobStateSync] UI state cleared');
        }

        previousDataSourceRef.current = currentDataSource;
      } catch (error) {
        console.error('[useJobStateSync] Failed to parse SSE data:', error);
      }
    };

    eventSource.onerror = (_error) => {
      console.log('[useJobStateSync] SSE connection error');
    };

    return () => {
      console.log('[useJobStateSync] Cleanup - closing SSE connection');
      isMounted = false;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [
    selectedProject, 
    selectedFeature, 
    isRunning, 
    isStopping, 
    userStoppedJobId, 
    setRunning, 
    setCurrentJob,
    startLogStream
  ]);
}

