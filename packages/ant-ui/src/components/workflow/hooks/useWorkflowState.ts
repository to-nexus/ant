/**
 * useWorkflowState Hook
 * 
 * 실시간 워크플로우 상태 구독 (SSE)
 * Phase 2에서 완전 구현
 */

import { useState, useEffect } from 'react';
import { WorkflowRealtimeState } from '@/types/workflow';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

export function useWorkflowState(jobId: string | undefined) {
  const [state, setState] = useState<WorkflowRealtimeState | null>(null);
  
  useEffect(() => {
    if (!jobId) {
      setState(null);
      return;
    }
    
    console.log(`[useWorkflowState] Connecting SSE for job ${jobId}`);
    
    // Phase 2: SSE 구현
    const eventSource = new EventSource(
      `${API_BASE}/jobs/${jobId}/workflow/stream`
    );
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[useWorkflowState] Received state:`, data);
        setState(data);
      } catch (err) {
        console.error('[useWorkflowState] Failed to parse SSE data:', err);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('[useWorkflowState] SSE error:', error);
      // Phase 1에서는 에러 무시 (placeholder endpoint)
    };
    
    return () => {
      console.log(`[useWorkflowState] Closing SSE for job ${jobId}`);
      eventSource.close();
    };
  }, [jobId]);
  
  return state;
}

