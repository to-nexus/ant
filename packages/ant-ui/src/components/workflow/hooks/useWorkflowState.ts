/**
 * useWorkflowSSE Hook (구 useWorkflowState)
 * 
 * App 레벨에서 단일 Workflow SSE 연결 관리
 * 
 * Responsibilities:
 * 1. Workflow SSE 연결 (job 단위)
 * 2. 실시간 노드 상태 수신
 * 3. 노드 전환 큐로 최소 표시 시간 보장
 * 
 * Features:
 * - SSE를 통한 실시간 상태 수신
 * - 노드 전환 큐로 최소 표시 시간 보장
 * - 빠른 노드도 사용자가 인지 가능하도록 연출
 * - ✅ 글로벌 단일 큐: 태스크 변경과 무관하게 모든 노드 연출 보장
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

// ✅ 글로벌 단일 큐: 컴포넌트 외부에 선언하여 태스크/jobId 변경과 무관하게 유지
interface QueuedNode {
  nodeId: string;
  state: WorkflowRealtimeState;
  taskId?: string;  // ✅ 태스크 ID (태스크 경계 인식용)
  taskName?: string;  // ✅ 태스크 이름 (디버깅용)
  timestamp: number;
}

let globalNodeQueue: QueuedNode[] = [];
let globalProcessing = false;
let globalDisplayStartTime = 0;
let globalCurrentTimer: ReturnType<typeof setTimeout> | null = null;
const globalQueueCallbacks: Set<() => void> = new Set();
const taskDrainCallbacks: Map<string, () => void> = new Map();

// 큐 변경 알림
function notifyQueueChange() {
  globalQueueCallbacks.forEach(cb => cb());
}

/**
 * ✅ 글로벌 큐 초기화 (페이지 새로고침 또는 연결 재설정 시)
 * 이전 연출 상태를 모두 클리어하여 최신 데이터 기반 UI 표시
 */
export function clearGlobalQueue(): void {
  console.log('[clearGlobalQueue] 🧹 Clearing global workflow queue');
  globalNodeQueue = [];
  globalProcessing = false;
  globalDisplayStartTime = 0;
  
  if (globalCurrentTimer) {
    clearTimeout(globalCurrentTimer);
    globalCurrentTimer = null;
  }
  
  notifyQueueChange();
}

/**
 * ✅ 특정 태스크의 모든 노드가 큐에서 소진될 때까지 대기
 * Kanban 태스크 전환과 Workflow 연출을 동기화하기 위한 핵심 함수
 */
export function waitForTaskQueueDrain(taskId: string | undefined): Promise<void> {
  if (!taskId) {
    return Promise.resolve();
  }
  
  // 해당 태스크의 노드가 큐에 없으면 즉시 완료
  const hasTaskNodes = globalNodeQueue.some(node => node.taskId === taskId);
  if (!hasTaskNodes) {
    console.log(`[waitForTaskQueueDrain] Task ${taskId} has no pending nodes, resolving immediately`);
    return Promise.resolve();
  }
  
  console.log(`[waitForTaskQueueDrain] Waiting for task ${taskId} to drain from queue`);
  
  return new Promise((resolve) => {
    // 큐가 업데이트될 때마다 체크
    const checkInterval = setInterval(() => {
      const stillHasNodes = globalNodeQueue.some(node => node.taskId === taskId);
      
      if (!stillHasNodes) {
        console.log(`[waitForTaskQueueDrain] Task ${taskId} queue drained, resolving`);
        clearInterval(checkInterval);
        resolve();
      }
    }, 100); // 100ms마다 체크
    
    // 최대 10초 타임아웃
    setTimeout(() => {
      console.warn(`[waitForTaskQueueDrain] Timeout waiting for task ${taskId}, forcing resolve`);
      clearInterval(checkInterval);
      resolve();
    }, 10000);
  });
}

export function useWorkflowSSE(jobId: string | undefined): WorkflowStateWithQueue {
  const [rawState, setRawState] = useState<WorkflowRealtimeState | null>(null);
  const [displayedState, setDisplayedState] = useState<WorkflowRealtimeState | null>(null);
  const [queueLength, setQueueLength] = useState(globalNodeQueue.length);
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
  
  // ✅ 글로벌 큐 변경 구독
  useEffect(() => {
    const callback = () => setQueueLength(globalNodeQueue.length);
    globalQueueCallbacks.add(callback);
    return () => {
      globalQueueCallbacks.delete(callback);
    };
  }, []);
  
  // SSE 구독
  useEffect(() => {
    if (!jobId) {
      console.log('[useWorkflowState] Clearing state (no jobId)');
      
      // ✅ 글로벌 타이머 취소 (진행 중인 연출 중단하지 않음)
      // 단, rawState는 초기화
      jobEndedRef.current = false;
      setRawState(null);
      setDisplayedState(null);
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
      console.log('[useWorkflowState] 📊 Current global queue length:', globalNodeQueue.length);
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
      console.log('[useWorkflowState] 📊 Global queue has', globalNodeQueue.length, 'pending nodes');
      eventSource.close();
      
      // ✅ 연출 개선: 타이머 취소 안함, 큐 유지 (글로벌이므로)
      // → 이전 Task의 노드들을 모두 소비한 후에 새 Task로 전환
      jobEndedRef.current = false;  // ✅ Reset
      
      // ✅ rawState만 null로 (새 노드 추가 차단), 큐는 글로벌이므로 유지
      setRawState(null);
      
      // ✅ displayedState는 유지하여 마지막 노드가 계속 보이도록
    };
  }, [jobId]);
  
  // ✅ 새 노드 감지 → 글로벌 큐에 추가
  useEffect(() => {
    if (!rawState?.currentNode) return;
    
    const newNode = rawState.currentNode;
    const currentDisplayedNode = displayedState?.currentNode;
    
    // 이미 표시 중이면 무시
    if (newNode === currentDisplayedNode) return;
    
    // 글로벌 큐에 이미 있으면 무시
    if (globalNodeQueue.some(item => item.nodeId === newNode)) return;
    
    console.log(`[useWorkflowState] 📥 Queuing node to global queue: ${newNode}`);
    if (rawState.currentTask) {
      console.log(`   📋 Task: ${rawState.currentTask.name}`);
    }
    globalNodeQueue.push({
      nodeId: newNode,
      state: rawState,
      taskId: rawState.currentTask?.id,
      taskName: rawState.currentTask?.name,
      timestamp: Date.now()
    });
    notifyQueueChange();
  }, [rawState?.currentNode, displayedState?.currentNode]);
  
  // ✅ 글로벌 큐 처리
  useEffect(() => {
    if (globalProcessing || globalNodeQueue.length === 0) return;
    
    const processNext = async () => {
      globalProcessing = true;
      
      const nextItem = globalNodeQueue[0];
      const nextNode = nextItem.nodeId;
      const minDisplayTime = NODE_MIN_DISPLAY_TIME[nextNode] || DEFAULT_MIN_DISPLAY_TIME;
      
      // 현재 표시 중인 노드의 경과 시간 계산
      const elapsed = globalDisplayStartTime 
        ? Date.now() - globalDisplayStartTime 
        : Infinity;
      
      // 최소 표시 시간이 지나지 않았으면 대기
      if (elapsed < minDisplayTime) {
        const waitTime = minDisplayTime - elapsed;
        console.log(`[useWorkflowState] ⏳ Waiting ${waitTime}ms before showing: ${nextNode}`);
        
        // ✅ 글로벌 타이머 저장하고 대기
        await new Promise(resolve => {
          globalCurrentTimer = setTimeout(() => {
            globalCurrentTimer = null;
            resolve(undefined);
          }, waitTime);
        });
      }
      
      // ✅ 연출 개선: 큐에 있는 노드는 무조건 표시
      // → 이전 Task의 노드들을 모두 보여주고 나서 새 Task로 전환
      
      // 노드 표시
      console.log(`[useWorkflowState] 🎬 Displaying node from global queue: ${nextNode} (min: ${minDisplayTime}ms, queue: ${globalNodeQueue.length})`);
      globalDisplayStartTime = Date.now();
      
      // ✅ 큐에 저장된 state 사용 (노드가 추가된 시점의 상태)
      const currentRawState = rawStateRef.current;
      
      setDisplayedState(prev => {
        // rawState가 있으면 (같은 Task 진행 중) - 현재 rawState 사용
        if (currentRawState) {
          return {
            ...currentRawState,
            currentNode: nextNode,
            previousNode: prev?.currentNode || currentRawState.previousNode
          };
        }
        // rawState 없으면 (이전 Task 큐 소비 중) - 큐에 저장된 state 사용
        else {
          return {
            ...nextItem.state,
            currentNode: nextNode,
            previousNode: prev?.currentNode || nextItem.state.previousNode
          };
        }
      });
      
      // 글로벌 큐에서 제거
      globalNodeQueue.shift();
      notifyQueueChange();
      
      // ✅ CRITICAL: 큐가 비었고 job이 종료되었으면 cleanup
      if (globalNodeQueue.length === 0 && jobEndedRef.current) {
        console.log('[useWorkflowState] ✅ Global queue drained after job end, clearing state');
        setTimeout(() => {
          setDisplayedState(null);
          console.log('[useWorkflowState] 🏁 Cleanup complete');
        }, 500);  // 마지막 노드가 잠깐 표시될 시간을 줌
      }
      
      globalProcessing = false;
      
      // ✅ 큐에 다음 항목이 있으면 즉시 처리 시작
      if (globalNodeQueue.length > 0) {
        notifyQueueChange();
      }
    };
    
    processNext();
  }, [queueLength]);  // ✅ queueLength만 dependency - 글로벌 큐에 항목이 추가될 때마다 실행
  
  return { rawState, displayedState };
}

