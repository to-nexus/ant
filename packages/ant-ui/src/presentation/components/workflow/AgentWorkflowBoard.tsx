import { useTranslation } from 'react-i18next';
import { BoardContainer } from '../BoardContainer';
import { StatusChip } from '../StatusChip';
import { useStore } from '@/domain/store';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import { capitalize } from '@/shared/utils/text-utils';
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
  const { t } = useTranslation('kanban');
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedJobType = useStore((state) => state.selectedJobType);
  
  // ✅ UI Policy 시스템 사용
  const policy = useUIActionPolicy();

  return (
    <BoardContainer
      title={t('workflow.title')}
      titleActions={
        <div className="flex items-center gap-2">
          {/* Always show selected agent */}
          <StatusChip 
            variant="info" 
            label={t('workflow.agent', { name: capitalize(selectedAgent) })}
            hideDot
          />
          {/* Always show selected work type (job) */}
          <StatusChip 
            variant="success" 
            label={t('workflow.job', { name: capitalize(selectedJobType) })}
            hideDot
          />
          {/* Show Status (Running / Idle) - dot 표시 필요 */}
          {/* ✅ UI Policy 준수 */}
          <StatusChip 
            variant={policy.isRunning ? "live" : "session"} 
            label={policy.isRunning ? t('workflow.running') : t('workflow.idle')}
          />
        </div>
      }
    >
      <WorkflowVisualization workflowState={workflowState} />
    </BoardContainer>
  );
}

