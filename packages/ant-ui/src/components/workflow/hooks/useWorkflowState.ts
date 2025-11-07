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
// ✅ 모든 노드를 사용자가 인식할 수 있도록 충분한 시간 확보
const NODE_MIN_DISPLAY_TIME: Record<string, number> = {
  resolve: 800,        // 코드베이스 분석
  decompose: 600,      // 태스크 분해
  plan: 700,           // ✅ 계획 수립 (연출 필요)
  execute: 800,        // ✅ 코드 생성 (가장 중요 → 충분한 시간)
  writeFiles: 600,     // 파일 쓰기
  validate: 500,       // 정적 검증
  installDeps: 700,    // 의존성 설치
  runtimeValidate: 600,// 런타임 검증
  checkTaskCompletion: 600, // ✅ 태스크 완료 체크 (design job) - 단순 체크이므로 짧게
  checkTaskStatus: 400,// 상태 체크
  enforce: 500,        // 규칙 적용
  learn: 800,          // ✅ 학습 저장 (마지막 노드 → 충분한 시간)
};

const DEFAULT_MIN_DISPLAY_TIME = 600; // ✅ 기본값 상향 (500 → 600)

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
let globalCleanupTimer: ReturnType<typeof setTimeout> | null = null;  // ✅ Cleanup 타이머 관리
let globalDisplayedState: WorkflowRealtimeState | null = null;  // ✅ Global displayed state
const globalQueueCallbacks: Set<() => void> = new Set();

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
  
  if (globalCleanupTimer) {
    clearTimeout(globalCleanupTimer);
    globalCleanupTimer = null;
  }
  
  notifyQueueChange();
}

/**
 * ✅ 전체 큐가 완전히 비어있을 때까지 대기 (learn 노드 포함)
 * 모든 태스크 완료 시 사용
 */
export function waitForAllQueueDrain(): Promise<void> {
  // 큐도 비어있고 연출 중인 것도 없어야 함
  const hasAnyNodes = globalNodeQueue.length > 0;
  const isDisplaying = globalDisplayedState !== null;
  
  if (!hasAnyNodes && !isDisplaying) {
    console.log(`[waitForAllQueueDrain] Queue already empty, resolving immediately`);
    return Promise.resolve();
  }
  
  console.log(`[waitForAllQueueDrain] Waiting for ALL nodes to drain (queue: ${globalNodeQueue.length}, displaying: ${isDisplaying})`);
  
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const stillHasNodes = globalNodeQueue.length > 0;
      const stillDisplaying = globalDisplayedState !== null;
      
      if (!stillHasNodes && !stillDisplaying) {
        console.log(`[waitForAllQueueDrain] All nodes drained, resolving`);
        clearInterval(checkInterval);
        resolve();
      }
    }, 50);
    
    // 최대 5초 타임아웃
    setTimeout(() => {
      console.warn(`[waitForAllQueueDrain] Timeout, forcing resolve`);
      clearInterval(checkInterval);
      resolve();
    }, 5000);
  });
}

/**
 * ✅ 특정 태스크의 모든 노드가 큐에서 소진될 때까지 대기
 * Kanban 태스크 전환과 Workflow 연출을 동기화하기 위한 핵심 함수
 */
export function waitForTaskQueueDrain(taskId: string | undefined): Promise<void> {
  if (!taskId) {
    return Promise.resolve();
  }
  
  return new Promise((resolve) => {
    let hasSeenTask = false; // ✅ Track if we've seen the task at all
    let checkCount = 0;
    const maxChecks = 200; // 10초 (50ms * 200)
    
    const checkInterval = setInterval(() => {
      checkCount++;
      const stillInQueue = globalNodeQueue.some(node => node.taskId === taskId);
      const stillDisplaying = globalDisplayedState?.currentTask?.id === taskId;
      
      // ✅ Track if we've ever seen this task
      if (stillInQueue || stillDisplaying) {
        if (!hasSeenTask) {
          console.log(`[waitForTaskQueueDrain] Task ${taskId} detected (inQueue: ${stillInQueue}, displaying: ${stillDisplaying})`);
          hasSeenTask = true;
        }
      }
      
      // ✅ Only resolve if:
      // 1. We've seen the task AND it's now gone, OR
      // 2. We've waited at least 500ms and still haven't seen it (SSE might not come)
      const waited500ms = checkCount >= 10; // 50ms * 10 = 500ms
      
      if (hasSeenTask && !stillInQueue && !stillDisplaying) {
        console.log(`[waitForTaskQueueDrain] Task ${taskId} fully drained after ${checkCount * 50}ms`);
        clearInterval(checkInterval);
        resolve();
      } else if (!hasSeenTask && waited500ms) {
        console.warn(`[waitForTaskQueueDrain] Task ${taskId} not found after 500ms, assuming complete`);
        clearInterval(checkInterval);
        resolve();
      } else if (checkCount >= maxChecks) {
        console.warn(`[waitForTaskQueueDrain] Timeout waiting for task ${taskId} (seen: ${hasSeenTask})`);
        clearInterval(checkInterval);
        resolve();
      }
    }, 50);
  });
}

export function useWorkflowSSE(jobId: string | undefined): WorkflowStateWithQueue {
  const [rawState, setRawState] = useState<WorkflowRealtimeState | null>(null);
  const [displayedState, setDisplayedState] = useState<WorkflowRealtimeState | null>(null);
  const [queueLength, setQueueLength] = useState(globalNodeQueue.length);
  const currentJobIdRef = useRef<string | undefined>(jobId);
  const rawStateRef = useRef<WorkflowRealtimeState | null>(null);
  const displayedStateRef = useRef<WorkflowRealtimeState | null>(null);  // ✅ displayedState ref
  const jobEndedRef = useRef(false);  // ✅ NEW: 'end' 이벤트 수신 여부
  
  // jobId 변경 추적
  useEffect(() => {
    currentJobIdRef.current = jobId;
  }, [jobId]);
  
  // rawState ref 동기화
  useEffect(() => {
    rawStateRef.current = rawState;
  }, [rawState]);
  
  // displayedState를 ref와 global state에 동기화
  useEffect(() => {
    displayedStateRef.current = displayedState;
    globalDisplayedState = displayedState; // ✅ Sync to global for waitForAllQueueDrain
  }, [displayedState]);
  
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
      // ✅ CRITICAL: jobEndedRef는 초기화하지 않음! (learn 노드 cleanup을 위해 유지)
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
        
        // ✅ CRITICAL: Add to queue IMMEDIATELY in SSE handler
        // This prevents race condition where rapid SSE updates skip nodes
        if (data.currentNode) {
          const newNode = data.currentNode;
          const newTaskId = data.currentTask?.id;
          
          // Check duplicates in queue
          const isDuplicate = globalNodeQueue.some(item => 
            item.nodeId === newNode && item.taskId === newTaskId
          );
          
          if (!isDuplicate) {
            // Check if already displaying
            const currentDisplayed = displayedStateRef.current?.currentNode;
            const currentDisplayedTask = displayedStateRef.current?.currentTask?.id;
            
            if (!(newNode === currentDisplayed && newTaskId === currentDisplayedTask)) {
              console.log(`[useWorkflowState] 📥 Queuing node immediately: ${newNode}`);
              if (data.currentTask) {
                console.log(`   📋 Task: ${data.currentTask.name} (ID: ${data.currentTask.id})`);
              }
              
              globalNodeQueue.push({
                nodeId: newNode,
                state: data,
                taskId: newTaskId,
                taskName: data.currentTask?.name,
                timestamp: Date.now()
              });
              notifyQueueChange();
            }
          }
        }
        
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
      
      // ✅ RACE CONDITION FIX: 마지막 노드 상태 업데이트를 받을 시간을 줌
      // learn 노드 같은 마지막 노드의 상태가 'end' 이벤트보다 늦게 도착할 수 있음
      setTimeout(() => {
        console.log('[useWorkflowState] 🔒 Blocking new node additions (after grace period)');
        setRawState(null);
      }, 500);  // 500ms 유예 기간
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
      // ✅ CRITICAL: jobEndedRef는 초기화하지 않음! (learn 노드 cleanup을 위해 유지)
      
      // ✅ rawState만 null로 (새 노드 추가 차단), 큐는 글로벌이므로 유지
      setRawState(null);
      
      // ✅ displayedState는 유지하여 마지막 노드가 계속 보이도록
    };
  }, [jobId]);
  
  // ✅ 노드 감지는 이제 SSE 핸들러에서 직접 처리
  // (React batching으로 인한 스킵 방지)
  
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
      // jobEndedRef는 SSE 'end' 이벤트에서 설정되며, jobId가 사라져도 유지됨
      if (globalNodeQueue.length === 0 && jobEndedRef.current) {
        console.log('[useWorkflowState] ✅ Global queue drained after job end, scheduling cleanup');
        
        // ✅ 기존 cleanup 타이머가 있으면 취소
        if (globalCleanupTimer) {
          console.log('[useWorkflowState] ⚠️  Cancelling previous cleanup timer');
          clearTimeout(globalCleanupTimer);
          globalCleanupTimer = null;
        }
        
        // ✅ 마지막 노드의 최소 표시 시간 보장
        const lastNodeDisplayTime = NODE_MIN_DISPLAY_TIME[nextNode] || DEFAULT_MIN_DISPLAY_TIME;
        const elapsedSinceDisplay = Date.now() - globalDisplayStartTime;
        const remainingTime = Math.max(0, lastNodeDisplayTime - elapsedSinceDisplay);
        
        console.log(`[useWorkflowState] ⏳ Waiting ${remainingTime}ms before cleanup (node: ${nextNode}, min: ${lastNodeDisplayTime}ms)`);
        
        globalCleanupTimer = setTimeout(() => {
          console.log('[useWorkflowState] 🏁 Executing cleanup after last node');
          setDisplayedState(null);
          globalDisplayedState = null; // ✅ Global state도 clear
          globalCleanupTimer = null;
          console.log('[useWorkflowState] ✅ Cleanup complete');
        }, remainingTime);
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

