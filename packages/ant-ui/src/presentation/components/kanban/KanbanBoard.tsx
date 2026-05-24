import { useStore } from '@/domain/store';
import { useEffect, useState } from 'react';
import { KanbanData } from '@/infrastructure/http/api';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import { BoardContainer } from '../BoardContainer';
import { ElapsedTimeBadge, TokenUsageBadge, GaugesGroup } from './KanbanHeader';
import { KanbanEstimatingSkeleton } from './KanbanEstimating';
import { KanbanColumns } from './KanbanColumns';
import { NodeActivityBanner } from './NodeActivityBanner';
import { useNewlyAdded } from '../common/motion';
import type { BaseTask } from '@ant/shared';

const taskKey = (task: BaseTask): string => task.id || task.name;

/** Returns true when a UnifiedTask's transient `status` field is 'verifying'.
 *  Verifying tasks live in the to-do bucket from the source-of-truth model
 *  but render inside the In-Progress lane. */
const isVerifying = (task: BaseTask): boolean =>
  (task as { status?: string }).status === 'verifying';

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
  const [newlyInProgressId, setNewlyInProgressId] = useState<string | null>(null);
  const [previousInProgressId, setPreviousInProgressId] = useState<string | null>(null);

  // Newly added / completed task tracking — shared hook drives both columns'
  // entrance animations. Auto-clear is sized to outlast the
  // `TaskCardShineSweep` sweep (~0.7s + 0.2s delay) for both variants, so we
  // rely on the hook's default (`NEWLY_ADDED_AUTO_CLEAR_MS`) here.
  const { newlyAddedIds: newlyAddedTodoIds } = useNewlyAdded(
    kanbanData.todo,
    taskKey,
  );
  const { newlyAddedIds: newlyCompletedIds } = useNewlyAdded(
    kanbanData.completed,
    taskKey,
  );

  // ✅ Detect newly in-progress tasks
  useEffect(() => {
    // Use the first in-progress task for animation tracking
    const firstInProgress = kanbanData.inProgress?.[0];
    const currentInProgressId = firstInProgress?.id || firstInProgress?.name || null;
    
    if (currentInProgressId && currentInProgressId !== previousInProgressId) {
      setNewlyInProgressId(currentInProgressId);
      setPreviousInProgressId(currentInProgressId);
    }
  }, [kanbanData.inProgress, previousInProgressId]);
  
  // ✅ Estimating state: Show activity banner or fallback skeleton UI
  if (kanbanData.isEstimating) {
    return (
      <BoardContainer 
        titleActions={
          <>
            <ElapsedTimeBadge
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
              inProgressTasks={kanbanData.inProgress?.map(task => ({
                id: task.id || task.name,
                name: task.name,
                tokenUsage: task.tokenUsage
              })) || []}
            />
          </>
        }
        headerActions={
          <GaugesGroup
            recursionCount={kanbanData.recursionCount}
            recursionLimit={kanbanData.recursionLimit || systemRecursionLimit}
            recursionTaskName={kanbanData.recursionTaskName}
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
      titleActions={
        <>
          <ElapsedTimeBadge
            jobTiming={kanbanData.jobTiming}
            completedTasks={kanbanData.completed?.map(task => ({
              id: task.id || task.name,
              name: task.name,
              timing: task.timing
            }))}
            inProgressTasks={kanbanData.inProgress?.map(task => ({
              id: task.id || task.name,
              name: task.name,
              timing: task.timing,
            })) || []}
          />
          <TokenUsageBadge 
            jobId={kanbanData.jobId}
            tokenUsage={kanbanData.tokenUsage}
            estimatingTokenUsage={kanbanData.estimatingTokenUsage}
            phaseTokenUsages={kanbanData.phaseTokenUsages}
            completedTasks={kanbanData.completed?.map(task => ({
              id: task.id || task.name,
              name: task.name,
              tokenUsage: task.tokenUsage
            }))}
            inProgressTasks={kanbanData.inProgress?.map(task => ({
              id: task.id || task.name,
              name: task.name,
              tokenUsage: task.tokenUsage
            })) || []}
          />
        </>
      }
        headerActions={
          <GaugesGroup
            recursionCount={kanbanData.recursionCount}
            recursionLimit={kanbanData.recursionLimit || systemRecursionLimit}
            recursionTaskName={kanbanData.recursionTaskName}
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
          todoTasks={(kanbanData.todo || []).filter(t => !isVerifying(t))}
          inProgressTasks={[
            ...(kanbanData.inProgress || []),
            ...((kanbanData.todo || []).filter(isVerifying)),
          ]}
          completedTasks={kanbanData.completed || []}
          newlyAddedTodoIds={newlyAddedTodoIds}
          newlyCompletedIds={newlyCompletedIds}
          newlyInProgressId={newlyInProgressId}
          splitLayout={splitLayout}
          workflowDisplayedState={workflowState}
          onInProgressAnimationComplete={() => setNewlyInProgressId(null)}
        />
      </div>
    </BoardContainer>
  );
}
