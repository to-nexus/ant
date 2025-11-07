/**
 * useKanbanSSE Hook
 * 
 * App 레벨에서 단일 Kanban SSE 연결 관리
 * 
 * Responsibilities:
 * 1. Kanban SSE 연결 (project/feature 단위)
 * 2. Job 상태 동기화 (job start/end 감지)
 * 3. Kanban 데이터 업데이트
 * 
 * Benefits:
 * - App.tsx는 단순하게 유지 (SRP)
 * - 로직을 테스트하기 쉬움
 * - 재사용 가능
 */

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { KanbanData } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

export function useKanbanSSE() {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const isRunning = useStore(state => state.isRunning);
  const isStopping = useStore(state => state.isStopping);
  const userStoppedJobId = useStore(state => state.userStoppedJobId);
  const setRunning = useStore(state => state.setRunning);
  const startLogStream = useStore(state => state.startLogStream);
  
  const [kanbanData, setKanbanData] = useState<KanbanData>({
    todo: [],
    inProgress: null,
    completed: []
  });
  
  const isRunningRef = useRef(isRunning);
  
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);
  
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setKanbanData({ todo: [], inProgress: null, completed: [] });
      return;
    }
    
    console.log('[useKanbanSSE] 🔄 Connecting:', selectedProject, selectedFeature);
    
    const eventSource = new EventSource(
      `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/kanban/stream`
    );
    
    eventSource.onmessage = (event) => {
      try {
        const data: KanbanData = JSON.parse(event.data);
        const previousRunning = isRunningRef.current;
        const activeJobId = data.activeJobId;
        const dataSource = data.dataSource;
        
        console.log('[useKanbanSSE] Received:', {
          dataSource,
          activeJobId,
          isRunning: previousRunning,
          isStopping
        });
        
        // ✅ Job state synchronization
        // Job started detection
        if ((dataSource === 'live' || dataSource === 'estimating') &&
            !previousRunning &&
            activeJobId &&
            activeJobId !== userStoppedJobId) {
          console.log('[useKanbanSSE] ✅ Job started:', activeJobId);
          setRunning(true, activeJobId, 'generate');
          startLogStream(activeJobId);
        }
        
        // Job ended detection
        if (previousRunning &&
            dataSource === 'session' &&
            !activeJobId) {
          console.log('[useKanbanSSE] ✅ Job ended');
          setRunning(false);
        }
        
        // ✅ Update Kanban data
        setKanbanData(data);
        
      } catch (error) {
        console.error('[useKanbanSSE] Parse error:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('[useKanbanSSE] Connection error:', error);
    };
    
    return () => {
      console.log('[useKanbanSSE] 🧹 Closing connection');
      eventSource.close();
    };
  }, [selectedProject, selectedFeature, isStopping, userStoppedJobId, setRunning, startLogStream]);
  
  return { kanbanData };
}

