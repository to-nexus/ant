/**
 * Application Layer: Workflow View Adapter Hook
 * 
 * Responsibility:
 * - Manage Workflow SSE connection with queue-based display
 * - Ensure minimum display time for each node
 */

import { useStore } from '@/domain/store';
import { useWorkflowSSE } from '@/presentation/components/workflow/hooks';
import type { WorkflowRealtimeState } from '@/domain/models/workflow';

interface UseWorkflowReturn {
  workflowData: WorkflowRealtimeState | null;  // ✅ displayedState from queue
}

export function useWorkflow(): UseWorkflowReturn {
  // ✅ Get current jobId from store
  const currentJobId = useStore((state) => state.currentJobId);
  
  // ✅ Use WorkflowSSE hook with queue (ensures minimum display time)
  const { displayedState } = useWorkflowSSE(currentJobId);

  return { workflowData: displayedState };
}
