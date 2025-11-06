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
      // jobId가 없으면 상태 초기화
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
    
    eventSource.addEventListener('end', () => {
      console.log(`[useWorkflowState] Job ${jobId} ended, preserving last state`);
      // 연결은 종료되지만 마지막 상태는 유지
      eventSource.close();
    });
    
    eventSource.onerror = (error) => {
      console.error('[useWorkflowState] SSE error:', error);
      // 연결이 끊어져도 마지막 상태는 유지
    };
    
    return () => {
      console.log(`[useWorkflowState] Cleaning up SSE for job ${jobId}`);
      eventSource.close();
      // cleanup 시에도 상태는 유지 (jobId 변경으로 새 상태가 로드될 예정)
    };
  }, [jobId]);
  
  return state;
}

