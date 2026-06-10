import { BoardContainer } from '../BoardContainer';
import { ElapsedTimeBadge, TokenUsageBadge, GaugesGroup } from '../kanban/KanbanHeader';
import { useStore } from '@/domain/store';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import { KanbanData } from '@/infrastructure/http/api';
import { WorkflowVisualization } from './WorkflowVisualization';

interface AgentWorkflowBoardProps {
  workflowState: WorkflowRealtimeState | null;  // ✅ App에서 전달받음 (job 단위 SSE)
  kanbanData: KanbanData;
}

/**
 * AgentWorkflowBoard - Agent workflow visualization board
 * 
 * Displays:
 * - Agent execution flow
 * - Node states and transitions
 * - Real-time progress
 */
export function AgentWorkflowBoard({ workflowState, kanbanData }: AgentWorkflowBoardProps) {
  const systemRecursionLimit = useStore((state) => state.recursionLimit);

  // Recursion 게이지 SSOT: state.kanban 슬라이스(이미 kanbanData prop으로 전달됨).
  // KanbanBoard 와 동일한 단일 writer(updateKanbanRecursion) 출력을 읽어 두 뷰가
  // byte-identical 한 값을 표시하도록 보장한다. workflowState 기반 derive 금지.

  return (
    <BoardContainer
      className="workflow-board"
      titleActions={
        <>
          <ElapsedTimeBadge
            jobTiming={kanbanData.jobTiming}
            completedTasks={kanbanData.completed?.map(task => ({
              id: task.id || task.name,
              name: task.name,
              timing: task.timing,
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
            tokenUsageByModel={kanbanData.tokenUsageByModel}
            estimatingTokenUsage={kanbanData.estimatingTokenUsage}
            phaseTokenUsages={kanbanData.phaseTokenUsages}
            completedTasks={kanbanData.completed?.map(task => ({
              id: task.id || task.name,
              name: task.name,
              tokenUsage: task.tokenUsage,
            }))}
            inProgressTasks={kanbanData.inProgress?.map(task => ({
              id: task.id || task.name,
              name: task.name,
              tokenUsage: task.tokenUsage,
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
    >
      <WorkflowVisualization workflowState={workflowState} />
    </BoardContainer>
  );
}

