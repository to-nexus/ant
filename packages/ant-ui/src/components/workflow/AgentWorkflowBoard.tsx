import { BoardContainer } from '../BoardContainer';
import { StatusChip } from '../StatusChip';
import { useStore } from '@/lib/store';
import { useUIActionPolicy } from '@/hooks/useUIActionPolicy';
import { WorkflowRealtimeState } from '@/types/workflow';
import { capitalize } from '@/lib/text-utils';
import { WorkflowVisualization } from './WorkflowVisualization';

interface AgentWorkflowBoardProps {
  workflowState: WorkflowRealtimeState | null;  // ✅ App에서 전달받음 (job 단위 SSE)
}

/**
 * AgentWorkflowBoard - Agent workflow visualization board
 * 
 * Displays:
 * - Agent execution flow
 * - Node states and transitions
 * - Real-time progress
 */
export function AgentWorkflowBoard({ workflowState }: AgentWorkflowBoardProps) {
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedWorkType = useStore((state) => state.selectedWorkType);
  
  // ✅ UI Policy 시스템 사용
  const policy = useUIActionPolicy();

  return (
    <BoardContainer
      title="🔄 Agent Workflow"
      titleActions={
        <div className="flex items-center gap-2">
          {/* Always show selected agent */}
          <StatusChip 
            variant="info" 
            label={`Agent: ${capitalize(selectedAgent)}`}
            hideDot
          />
          {/* Always show selected work type (job) */}
          <StatusChip 
            variant="success" 
            label={`Job: ${capitalize(selectedWorkType)}`}
            hideDot
          />
          {/* Show Status (Running / Idle) - dot 표시 필요 */}
          {/* ✅ UI Policy 준수 */}
          <StatusChip 
            variant={policy.isRunning ? "live" : "session"} 
            label={policy.isRunning ? "Running" : "Idle"}
          />
        </div>
      }
    >
      <WorkflowVisualization workflowState={workflowState} />
    </BoardContainer>
  );
}

