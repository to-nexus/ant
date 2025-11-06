import { BoardContainer } from '../BoardContainer';
import { StatusChip } from '../StatusChip';
import { useStore } from '@/lib/store';
import { capitalize, formatJobId } from '@/lib/text-utils';

/**
 * AgentWorkflowBoard - Agent workflow visualization board
 * 
 * Displays:
 * - Agent execution flow
 * - Node states and transitions
 * - Real-time progress
 * 
 * Future implementation:
 * - LangGraph node visualization
 * - Edge connections
 * - State inspection
 */
export function AgentWorkflowBoard() {
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedWorkType = useStore((state) => state.selectedWorkType);
  const currentJob = useStore((state) => state.currentJob);
  
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
        </div>
      }
    >
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center max-w-md">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Agent Workflow Visualization
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Real-time visualization of agent execution flow, node states, and transitions.
          </p>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-left">
            <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">
              Coming Soon:
            </p>
            <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <li>• LangGraph node visualization</li>
              <li>• State transitions and flow</li>
              <li>• Real-time execution tracking</li>
              <li>• Interactive node inspection</li>
            </ul>
          </div>
        </div>
      </div>
    </BoardContainer>
  );
}

