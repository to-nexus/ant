import { useStore } from '@/domain/store';
import { useEffect, useState } from 'react';
import { KanbanData } from '@/infrastructure/http/api';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import { BoardContainer } from '../BoardContainer';
import { ElapsedTimeBadge, TokenUsageBadge, GaugesGroup } from './KanbanHeader';
import { KanbanEstimatingSkeleton } from './KanbanEstimating';
import { KanbanColumns } from './KanbanColumns';
import { NodeActivityBanner } from './NodeActivityBanner';

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
  const splitLayout = useStore((state) => state.splitLayout);
  const systemRecursionLimit = useStore((state) => state.recursionLimit);  // ✅ Get system recursion limit
  const [newlyCompletedIds, setNewlyCompletedIds] = useState<Set<string>>(new Set());
  const [previousCompletedIds, setPreviousCompletedIds] = useState<Set<string>>(new Set());
  const [newlyInProgressId, setNewlyInProgressId] = useState<string | null>(null);
  const [previousInProgressId, setPreviousInProgressId] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);  // ✅ Track initial load
  
  // ✅ Remove unused interruption UI logic (now handled in chat only)

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
  
  // ✅ Estimating state: Show activity banner or fallback skeleton UI
  if (kanbanData.isEstimating) {
    return (
      <BoardContainer 
        title="Task Board"
        titleActions={
          <>
            <ElapsedTimeBadge
              totalElapsedTime={kanbanData.totalElapsedTime}
              jobTiming={kanbanData.jobTiming}
              completedTasks={kanbanData.completed?.map(task => ({
                id: task.id || task.name,
                name: task.name,
                timing: task.timing
              }))}
              estimatingActivity={kanbanData.estimatingLabel && kanbanData.estimatingStartedAt ? {
                label: kanbanData.estimatingLabel,
                startedAt: kanbanData.estimatingStartedAt,
              } : null}
            />
            <TokenUsageBadge 
              jobId={kanbanData.jobId}
              tokenUsage={kanbanData.tokenUsage}
              estimatingTokenUsage={kanbanData.estimatingTokenUsage}
              completedTasks={kanbanData.completed?.map(task => ({
                id: task.id || task.name,
                name: task.name,
                tokenUsage: task.tokenUsage
              }))}
              inProgressTask={kanbanData.inProgress ? {
                id: kanbanData.inProgress.id || kanbanData.inProgress.name,
                name: kanbanData.inProgress.name,
                tokenUsage: kanbanData.inProgress.tokenUsage
              } : undefined}
            />
          </>
        }
        headerActions={
          <GaugesGroup
            recursionCount={kanbanData.recursionCount}
            recursionLimit={kanbanData.recursionLimit || systemRecursionLimit}
          />
        }
        className={`kanban-board ${splitLayout}`}
      >
        {/* Current node activity indicator */}
        {kanbanData.estimatingLabel && kanbanData.estimatingStartedAt && (
          <NodeActivityBanner
            label={kanbanData.estimatingLabel}
            startedAt={kanbanData.estimatingStartedAt}
          />
        )}

        {/* Skeleton cards: only during decompose/revise (task generation nodes) */}
        {(kanbanData.estimatingNodeId === 'decompose' || kanbanData.estimatingNodeId === 'revise') && (
          <KanbanEstimatingSkeleton />
        )}
      </BoardContainer>
    );
  }

  // ✅ Main Kanban Board UI
  return (
    <BoardContainer 
      title="Task Board"
      titleActions={
        <>
          <ElapsedTimeBadge
            totalElapsedTime={kanbanData.totalElapsedTime}
            jobTiming={kanbanData.jobTiming}
            completedTasks={kanbanData.completed?.map(task => ({
              id: task.id || task.name,
              name: task.name,
              timing: task.timing
            }))}
            inProgressTask={kanbanData.inProgress ? {
              id: kanbanData.inProgress.id || kanbanData.inProgress.name,
              name: kanbanData.inProgress.name,
              timing: kanbanData.inProgress.timing,
            } : null}
          />
          <TokenUsageBadge 
            jobId={kanbanData.jobId}
            tokenUsage={kanbanData.tokenUsage}
            estimatingTokenUsage={kanbanData.estimatingTokenUsage}
            completedTasks={kanbanData.completed?.map(task => ({
              id: task.id || task.name,
              name: task.name,
              tokenUsage: task.tokenUsage
            }))}
            inProgressTask={kanbanData.inProgress ? {
              id: kanbanData.inProgress.id || kanbanData.inProgress.name,
              name: kanbanData.inProgress.name,
              tokenUsage: kanbanData.inProgress.tokenUsage
            } : undefined}
          />
        </>
      }
        headerActions={
          <GaugesGroup
            recursionCount={kanbanData.recursionCount}
            recursionLimit={kanbanData.recursionLimit || systemRecursionLimit}
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
