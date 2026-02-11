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
 * Refactored for parallel execution:
 * - Uses activeNodes[] instead of currentNode/previousNode/currentTask
 * - Queue stores full activeNodes snapshots
 * - Tracking follows the most recently entered node (by enteredAt)
 */

import { useState, useEffect, useRef } from 'react';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import type { ActiveWorkerNode } from '@/domain/models/workflow';
import type { HandlerId } from '@/infrastructure/sse/SSEManager';
import { useStore } from '@/domain/store';
import { API_BASE } from '@/infrastructure/http/api';

// 노드별 최소 표시 시간 (ms)
const NODE_MIN_DISPLAY_TIME: Record<string, number> = {
  // Common nodes
  resolve: 1000,
  triage: 1000,
  decompose: 1000,
  plan: 1000,
  learn: 1000,
  checkTaskStatus: 1000,
  
  // Code job nodes
  codeGen: 1000,
  tool: 1000,
  validate: 1000,
  installDeps: 1000,
  runtimeValidate: 1000,
  enforce: 1000,
  execute: 1000,
  
  // Design job nodes
  docGen: 1000,
  writeFiles: 1000,
  
  // Planner job nodes
  generate: 1000,
};

const DEFAULT_MIN_DISPLAY_TIME = 1000;

interface WorkflowStateWithQueue {
  rawState: WorkflowRealtimeState | null;
  displayedState: WorkflowRealtimeState | null;
}

// ✅ 글로벌 단일 큐: activeNodes 스냅샷 기반
interface QueuedSnapshot {
  activeNodes: ActiveWorkerNode[];
  state: WorkflowRealtimeState;
  jobId: string;
  timestamp: number;
}

let globalSnapshotQueue: QueuedSnapshot[] = [];
let globalProcessing = false;
let globalDisplayStartTime = 0;
let globalDisplayedNodeId: string | null = null;  // 가장 최근 표시된 노드 ID (min display time 계산용)
let globalCurrentTimer: ReturnType<typeof setTimeout> | null = null;
let globalCleanupTimer: ReturnType<typeof setTimeout> | null = null;
let globalDisplayedState: WorkflowRealtimeState | null = null;
const globalQueueCallbacks: Set<() => void> = new Set();

function notifyQueueChange() {
  globalQueueCallbacks.forEach(cb => cb());
}

/**
 * ✅ 글로벌 큐 초기화
 */
export function clearGlobalQueue(): void {
  globalSnapshotQueue = [];
  globalProcessing = false;
  globalDisplayStartTime = 0;
  globalDisplayedNodeId = null;
  
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
 * ✅ 전체 큐가 완전히 비어있을 때까지 대기
 */
export function waitForAllQueueDrain(): Promise<void> {
  const hasAnyNodes = globalSnapshotQueue.length > 0;
  const isDisplaying = globalDisplayedState !== null;
  
  if (!hasAnyNodes && !isDisplaying) {
    return Promise.resolve();
  }
  
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const stillHasNodes = globalSnapshotQueue.length > 0;
      const stillDisplaying = globalDisplayedState !== null;
      
      if (!stillHasNodes && !stillDisplaying) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 50);
    
    setTimeout(() => {
      console.warn(`[waitForAllQueueDrain] Timeout, forcing resolve`);
      clearInterval(checkInterval);
      resolve();
    }, 5000);
  });
}

/**
 * ✅ 특정 태스크의 모든 노드가 큐에서 소진될 때까지 대기
 */
export function waitForTaskQueueDrain(taskId: string | undefined): Promise<void> {
  if (!taskId) {
    return Promise.resolve();
  }
  
  return new Promise((resolve) => {
    let hasSeenTask = false;
    let checkCount = 0;
    const maxChecks = 200;
    
    const checkInterval = setInterval(() => {
      checkCount++;
      const stillInQueue = globalSnapshotQueue.some(snapshot => 
        snapshot.activeNodes.some(n => n.taskId === taskId)
      );
      const stillDisplaying = globalDisplayedState?.activeNodes?.some(n => n.taskId === taskId);
      
      if (stillInQueue || stillDisplaying) {
        if (!hasSeenTask) hasSeenTask = true;
      }
      
      const waited500ms = checkCount >= 10;
      
      if (hasSeenTask && !stillInQueue && !stillDisplaying) {
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

/**
 * ✅ 특정 jobId의 노드만 필터링하여 큐에서 제거
 */
export function clearQueueForJob(jobId: string): void {
  const before = globalSnapshotQueue.length;
  globalSnapshotQueue = globalSnapshotQueue.filter(s => s.jobId !== jobId);
  const after = globalSnapshotQueue.length;
  if (before !== after) {
    console.log(`[clearQueueForJob] Removed ${before - after} snapshots for job ${jobId}`);
    notifyQueueChange();
  }
}

/**
 * Derive a fingerprint from activeNodes to detect meaningful changes
 */
function activeNodesFingerprint(nodes: ActiveWorkerNode[]): string {
  return nodes
    .map(n => `${n.workerId}:${n.nodeId}:${n.taskId}`)
    .sort()
    .join('|');
}

/**
 * HTTP fallback: SSE 초기 상태가 핸들러 등록 전에 도착했을 경우를 대비하여
 * REST API로 워크플로우 현재 상태를 조회한다.
 * 분산 환경에서도 안전 (Redis 버퍼링 불필요, 기존 엔드포인트 재사용).
 */
async function fetchWorkflowState(jobId: string): Promise<WorkflowRealtimeState | null> {
  try {
    const base = API_BASE();
    const res = await fetch(`${base}/jobs/${jobId}/workflow/state`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function useWorkflowSSE(jobId: string | undefined): WorkflowStateWithQueue {
  
  const [rawState, setRawState] = useState<WorkflowRealtimeState | null>(null);
  const [displayedState, setDisplayedState] = useState<WorkflowRealtimeState | null>(null);
  const [queueLength, setQueueLength] = useState(globalSnapshotQueue.length);
  
  const [stableJobId, setStableJobId] = useState<string | undefined>(jobId);
  const previousJobIdRef = useRef<string | undefined>(jobId);
  const currentJobIdRef = useRef<string | undefined>(jobId);
  const rawStateRef = useRef<WorkflowRealtimeState | null>(null);
  const displayedStateRef = useRef<WorkflowRealtimeState | null>(null);
  const jobEndedRef = useRef(false);
  
  // Track last queued fingerprint to deduplicate
  const lastFingerprintRef = useRef<string>('');
  
  useEffect(() => {
    if (jobId !== previousJobIdRef.current) {
      previousJobIdRef.current = jobId;
      setStableJobId(jobId);
      clearGlobalQueue();
      globalDisplayedState = null;
      lastFingerprintRef.current = '';
    }
  }, [jobId]);
  
  useEffect(() => {
    currentJobIdRef.current = stableJobId;
  }, [stableJobId]);
  
  useEffect(() => {
    rawStateRef.current = rawState;
  }, [rawState]);
  
  useEffect(() => {
    displayedStateRef.current = displayedState;
    globalDisplayedState = displayedState;
  }, [displayedState]);
  
  // ✅ 글로벌 큐 변경 구독
  const queueLengthRef = useRef(globalSnapshotQueue.length);
  
  useEffect(() => {
    const callback = () => {
      const newLength = globalSnapshotQueue.length;
      if (queueLengthRef.current !== newLength) {
        queueLengthRef.current = newLength;
        setQueueLength(newLength);
      }
    };
    globalQueueCallbacks.add(callback);
    return () => {
      globalQueueCallbacks.delete(callback);
    };
  }, []);
  
  const handlerIdRef = useRef<HandlerId | null>(null);
  
  // SSE 구독
  useEffect(() => {
    if (!stableJobId) {
      setRawState(null);
      setDisplayedState(null);
      globalDisplayedState = null;
      return;
    }
    
    jobEndedRef.current = false;
    
    if (handlerIdRef.current !== null) {
      import('@/infrastructure/sse/SSEManager').then(({ sseManager }) => {
        if (handlerIdRef.current !== null) {
          sseManager.unregisterHandlerById(handlerIdRef.current);
          handlerIdRef.current = null;
        }
      });
    }
    
    const handleWorkflowMessage = (data: any) => {
      if (data?.jobId && data.jobId !== stableJobId) {
        return;
      }

      // Handle 'end' event
      if (data.eventType === 'end') {
        jobEndedRef.current = true;
        
        console.log('[useWorkflowState] 🏁 Workflow end event received, resetting workflow');
        useStore.getState().setRunning(false);
        
        clearQueueForJob(data.jobId || stableJobId || '');
        setRawState(null);
        
        // Clear displayed state after last node's min display time
        const lastNode = globalDisplayedNodeId;
        const lastNodeMinTime = lastNode
          ? (NODE_MIN_DISPLAY_TIME[lastNode] || DEFAULT_MIN_DISPLAY_TIME)
          : 0;
        const elapsed = globalDisplayStartTime ? Date.now() - globalDisplayStartTime : lastNodeMinTime;
        const remaining = Math.max(0, lastNodeMinTime - elapsed);
        
        if (globalCleanupTimer) {
          clearTimeout(globalCleanupTimer);
          globalCleanupTimer = null;
        }
        
        globalCleanupTimer = setTimeout(() => {
          setDisplayedState(null);
          globalDisplayedState = null;
          globalDisplayedNodeId = null;
          globalCleanupTimer = null;
        }, remaining);
        
        return;
      }
      
      // Merge recursionCount into kanban state (with active task name for badge display)
      if (data.recursionCount !== undefined) {
        // Find the most recently entered node to identify which worker triggered this update
        const activeNodes: ActiveWorkerNode[] = data.activeNodes || [];
        let taskName: string | undefined;
        if (activeNodes.length > 0) {
          const latestNode = activeNodes.reduce((latest, node) =>
            new Date(node.enteredAt).getTime() > new Date(latest.enteredAt).getTime() ? node : latest
          );
          taskName = latestNode.taskName;
        }
        // Universal rule: fallback to 'unknown' when no task is selected
        // (matches WorkflowBroadcaster default: { name: 'unknown' })
        useStore.getState().updateKanbanRecursion(
          data.recursionCount,
          data.recursionLimit,
          taskName || 'unknown'
        );
      }

      // ✅ Queue activeNodes snapshots
      const activeNodes: ActiveWorkerNode[] = data.activeNodes || [];
      if (activeNodes.length > 0) {
        const messageJobId = data.jobId || stableJobId;
        const fingerprint = activeNodesFingerprint(activeNodes);
        
        // Deduplicate: skip if same fingerprint as last queued
        if (fingerprint !== lastFingerprintRef.current) {
          lastFingerprintRef.current = fingerprint;
          
          globalSnapshotQueue.push({
            activeNodes,
            state: data,
            jobId: messageJobId,
            timestamp: Date.now()
          });
          notifyQueueChange();
        }
      }
      
      setRawState(data);
    };
    
    import('@/infrastructure/sse/SSEManager').then(({ sseManager }) => {
      // ✅ 연결 보장: updateKanban이 setRunning() 없이 currentJobId를 설정한 경우에도
      // workflow SSE 연결이 수립되도록 한다. connectWorkflow는 idempotent하므로 안전.
      if (stableJobId) {
        sseManager.connectWorkflow(stableJobId);
      }
      
      const id = sseManager.registerHandlerWithId('workflow', handleWorkflowMessage);
      handlerIdRef.current = id;

      // HTTP fallback: SSE 연결이 핸들러 등록보다 먼저 수립되어
      // initial_state 메시지가 드롭되었을 경우를 대비하여 REST API로 현재 상태를 조회한다.
      if (stableJobId) {
        fetchWorkflowState(stableJobId).then(state => {
          if (state) handleWorkflowMessage(state);
        }).catch(() => { /* SSE will deliver updates if job is still running */ });
      }
    });
    
    return () => {
      const idToRemove = handlerIdRef.current;
      if (idToRemove !== null) {
        import('@/infrastructure/sse/SSEManager').then(({ sseManager }) => {
          sseManager.unregisterHandlerById(idToRemove);
        });
        handlerIdRef.current = null;
      }
      setRawState(null);
    };
  }, [stableJobId]);
  
  // ✅ 글로벌 큐 처리 (activeNodes 스냅샷 소비)
  useEffect(() => {
    if (globalProcessing || globalSnapshotQueue.length === 0) return;
    
    const myJobSnapshots = globalSnapshotQueue.filter(s => s.jobId === stableJobId);
    if (myJobSnapshots.length === 0) return;
    
    const processNext = async () => {
      globalProcessing = true;
      
      const myJobIndex = globalSnapshotQueue.findIndex(s => s.jobId === stableJobId);
      if (myJobIndex === -1) {
        globalProcessing = false;
        return;
      }
      
      const nextItem = globalSnapshotQueue[myJobIndex];
      
      // Determine the "tracking" node (most recently entered)
      const trackingNode = nextItem.activeNodes.length > 0
        ? nextItem.activeNodes.reduce((latest, node) =>
            node.enteredAt > latest.enteredAt ? node : latest
          )
        : null;
      
      // Wait for previous node's minimum display time
      if (globalDisplayStartTime && globalDisplayedNodeId) {
        const prevNodeElapsed = Date.now() - globalDisplayStartTime;
        const prevNodeMinTime = NODE_MIN_DISPLAY_TIME[globalDisplayedNodeId] || DEFAULT_MIN_DISPLAY_TIME;
        
        if (prevNodeElapsed < prevNodeMinTime) {
          const waitTime = prevNodeMinTime - prevNodeElapsed;
          await new Promise(resolve => {
            globalCurrentTimer = setTimeout(() => {
              globalCurrentTimer = null;
              resolve(undefined);
            }, waitTime);
          });
        }
      }
      
      // Display the snapshot
      globalDisplayStartTime = Date.now();
      globalDisplayedNodeId = trackingNode?.nodeId || null;
      
      // Build displayed state from the snapshot
      setDisplayedState({
        ...nextItem.state,
        activeNodes: nextItem.activeNodes,
      });
      
      // Remove from queue
      const removeIndex = globalSnapshotQueue.findIndex(s => 
        s.jobId === nextItem.jobId && s.timestamp === nextItem.timestamp
      );
      if (removeIndex !== -1) {
        globalSnapshotQueue.splice(removeIndex, 1);
      }
      notifyQueueChange();
      
      // If queue is empty and job ended, schedule cleanup
      if (globalSnapshotQueue.length === 0 && jobEndedRef.current) {
        if (globalCleanupTimer) {
          clearTimeout(globalCleanupTimer);
          globalCleanupTimer = null;
        }
        
        const lastNodeDisplayTime = trackingNode?.nodeId
          ? (NODE_MIN_DISPLAY_TIME[trackingNode.nodeId] || DEFAULT_MIN_DISPLAY_TIME)
          : DEFAULT_MIN_DISPLAY_TIME;
        const elapsedSinceDisplay = Date.now() - globalDisplayStartTime;
        const remainingTime = Math.max(0, lastNodeDisplayTime - elapsedSinceDisplay);
        
        globalCleanupTimer = setTimeout(() => {
          setDisplayedState(null);
          globalDisplayedState = null;
          globalCleanupTimer = null;
        }, remainingTime);
      }
      
      globalProcessing = false;
    };
    
    processNext();
  }, [queueLength]);
  
  // ✅ Stable return reference
  const displayedActiveNodesFingerprint = displayedState?.activeNodes
    ? activeNodesFingerprint(displayedState.activeNodes)
    : '';
  const displayedIsCompleted = displayedState?.isCompleted;
  const rawActiveNodesFingerprint = rawState?.activeNodes
    ? activeNodesFingerprint(rawState.activeNodes)
    : '';
  const rawIsCompleted = rawState?.isCompleted;
  
  const prevReturnRef = useRef<WorkflowStateWithQueue>({ rawState: null, displayedState: null });
  const prevDepsRef = useRef({ displayedActiveNodesFingerprint, displayedIsCompleted, rawActiveNodesFingerprint, rawIsCompleted });
  
  const hasChanged = 
    prevDepsRef.current.displayedActiveNodesFingerprint !== displayedActiveNodesFingerprint ||
    prevDepsRef.current.displayedIsCompleted !== displayedIsCompleted ||
    prevDepsRef.current.rawActiveNodesFingerprint !== rawActiveNodesFingerprint ||
    prevDepsRef.current.rawIsCompleted !== rawIsCompleted;
  
  if (hasChanged) {
    prevReturnRef.current = { rawState, displayedState };
    prevDepsRef.current = { displayedActiveNodesFingerprint, displayedIsCompleted, rawActiveNodesFingerprint, rawIsCompleted };
  }
  
  return prevReturnRef.current;
}
