import { BoardContainer } from '../BoardContainer';
import { StatusChip } from '../StatusChip';
import { useStore } from '@/lib/store';
import { capitalize, formatJobId } from '@/lib/text-utils';
import { WorkflowVisualization } from './WorkflowVisualization';

/**
 * AgentWorkflowBoard - Agent workflow visualization board
 * 
 * Displays:
 * - Agent execution flow
 * - Node states and transitions
 * - Real-time progress
 */
export function AgentWorkflowBoard() {
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedWorkType = useStore((state) => state.selectedWorkType);
  const currentJob = useStore((state) => state.currentJob);
  const isRunning = useStore((state) => state.isRunning);
  
  // Job ID from running job
  const jobId = currentJob?.jobId;

  return (
    <BoardContainer
      title="🔄 Agent Workflow"
      titleActions={
        <div className="flex items-center gap-2">
          {/* Always show selected agent */}
          <StatusChip 
            variant="info" 
            label={`Agent: ${capitalize(selectedAgent)}`} 
          />
          {/* Always show selected work type (job) */}
          <StatusChip 
            variant="success" 
            label={`Job: ${capitalize(selectedWorkType)}`} 
          />
          {/* Show Job ID when running */}
          {jobId && (
            <StatusChip 
              variant="neutral" 
              label={`ID: ${formatJobId(jobId)}`}
            />
          )}
          {/* Show Status (Running / Idle) */}
          <StatusChip 
            variant={isRunning ? "live" : "session"} 
            label={isRunning ? "Running" : "Idle"}
          />
        </div>
      }
    >
      <WorkflowVisualization />
    </BoardContainer>
  );
}

