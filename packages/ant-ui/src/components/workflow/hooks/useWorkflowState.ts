/**
 * useWorkflowState Hook
 * 
 * 실시간 워크플로우 상태 구독 (SSE) + 노드 전환 큐
 * 
 * Features:
 * - SSE를 통한 실시간 상태 수신
 * - 노드 전환 큐로 최소 표시 시간 보장
 * - 빠른 노드도 사용자가 인지 가능하도록 연출
 */

import { useState, useEffect, useRef } from 'react';
import { WorkflowRealtimeState } from '@/types/workflow';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

// 노드별 최소 표시 시간 (ms)
const NODE_MIN_DISPLAY_TIME: Record<string, number> = {
  resolve: 800,        // 코드베이스 분석 (충분히 김)
  decompose: 500,      // 태스크 분해
  plan: 0,             // LLM 호출 (이미 충분히 김)
  execute: 0,          // LLM 호출 (이미 충분히 김)
  writeFiles: 600,     // 파일 쓰기 (빠름 → 연출 필요)
  validate: 400,       // 정적 검증 (빠름 → 연출 필요)
  installDeps: 0,      // 의존성 설치 (실제로 느림)
  runtimeValidate: 0,  // 런타임 검증 (실제로 느림)
  checkTaskStatus: 300,// 상태 체크 (빠름 → 연출 필요)
  enforce: 500,        // 규칙 적용
  learn: 600,          // 학습 저장
};

const DEFAULT_MIN_DISPLAY_TIME = 500; // 기본값

interface WorkflowStateWithQueue {
  rawState: WorkflowRealtimeState | null;      // 실제 서버 상태
  displayedState: WorkflowRealtimeState | null; // 큐를 통해 표시되는 상태
}

export function useWorkflowState(jobId: string | undefined): WorkflowStateWithQueue {
  const [rawState, setRawState] = useState<WorkflowRealtimeState | null>(null);
  const [displayedState, setDisplayedState] = useState<WorkflowRealtimeState | null>(null);
  const [nodeQueue, setNodeQueue] = useState<string[]>([]);
  const processingRef = useRef(false);
  const displayStartTimeRef = useRef<number>(0);
  const currentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentJobIdRef = useRef<string | undefined>(jobId);
  const rawStateRef = useRef<WorkflowRealtimeState | null>(null);
  const jobEndedRef = useRef(false);  // ✅ NEW: 'end' 이벤트 수신 여부
  
  // jobId 변경 추적
  useEffect(() => {
    currentJobIdRef.current = jobId;
  }, [jobId]);
  
  // rawState ref 동기화
  useEffect(() => {
    rawStateRef.current = rawState;
  }, [rawState]);
  
  // SSE 구독
  useEffect(() => {
    if (!jobId) {
      console.log('[useWorkflowState] Clearing state (no jobId)');
      
      // ✅ 진행 중인 타이머 취소
      if (currentTimerRef.current) {
        clearTimeout(currentTimerRef.current);
        currentTimerRef.current = null;
      }
      
      processingRef.current = false;
      displayStartTimeRef.current = 0;
      jobEndedRef.current = false;  // ✅ Reset
      setRawState(null);
      setDisplayedState(null);
      setNodeQueue([]);
      return;
    }
    
    console.log('[useWorkflowState] 🔄 Subscribing to job:', jobId);
    jobEndedRef.current = false;  // ✅ Reset for new job
    
    const eventSource = new EventSource(
      `${API_BASE}/jobs/${jobId}/workflow/stream`
    );
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[useWorkflowState] 📨 Received state update:', {
          jobId: data.jobId,
          currentNode: data.currentNode,
          previousNode: data.previousNode,
          isCompleted: data.isCompleted,
          nodeHistory: data.nodeHistory?.length || 0,
          activeActors: data.activeActors?.length || 0
        });
        setRawState(data);
      } catch (err) {
        console.error('[useWorkflowState] Failed to parse SSE data:', err);
      }
    };
    
    eventSource.addEventListener('end', () => {
      console.log('[useWorkflowState] 🏁 SSE "end" event received');
      console.log('[useWorkflowState] 📊 Current queue length:', nodeQueue.length);
      console.log('[useWorkflowState] ⏳ Waiting for queue to drain before cleanup...');
      
      // ✅ CRITICAL: 'end' 이벤트를 받았다는 플래그만 설정
      // → 큐가 비워질 때까지 cleanup 지연!
      jobEndedRef.current = true;
      eventSource.close();
      
      // ✅ rawState를 null로 만들어 새 노드가 큐에 추가되는 것 방지
      setRawState(null);
    });
    
    eventSource.onerror = (error) => {
      console.error('[useWorkflowState] SSE error:', error);
    };
    
    return () => {
      console.log('[useWorkflowState] 🧹 Cleanup - closing SSE connection for job:', jobId);
      eventSource.close();
      
      // ✅ 연출 개선: 타이머는 취소하지만, 큐와 rawState는 유지
      // → 이전 Task의 노드들을 모두 소비한 후에 새 Task로 전환
      if (currentTimerRef.current) {
        console.log('[useWorkflowState] ⏹️  Cancelling pending timer (task switch, queue will be drained)');
        clearTimeout(currentTimerRef.current);
        currentTimerRef.current = null;
      }
      
      processingRef.current = false;
      displayStartTimeRef.current = 0;
      jobEndedRef.current = false;  // ✅ Reset
      
      // ✅ rawState만 null로 (새 노드 추가 차단), 큐는 유지 (기존 노드 소비)
      setRawState(null);
      
      // ❌ displayedState와 nodeQueue는 유지!
      // → 큐를 계속 소비하여 이전 Task의 노드들을 연출 완료
    };
  }, [jobId]);
  
  // 새 노드 감지 → 큐에 추가
  useEffect(() => {
    if (!rawState?.currentNode) return;
    
    const newNode = rawState.currentNode;
    const currentDisplayedNode = displayedState?.currentNode;
    
    // 이미 표시 중이면 무시
    if (newNode === currentDisplayedNode) return;
    
    // 큐에 이미 있으면 무시
    if (nodeQueue.includes(newNode)) return;
    
    console.log(`[useWorkflowState] 📥 Queuing node: ${newNode}`);
    setNodeQueue(prev => [...prev, newNode]);
  }, [rawState?.currentNode, displayedState?.currentNode, nodeQueue]);
  
  // 큐 처리 (rawState dependency 제거 - ref 사용)
  useEffect(() => {
    if (processingRef.current || nodeQueue.length === 0) return;
    
    const processNext = async () => {
      processingRef.current = true;
      
      const nextNode = nodeQueue[0];
      const minDisplayTime = NODE_MIN_DISPLAY_TIME[nextNode] || DEFAULT_MIN_DISPLAY_TIME;
      
      // 현재 표시 중인 노드의 경과 시간 계산
      const elapsed = displayStartTimeRef.current 
        ? Date.now() - displayStartTimeRef.current 
        : Infinity;
      
      // 최소 표시 시간이 지나지 않았으면 대기
      if (elapsed < minDisplayTime) {
        const waitTime = minDisplayTime - elapsed;
        console.log(`[useWorkflowState] ⏳ Waiting ${waitTime}ms before showing: ${nextNode}`);
        
        // ✅ 타이머를 저장하고 대기
        await new Promise(resolve => {
          currentTimerRef.current = setTimeout(() => {
            currentTimerRef.current = null;
            resolve(undefined);
          }, waitTime);
        });
      }
      
      // ✅ 연출 개선: jobId 체크 제거 - 큐에 있는 노드는 무조건 표시
      // → 이전 Task의 노드들을 모두 보여주고 나서 새 Task로 전환
      
      // 노드 표시
      console.log(`[useWorkflowState] 🎬 Displaying node: ${nextNode} (min: ${minDisplayTime}ms)`);
      displayStartTimeRef.current = Date.now();
      
      // ✅ rawStateRef 사용 (현재 시점의 rawState 참조)
      const currentRawState = rawStateRef.current;
      
      setDisplayedState(prev => {
        // rawState가 있으면 (같은 Task 진행 중)
        if (currentRawState) {
          return {
            ...currentRawState,
            currentNode: nextNode,
            previousNode: prev?.currentNode || currentRawState.previousNode
          };
        }
        // rawState 없으면 (이전 Task 큐 소비 중)
        else if (prev) {
          return {
            ...prev,
            currentNode: nextNode,
            previousNode: prev.currentNode
          };
        }
        // 둘 다 없으면 기본값 (필요한 최소 필드만)
        const now = new Date().toISOString();
        return {
          jobId: '',
          currentNode: nextNode,
          previousNode: null,
          startedAt: now,
          nodeHistory: [{ nodeId: nextNode, enteredAt: now }],
          activeActors: [],
          isCompleted: false
        };
      });
      
      // 큐에서 제거
      setNodeQueue(prev => {
        const updated = prev.slice(1);
        
        // ✅ CRITICAL: 큐가 비었고 job이 종료되었으면 cleanup
        if (updated.length === 0 && jobEndedRef.current) {
          console.log('[useWorkflowState] ✅ Queue drained after job end, clearing state');
          setTimeout(() => {
            setDisplayedState(null);
            console.log('[useWorkflowState] 🏁 Cleanup complete');
          }, 500);  // 마지막 노드가 잠깐 표시될 시간을 줌
        }
        // ✅ 큐가 비었고 rawState도 없으면 (이전 Task 큐 소비 완료) 상태 초기화
        else if (updated.length === 0 && !rawStateRef.current && !jobEndedRef.current) {
          console.log('[useWorkflowState] ✅ Previous task queue drained, clearing state');
          setTimeout(() => setDisplayedState(null), 100);
        }
        
        return updated;
      });
      
      processingRef.current = false;
    };
    
    processNext();
  }, [nodeQueue]);  // ✅ nodeQueue만 dependency - 큐에 항목이 추가될 때만 실행
  
  return { rawState, displayedState };
}

