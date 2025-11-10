/**
 * Application Layer: Workflow View Adapter Hook
 * 
 * Responsibility:
 * - Select Workflow data from Domain Store
 * - No business logic, no Infrastructure access
 */

import { useStore } from '@/domain/store';
import type { WorkflowRealtimeState } from '@/domain/models/workflow';

interface UseWorkflowReturn {
  workflowData: WorkflowRealtimeState | null;
}

export function useWorkflow(): UseWorkflowReturn {
  // ✅ Select data from Domain Store
  const workflowData = useStore((state) => state.workflow);

  return { workflowData };
}
