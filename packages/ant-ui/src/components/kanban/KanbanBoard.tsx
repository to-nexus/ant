import { useStore } from '@/lib/store';
import { useEffect, useState } from 'react';
import { useUIActionPolicy } from '@/hooks/useUIActionPolicy';
import { KanbanData } from '@/lib/api';
import { BoardContainer } from '../BoardContainer';
import { DataSourceIndicator, GaugesGroup } from './KanbanHeader';
import { KanbanEstimating } from './KanbanEstimating';
import { KanbanPausedPrompt } from './KanbanPausedPrompt';
import { KanbanColumns } from './KanbanColumns';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

/**
 * KanbanBoard Component - Main Orchestrator
 * 
 * Manages SSE connection, state, and coordinates sub-components
 * 
 * Architecture:
 * - Backend provides complete, ready-to-render data via SSE stream
 * - Frontend receives real-time updates (no polling!)
 * - Instant updates when queue changes, or when Task Board tasks start/complete
 */
export function KanbanBoard() {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const setRunning = useStore((state) => state.setRunning);
  const setCurrentJob = useStore((state) => state.setCurrentJob);
  const setSession = useStore((state) => state.setSession);
  const splitLayout = useStore((state) => state.splitLayout);
  
  // ✅ UI Action Policy (provides isRunning, isStopping, etc.)
  const policy = useUIActionPolicy();
  
  const [kanbanData, setKanbanData] = useState<KanbanData>({
    todo: [],
    inProgress: null,
    completed: []
  });
  
  // Animation state
  const [newlyCompletedIds, setNewlyCompletedIds] = useState<Set<string>>(new Set());
  const [previousCompletedIds, setPreviousCompletedIds] = useState<Set<string>>(new Set());
  const [newlyInProgressId, setNewlyInProgressId] = useState<string | null>(null);
  const [previousInProgressId, setPreviousInProgressId] = useState<string | null>(null);
  
  // ✅ Track estimating state for To Do → In Progress animation
  const [previousEstimating, setPreviousEstimating] = useState(false);
  
  // ✅ Track dismissed interrupts (user chose to ignore)
  const [dismissedInterruptJobId, setDismissedInterruptJobId] = useState<string | null>(null);
  
  // ✅ Reset dismissed state when interruption changes (new job/interrupt)
  useEffect(() => {
    if (kanbanData.interruption?.timestamp && 
        dismissedInterruptJobId !== kanbanData.interruption.timestamp) {
      // New interruption appeared, clear the dismissed state
      setDismissedInterruptJobId(null);
    }
  }, [kanbanData.interruption?.timestamp, dismissedInterruptJobId]);

  // ✅ CRITICAL: Optimistic update on stop
  // When user clicks Stop, immediately update kanbanData to "stopped" state
  // Server SSE will overwrite with actual data when it arrives
  useEffect(() => {
    if (policy.isStopping) {
      console.log('[KanbanBoard] 🛑 Optimistic update: forcing stopped state');
      setKanbanData(prev => ({
        ...prev,
        isEstimating: false,
        dataSource: 'session',
        activeJobId: undefined
      }));
    }
  }, [policy.isStopping]);

  // SSE connection for real-time updates
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setKanbanData({ todo: [], inProgress: null, completed: [] });
      return;
    }

    let eventSource: EventSource | null = null;
    let isMounted = true;

    const fetchSessionData = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/kanban`
        );
        if (response.ok && isMounted) {
          const data = await response.json();
          console.log('[Kanban] Loaded session data (agent job not running)');
          setKanbanData(data);
        }
      } catch (error) {
        console.error('[Kanban] Failed to fetch session data:', error);
      }
    };

    console.log(`[Kanban] Attempting SSE connection to ${selectedProject}/${selectedFeature}`);
    
    eventSource = new EventSource(
      `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/kanban/stream`
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (isMounted) {
          const activeJobId = data.activeJobId;
          const dataSource = data.dataSource;
          const userStoppedJobId = useStore.getState().userStoppedJobId;
          const isStopping = useStore.getState().isStopping;
          
          console.log('[Kanban SSE] Received update:', {
            todoCount: data.todo?.length ?? 0,
            hasInProgress: !!data.inProgress,
            completedCount: data.completed?.length ?? 0,
            hasInterruption: !!data.interruption,
            interruptionReason: data.interruption?.reason,
            isEstimating: data.isEstimating,
            dataSource: dataSource,
            activeJobId: activeJobId,
            hasActiveJobId: !!activeJobId,
            isStopping: isStopping,
            userStoppedJobId: userStoppedJobId
          });
          
          // ✅ CRITICAL: Filter data during stop process
          // Rule 1: If stopping, ONLY accept session data (server confirmed stop)
          if (isStopping) {
            if (dataSource === 'session' && !activeJobId) {
              console.log('[Kanban SSE] ✅ Accepting session data (stop confirmed)');
              setKanbanData(data);
            } else {
              console.log('[Kanban SSE] 🚫 Ignoring data during stop (waiting for server)');
              console.log('   dataSource:', dataSource, ', activeJobId:', activeJobId);
            }
            return;
          }
          
          // Rule 2: If user stopped this job, ignore its active data
          if (userStoppedJobId && activeJobId === userStoppedJobId) {
            console.log('[Kanban SSE] 🚫 Ignoring data for user-stopped job:', activeJobId);
            return;
          }
          
          // Rule 3: Accept all other data
          setKanbanData(data);
        }
      } catch (error) {
        console.error('[Kanban SSE] Failed to parse data:', error);
      }
    };

    eventSource.onerror = (_error) => {
      console.log('[Kanban SSE] Connection error, but keeping connection alive for session file updates');
    };

    fetchSessionData();

    return () => {
      isMounted = false;
      if (eventSource) {
        eventSource.close();
        console.log('[Kanban] SSE connection closed');
      }
    };
  }, [selectedProject, selectedFeature]);

  // Detect newly completed tasks
  useEffect(() => {
    const currentCompletedIds = new Set(kanbanData.completed.map(task => task.id || task.name));
    const newIds = new Set<string>();
    
    currentCompletedIds.forEach(id => {
      if (!previousCompletedIds.has(id)) {
        newIds.add(id);
      }
    });
    
    if (newIds.size > 0) {
      setNewlyCompletedIds(newIds);
      setPreviousCompletedIds(currentCompletedIds);
    }
  }, [kanbanData.completed, previousCompletedIds]);

  // Detect newly in-progress task
  useEffect(() => {
    const currentInProgressId = kanbanData.inProgress?.id || kanbanData.inProgress?.name || null;
    
    if (currentInProgressId && currentInProgressId !== previousInProgressId) {
      setNewlyInProgressId(currentInProgressId);
      setPreviousInProgressId(currentInProgressId);
    }
  }, [kanbanData.inProgress, previousInProgressId]);
  
  // ✅ Track estimating state changes
  useEffect(() => {
    const isEstimating = kanbanData.isEstimating;
    
    if (isEstimating !== previousEstimating) {
      console.log('[KanbanBoard] Estimating state changed:', {
        from: previousEstimating,
        to: isEstimating
      });
      setPreviousEstimating(!!isEstimating);
    }
  }, [kanbanData.isEstimating, previousEstimating]);

  // Note: Job state synchronization (start/stop detection) is now handled
  // by useJobStateSync hook in App.tsx (see App.tsx:33)
  // KanbanBoard is purely a display component for kanban data

  // Handle Resume Task
  const handleResumeTask = async () => {
    if (!selectedProject || !selectedFeature) return;
    
    console.log('[KanbanBoard] Resume Task clicked');
    setRunning(true, undefined, 'generate');
    
    try {
      const { executeCodeJob } = await import('@/lib/cli');
      const { fetchFeatureSession } = await import('@/lib/api');
      
      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        task: 'code',
        agent: 'architect',
        mode: 'generate',
        language: 'en',
      });
      
      setCurrentJob(jobExecution);
      
      if (jobExecution.onJobIdReady) {
        jobExecution.onJobIdReady((jobId) => {
          console.log('[KanbanBoard] Job ID ready:', jobId);
          setRunning(true, jobId, 'generate');
        });
      }
      
      jobExecution.on('exit', async (code, _signal) => {
        console.log(`[KanbanBoard] Job exited with code ${code}`);
        setRunning(false);
        setCurrentJob(null);
        
        if (selectedProject && selectedFeature) {
          try {
            const session = await fetchFeatureSession(selectedProject, selectedFeature);
            setSession(session ?? undefined);
          } catch (error) {
            console.error('[KanbanBoard] Failed to reload session:', error);
          }
        }
      });
      
      console.log('[KanbanBoard] Job resumed successfully');
    } catch (error) {
      console.error('[KanbanBoard] Failed to resume job:', error);
      setRunning(false);
      setCurrentJob(null);
      alert('Failed to resume job. Please try again.');
    }
  };
  
  // ✅ Handler for dismissing the interrupt UI
  const handleDismissInterrupt = () => {
    console.log('[KanbanBoard] User dismissed interrupt UI');
    // Track the job ID or timestamp to prevent showing it again
    const jobIdOrTimestamp = kanbanData.interruption?.timestamp || Date.now().toString();
    setDismissedInterruptJobId(jobIdOrTimestamp);
  };

  // Calculate totals
  const totalTasks = kanbanData.todo.length + (kanbanData.inProgress ? 1 : 0) + kanbanData.completed.length;

  // Render: No selection
  if (!selectedProject || !selectedFeature) {
    return (
      <BoardContainer title="📋 Task Board">
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md">
            <div className="text-gray-400 dark:text-gray-600 text-6xl mb-4">📋</div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              No Workspace or Feature Selected
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Select a workspace and feature to view tasks.
            </p>
          </div>
        </div>
      </BoardContainer>
    );
  }

  // ✅ UI Policy: Interrupt UI 표시 여부 (Policy + KanbanData 조건 + Dismissed 체크)
  const shouldShowInterruptUI = 
    policy.shouldShowInterruptUI &&  // Policy: !isRunning && !isStopping
    !kanbanData.isEstimating &&      // Not estimating
    !!kanbanData.interruption &&     // Has interruption data
    dismissedInterruptJobId !== kanbanData.interruption.timestamp; // Not dismissed
  
  // Debug logging
  if (kanbanData.interruption) {
    console.log('[KanbanBoard] Interruption detected:', {
      hasInterruption: !!kanbanData.interruption,
      interruptionReason: kanbanData.interruption.reason,
      isEstimating: kanbanData.isEstimating,
      policyAllows: policy.shouldShowInterruptUI,
      isRunning: policy.isRunning,
      isStopping: policy.isStopping,
      shouldShowUI: shouldShowInterruptUI
    });
  }
  
  return (
    <BoardContainer 
      title="📋 Task Board"
      titleActions={
        <DataSourceIndicator 
          dataSource={kanbanData.dataSource} 
          isStopping={policy.isStopping}  // ✅ UI Policy
        />
      }
      headerActions={
        <GaugesGroup
          recursionCount={kanbanData.recursionCount}
          recursionLimit={kanbanData.recursionLimit}
          completedCount={kanbanData.completed.length}
          totalTasks={totalTasks}
        />
      }
    >
      {/* Interrupted State: Show resume prompt for all interruption reasons (only when NOT running) */}
      {shouldShowInterruptUI && kanbanData.interruption && (
        <KanbanPausedPrompt
          interruption={kanbanData.interruption}
          onResume={handleResumeTask}
          onDismiss={handleDismissInterrupt}
        />
      )}

      {/* Estimating State: Show only banner, hide columns */}
      {/* ✅ UI Policy: isStopping이면 Estimating 표시 안 함 */}
      {kanbanData.isEstimating && !policy.isStopping ? (
        <KanbanEstimating />
      ) : (
        <KanbanColumns
          todoTasks={kanbanData.todo}
          inProgressTask={kanbanData.inProgress}
          completedTasks={kanbanData.completed}
          newlyCompletedIds={newlyCompletedIds}
          newlyInProgressId={newlyInProgressId}
          splitLayout={splitLayout}
          onShineComplete={(taskId) => {
            setNewlyCompletedIds(prev => {
              const next = new Set(prev);
              next.delete(taskId);
              return next;
            });
          }}
          onInProgressAnimationComplete={() => {
            setNewlyInProgressId(null);
          }}
        />
      )}
    </BoardContainer>
  );
}

