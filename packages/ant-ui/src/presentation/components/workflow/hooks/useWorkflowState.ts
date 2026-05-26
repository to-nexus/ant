/**
 * useWorkflowSSE Hook (구 useWorkflowState)
 * 
 * App 레벨에서 단일 Workflow SSE 연결 관리
 * 
 * Responsibilities:
 * 1. Workflow SSE 연결 (job 단위)
 * 2. 실시간 노드 상태 수신
 * 3. 노드 전환 큐 기반 스냅샷 순차 소비 (fingerprint 중복 제거)
 * 
 * Refactored for parallel execution:
 * - Uses activeNodes[] instead of currentNode/previousNode/currentTask
 * - Queue stores full activeNodes snapshots
 * - Tracking follows the most recently entered node (by enteredAt)
 * - No artificial minimum display time — snapshots are displayed immediately
 */

import { useState, useEffect, useRef } from 'react';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import type { ActiveWorkerNode } from '@/domain/models/workflow';
import type { HandlerId } from '@/infrastructure/sse/SSEManager';
import { useStore } from '@/domain/store';
import { API_BASE, authFetch } from '@/infrastructure/http/api';

interface WorkflowStateWithQueue {
  rawState: WorkflowRealtimeState | null;
  displayedState: WorkflowRealtimeState | null;
}

/**
 * Minimum time (ms) a non-empty activeNodes snapshot must remain on screen
 * before an empty-activeNodes cleanup is allowed to blank it. Set to a
 * perceptual threshold so short-lived nodes (e.g. checkTaskStatus, triage,
 * detect, resolve) visibly enter the active state instead of being collapsed
 * to nothing by the snapshot queue.
 *
 * NOT a race-protection knob — race protection is handled separately by the
 * cancel-pending-cleanup branch later in this file.
 */
export const NODE_MIN_DISPLAY_MS = 350;

// ✅ 글로벌 단일 큐: activeNodes 스냅샷 기반
interface QueuedSnapshot {
  activeNodes: ActiveWorkerNode[];
  state: WorkflowRealtimeState;
  jobId: string;
  timestamp: number;
}

let globalSnapshotQueue: QueuedSnapshot[] = [];
let globalProcessing = false;
let globalCleanupTimer: ReturnType<typeof setTimeout> | null = null;
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
  
  if (globalCleanupTimer) {
    clearTimeout(globalCleanupTimer);
    globalCleanupTimer = null;
  }
  
  notifyQueueChange();
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
    const res = await authFetch(`${base}/jobs/${jobId}/workflow/state`);
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
  const jobEndedRef = useRef(false);
  
  // Track last queued fingerprint to deduplicate
  const lastFingerprintRef = useRef<string>('');
  
  useEffect(() => {
    if (jobId !== previousJobIdRef.current) {
      previousJobIdRef.current = jobId;
      setStableJobId(jobId);
      clearGlobalQueue();
      lastFingerprintRef.current = '';
    }
  }, [jobId]);
  
  
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
        
        // Clear displayed state immediately
        if (globalCleanupTimer) {
          clearTimeout(globalCleanupTimer);
          globalCleanupTimer = null;
        }
        
        setDisplayedState(null);
        
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

      // ✅ Queue activeNodes snapshots (including empty → clears stale worker badges)
      const activeNodes: ActiveWorkerNode[] = data.activeNodes || [];
      const messageJobId = data.jobId || stableJobId;
      const fingerprint = activeNodesFingerprint(activeNodes);
      
      // Deduplicate: skip if same fingerprint as last queued
      // Empty activeNodes produces fingerprint '' — queued when transitioning from non-empty
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
      
      try {
        const myJobIndex = globalSnapshotQueue.findIndex(s => s.jobId === stableJobId);
        if (myJobIndex === -1) {
          return;
        }
        
        const nextItem = globalSnapshotQueue[myJobIndex];
        
        // Remove from queue (before display to avoid re-processing)
        const removeIndex = globalSnapshotQueue.findIndex(s => 
          s.jobId === nextItem.jobId && s.timestamp === nextItem.timestamp
        );
        if (removeIndex !== -1) {
          globalSnapshotQueue.splice(removeIndex, 1);
        }
        notifyQueueChange();
        
        // ✅ Empty activeNodes = all workers exited → schedule cleanup instead of displaying
        if (nextItem.activeNodes.length === 0) {
          if (globalCleanupTimer) {
            clearTimeout(globalCleanupTimer);
            globalCleanupTimer = null;
          }
          
          // Debounce by NODE_MIN_DISPLAY_MS so short-lived nodes remain visible and a
          // following non-empty snapshot can cancel this cleanup (see cancel branch below).
          globalCleanupTimer = setTimeout(() => {
            setDisplayedState(null);
            globalCleanupTimer = null;
          }, NODE_MIN_DISPLAY_MS);
          
          return;
        }
        
        // ✅ Cancel any pending cleanup timer from previous empty-activeNodes snapshot.
        // Without this, the sequence exitNode(A) → enterNode(B) causes:
        //   1. Empty snapshot → cleanup timer schedules setDisplayedState(null)
        //   2. B snapshot → setDisplayedState(B)
        //   3. Cleanup timer fires → setDisplayedState(null) → B disappears!
        if (globalCleanupTimer) {
          clearTimeout(globalCleanupTimer);
          globalCleanupTimer = null;
        }
        
        // Display the snapshot immediately (non-empty activeNodes)
        setDisplayedState({
          ...nextItem.state,
          activeNodes: nextItem.activeNodes,
        });
        
        // If queue is empty and job ended, clear displayed state
        if (globalSnapshotQueue.length === 0 && jobEndedRef.current) {
          if (globalCleanupTimer) {
            clearTimeout(globalCleanupTimer);
            globalCleanupTimer = null;
          }
          
          // Debounce by NODE_MIN_DISPLAY_MS — share the same perceptual threshold
          // as the empty-activeNodes cleanup above so the final visible node state
          // is not collapsed instantly when a job ends.
          globalCleanupTimer = setTimeout(() => {
            setDisplayedState(null);
            globalCleanupTimer = null;
          }, NODE_MIN_DISPLAY_MS);
        }
      } finally {
        globalProcessing = false;
        
        // ✅ Safety net: if queue still has items for this job, force re-trigger.
        // Prevents queue stall when queueLength state ends up at the same value
        // after batched add+remove (React skips re-render → effect doesn't fire).
        const remainingForJob = globalSnapshotQueue.some(s => s.jobId === stableJobId);
        if (remainingForJob) {
          setTimeout(() => notifyQueueChange(), 0);
        }
      }
    };
    
    processNext().catch((err) => {
      console.error('[useWorkflowState] processNext error:', err);
    });
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
