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
import { waitForTaskQueueDrain, waitForAllQueueDrain } from '@/components/workflow/hooks/useWorkflowState';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

export function useKanbanSSE() {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const selectedWorkType = useStore(state => state.selectedWorkType);  // ✅ Get selected work type
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
  const currentInProgressIdRef = useRef<string | undefined>(undefined); // ✅ Track current task
  
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);
  
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setKanbanData({ todo: [], inProgress: null, completed: [] });
      return;
    }
    
    console.log('[useKanbanSSE] 🔄 Connecting:', selectedProject, selectedFeature);
    
    const job = (selectedWorkType as 'design' | 'code' | 'learn') || 'code';  // ✅ Get job from workType
    const eventSource = new EventSource(
      `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/kanban/stream?job=${job}`  // ✅ Add job param
    );
    
    eventSource.onmessage = async (event) => {  // ✅ Make async!
      try {
        const data: KanbanData = JSON.parse(event.data);
        const previousRunning = isRunningRef.current;
        const activeJobId = data.activeJobId;
        const dataSource = data.dataSource;
        const newInProgressId = data.inProgress?.id;
        const currentInProgressId = currentInProgressIdRef.current;
        
        console.log('[useKanbanSSE] Received:', {
          dataSource,
          activeJobId,
          isRunning: previousRunning,
          isStopping,
          currentInProgress: currentInProgressId,
          newInProgress: newInProgressId,
          completedCount: data.completed?.length || 0  // ✅ Log completed count
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
        
        // ✅ CRITICAL: Wait for workflow animations BEFORE updating Kanban
        const isTaskChange = newInProgressId !== currentInProgressId;
        const hasCurrentTask = currentInProgressId !== undefined;
        
        if (isTaskChange && hasCurrentTask) {
          console.log(`[useKanbanSSE] ⏸️  Task change: ${currentInProgressId} → ${newInProgressId}`);
          console.log(`[useKanbanSSE] ⏳ Waiting for workflow animations to complete...`);
          
          await waitForTaskQueueDrain(currentInProgressId);
          
          console.log(`[useKanbanSSE] ✅ Workflow animations complete for ${currentInProgressId}`);
          
          // ⏱️ CRITICAL: Wait for React render cycle to complete
          // This ensures workflow UI updates are visible before Kanban updates
          await new Promise<void>(resolve => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setTimeout(resolve, 0); // Yield to event loop
              });
            });
          });
          console.log(`[useKanbanSSE] 🎨 Render cycle complete`);
        }
        
        // Handle final completion (inProgress → null)
        if (currentInProgressId && !newInProgressId) {
          console.log(`[useKanbanSSE] ⏸️  All tasks completing`);
          console.log(`[useKanbanSSE] ⏳ Waiting for all workflow nodes (including learn)...`);
          
          await waitForAllQueueDrain();
          
          console.log(`[useKanbanSSE] ✅ All workflow complete`);
          
          // ⏱️ Wait for final render
          await new Promise<void>(resolve => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setTimeout(resolve, 0);
              });
            });
          });
          console.log(`[useKanbanSSE] 🎨 Final render cycle complete`);
        }
        
        // ✅ Update Kanban data AFTER workflow animations AND render cycles
        currentInProgressIdRef.current = newInProgressId;
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
  }, [selectedProject, selectedFeature, selectedWorkType, isStopping, userStoppedJobId, setRunning, startLogStream]);  // ✅ Add selectedWorkType to deps
  
  return { kanbanData };
}

