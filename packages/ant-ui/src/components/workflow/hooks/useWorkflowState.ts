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
      // ✅ jobId가 없으면 즉시 상태 초기화 (Stop 시 즉각 반영)
      console.log('[useWorkflowState] Clearing state (no jobId)');
      setState(null);
      return;
    }
    
    console.log('[useWorkflowState] Subscribing to job:', jobId);
    
    // Phase 2: SSE 구현
    const eventSource = new EventSource(
      `${API_BASE}/jobs/${jobId}/workflow/stream`
    );
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[useWorkflowState] Received state update:', {
          currentNode: data.currentNode,
          isCompleted: data.isCompleted
        });
        setState(data);
      } catch (err) {
        console.error('[useWorkflowState] Failed to parse SSE data:', err);
      }
    };
    
    eventSource.addEventListener('end', () => {
      console.log('[useWorkflowState] SSE connection ended');
      // 연결은 종료되지만 마지막 상태는 유지
      eventSource.close();
    });
    
    eventSource.onerror = (error) => {
      console.error('[useWorkflowState] SSE error:', error);
      // 연결이 끊어져도 마지막 상태는 유지
    };
    
    return () => {
      console.log('[useWorkflowState] Cleanup - closing SSE connection');
      eventSource.close();
      // ✅ CRITICAL: Cleanup 시 상태도 초기화 (Stop 시 즉각 반영)
      setState(null);
    };
  }, [jobId]);
  
  return state;
}

