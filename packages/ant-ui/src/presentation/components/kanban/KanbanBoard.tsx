import { useStore } from '@/domain/store';
import React, { useEffect, useState } from 'react';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { KanbanData } from '@/infrastructure/http/api';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import { BoardContainer } from '../BoardContainer';
import { DataSourceIndicator, ElapsedTimeBadge, GaugesGroup } from './KanbanHeader';
import { KanbanEstimating } from './KanbanEstimating';
import { KanbanPausedPrompt } from './KanbanPausedPrompt';
import { KanbanColumns } from './KanbanColumns';

interface KanbanBoardProps {
  kanbanData: KanbanData;  // ✅ App에서 전달받음 (project/feature 단위 SSE)
  workflowState: WorkflowRealtimeState | null;  // ✅ App에서 전달받음 (job 단위 SSE)
}

/**
 * KanbanBoard Component - Presentation Component
 * 
 * ✅ ARCHITECTURE: Props-based display (SSE 연결 없음)
 * - App.tsx가 모든 SSE 연결 관리 (Kanban + Workflow)
 * - KanbanBoard는 props로 받은 데이터만 표시
 * - 애니메이션과 UI 로직만 관리 (Single Responsibility)
 */
export function KanbanBoard({ kanbanData, workflowState }: KanbanBoardProps) {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const splitLayout = useStore((state) => state.splitLayout);
  const dismissedInterruptTimestamp = useStore((state) => state.dismissedInterruptTimestamp);  // ✅ Global state (for resume)
  const [dismissedKanbanInterrupt, setDismissedKanbanInterrupt] = React.useState<string | null>(null);  // ✅ Local state (for dismiss button only)
  const policy = useUIActionPolicy();
  
  // ✅ DEBUG: Log when kanbanData.isEstimating changes
  useEffect(() => {
    // console.log('[KanbanBoard] 📊 kanbanData changed:', { // ✅ Too verbose
    //   isEstimating: kanbanData.isEstimating,
    //   dataSource: kanbanData.dataSource,
    //   completedCount: kanbanData.completed?.length || 0,
    //   todoCount: kanbanData.todo?.length || 0,
    //   inProgress: kanbanData.inProgress?.name || null
    // });
  }, [kanbanData.isEstimating, kanbanData.dataSource, kanbanData.completed, kanbanData.todo, kanbanData.inProgress]);
  
  // ✅ Animation state management
  const [newlyCompletedIds, setNewlyCompletedIds] = useState<Set<string>>(new Set());
  const [previousCompletedIds, setPreviousCompletedIds] = useState<Set<string>>(new Set());
  const [newlyInProgressId, setNewlyInProgressId] = useState<string | null>(null);
  const [previousInProgressId, setPreviousInProgressId] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);  // ✅ Track initial load
  
  // ✅ Reset local dismissed state when interruption changes (new interruption appeared)
  useEffect(() => {
    if (kanbanData.interruption?.timestamp && 
        dismissedKanbanInterrupt !== kanbanData.interruption.timestamp) {
      setDismissedKanbanInterrupt(null);  // Reset local dismiss state for new interruption
    }
  }, [kanbanData.interruption?.timestamp, dismissedKanbanInterrupt]);

  // ✅ Detect newly completed tasks (skip animation on initial load)
  useEffect(() => {
    const currentCompletedIds = new Set(kanbanData.completed.map(task => task.id || task.name));
    
    // ✅ On initial load, just set previous IDs without triggering animation
    if (isInitialLoad) {
      setPreviousCompletedIds(currentCompletedIds);
      setIsInitialLoad(false);
      return;
    }
    
    const newIds = new Set<string>();
    
    currentCompletedIds.forEach(id => {
      if (!previousCompletedIds.has(id)) {
        newIds.add(id);
      }
    });
    
    if (newIds.size > 0) {
      setNewlyCompletedIds(newIds);
      setPreviousCompletedIds(currentCompletedIds);
    }
  }, [kanbanData.completed, previousCompletedIds, isInitialLoad]);

  // ✅ Detect newly in-progress task
  useEffect(() => {
    const currentInProgressId = kanbanData.inProgress?.id || kanbanData.inProgress?.name || null;
    
    if (currentInProgressId && currentInProgressId !== previousInProgressId) {
      setNewlyInProgressId(currentInProgressId);
      setPreviousInProgressId(currentInProgressId);
    }
  }, [kanbanData.inProgress, previousInProgressId]);

  // ✅ Handle Resume Task (user-initiated action)
  const handleResumeTask = async () => {
    if (!selectedProject || !selectedFeature) {
      console.error('[KanbanBoard] Cannot resume: missing project/feature');
      return;
    }

    // ✅ CRITICAL: Resume requires jobId from kanban data
    const jobId = kanbanData.jobId;
    if (!jobId) {
      console.error('[KanbanBoard] Cannot resume: missing jobId in kanban data');
      return;
    }

    try {
      
      // ✅ CRITICAL: Dismiss interruption FIRST before setting running state
      // This prevents SSE initial state from auto-stopping the job
      if (interruption) {
        useStore.getState().setDismissedInterruptTimestamp(interruption.timestamp);
      }
      
      // ✅ Set running state immediately
      useStore.getState().setRunning(true, jobId);
      
      // ✅ Use new resumeJob API - server will auto-detect job type
      const { resumeJob } = await import('@/infrastructure/http/api');
      const result = await resumeJob(jobId, selectedProject, selectedFeature, true);  // chatSource: true
      
      
      // ✅ Update with new jobId from server
      useStore.getState().setRunning(true, result.jobId);
      
      // ✅ CRITICAL: Mark current interruption as dismissed globally (hide both task board and chat)
      // This prevents it from reappearing when job completes
      if (interruption) {
        useStore.getState().setDismissedInterruptTimestamp(interruption.timestamp);
        setDismissedKanbanInterrupt(interruption.timestamp);  // Also update local state
      }
    } catch (error) {
      console.error('[KanbanBoard] Failed to resume task:', error);
      useStore.getState().setRunning(false);  // ✅ Clear running state on error
      alert(`Failed to resume task: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // ✅ Check if interruption should be shown (task board only checks local dismiss + global resume)
  const interruption = kanbanData.interruption;
  const shouldShowInterruption = 
    interruption &&
    interruption.timestamp !== dismissedKanbanInterrupt &&  // ✅ Local dismiss (task board only)
    interruption.timestamp !== dismissedInterruptTimestamp &&  // ✅ Global resume (both task board and chat)
    !policy.isRunning &&
    !policy.isStopping;

  // ✅ Calculate gauges
  const completedCount = kanbanData.completed?.length ?? 0;
  const totalTasks = (kanbanData.todo?.length ?? 0) + (kanbanData.inProgress ? 1 : 0) + completedCount;
  
  // ✅ Estimating state: Show estimating UI instead of Kanban board
  if (kanbanData.isEstimating) {
    return (
      <BoardContainer 
        title="Task Board"
        titleActions={
          <>
            <DataSourceIndicator dataSource={kanbanData.dataSource} />
            <ElapsedTimeBadge
              totalElapsedTime={kanbanData.totalElapsedTime}
              jobTiming={kanbanData.jobTiming}
            />
          </>
        }
        headerActions={
          <GaugesGroup
            recursionCount={kanbanData.recursionCount}
            recursionLimit={kanbanData.recursionLimit}
            completedCount={completedCount}
            totalTasks={totalTasks}
          />
        }
        className={`kanban-board ${splitLayout}`}  // ✅ Pass splitLayout
      >
        <KanbanEstimating jobTiming={kanbanData.jobTiming} />
      </BoardContainer>
    );
  }

  // ✅ Main Kanban Board UI
  return (
    <BoardContainer 
      title="Task Board"
      titleActions={
        <>
          <DataSourceIndicator dataSource={kanbanData.dataSource} />
          <ElapsedTimeBadge
            totalElapsedTime={kanbanData.totalElapsedTime}
            jobTiming={kanbanData.jobTiming}
          />
        </>
      }
      headerActions={
        <GaugesGroup
          recursionCount={kanbanData.recursionCount}
          recursionLimit={kanbanData.recursionLimit}
          completedCount={completedCount}
          totalTasks={totalTasks}
        />
      }
      className={`kanban-board ${splitLayout}`}  // ✅ Pass splitLayout
    >
      <div className={splitLayout === 'horizontal' ? 
        "flex flex-col" : 
        "flex flex-col h-full overflow-hidden"
      }>
        {/* 중단(interruption) 관련 UI 완전 제거. 채팅에서만 노출됨. */}
        
        <KanbanColumns
          todoTasks={kanbanData.todo || []}
          inProgressTask={kanbanData.inProgress}
          completedTasks={kanbanData.completed || []}
          newlyCompletedIds={newlyCompletedIds}
          newlyInProgressId={newlyInProgressId}
          splitLayout={splitLayout}
          workflowDisplayedState={workflowState}
          onShineComplete={(taskId: string) => {
            setNewlyCompletedIds(prev => {
              const next = new Set(prev);
              next.delete(taskId);
              return next;
            });
          }}
          onInProgressAnimationComplete={() => setNewlyInProgressId(null)}
        />
      </div>
    </BoardContainer>
  );
}
