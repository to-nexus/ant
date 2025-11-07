import { useStore } from '@/lib/store';
import { useEffect, useState } from 'react';
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
  const isRunning = useStore((state) => state.isRunning);
  const isStopping = useStore((state) => state.isStopping);
  const userStoppedJobId = useStore((state) => state.userStoppedJobId);
  const setRunning = useStore((state) => state.setRunning);
  const setCurrentJob = useStore((state) => state.setCurrentJob);
  const setSession = useStore((state) => state.setSession);
  const splitLayout = useStore((state) => state.splitLayout);
  
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
  const [previousDataSource, setPreviousDataSource] = useState<string | undefined>(undefined);

  // ✅ CRITICAL: Optimistic update on stop
  // When user clicks Stop, immediately update kanbanData to "stopped" state
  // Server SSE will overwrite with actual data when it arrives
  useEffect(() => {
    if (isStopping) {
      console.log('[KanbanBoard] 🛑 Optimistic update: forcing stopped state');
      setKanbanData(prev => ({
        ...prev,
        isEstimating: false,
        dataSource: 'session',
        activeJobId: undefined
      }));
    }
  }, [isStopping]);

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

    eventSource.onerror = (error) => {
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

  // Detect agent job start/completion/stop
  useEffect(() => {
    const currentDataSource = kanbanData.dataSource;
    const activeJobId = (kanbanData as any).activeJobId;  // Job ID from server
    
    // ✅ CRITICAL: Skip ALL auto-restore logic during stop process
    // BUT still update previousDataSource to prevent repeated triggers
    if (isStopping) {
      console.log('[KanbanBoard] ⏸️  Skipping all auto-restore logic (stopping in progress)');
      setPreviousDataSource(currentDataSource);
      return;
    }
    
    // ✅ Job started (detected via server state)
    // Only restore if:
    // - dataSource is NOT 'session' (to prevent restoring stopped jobs)
    // - NOT currently stopping (prevent restore right after stop)
    // - NOT a job that user explicitly stopped (prevent restore after user Stop)
    if ((currentDataSource === 'live' || currentDataSource === 'estimating') && 
        !isRunning && 
        !isStopping && 
        activeJobId &&
        activeJobId !== userStoppedJobId) {  // ✅ CRITICAL: Don't restore jobs user stopped
      console.log('[KanbanBoard] ✅ Job detected via server, restoring UI state');
      console.log('   activeJobId:', activeJobId);
      console.log('   dataSource:', currentDataSource);
      
      // Restore running state
      setRunning(true, activeJobId, 'generate');
      
      // Reconnect Log SSE
      const { startLogStream } = useStore.getState();
      startLogStream(activeJobId);
      
      console.log('[KanbanBoard] UI state restored from server');
    } else if (activeJobId === userStoppedJobId) {
      console.log('[KanbanBoard] 🚫 Skipping restore - user explicitly stopped this job:', activeJobId);
    }
    
    // ✅ Job ended (live→session transition OR no activeJobId)
    if (isRunning && !isStopping && (
      // Case 1: Transition from live/estimating to session
      ((previousDataSource === 'live' || previousDataSource === 'estimating') && currentDataSource === 'session') ||
      // Case 2: No activeJobId anymore (job was deleted)
      (!activeJobId && currentDataSource === 'session')
    )) {
      console.log('[KanbanBoard] Task ended detected, clearing UI state');
      console.log('   Reason:', !activeJobId ? 'No activeJobId' : 'dataSource changed to session');
      setRunning(false);
      setCurrentJob(null);  // ✅ Also clear currentJob
    }
    
    setPreviousDataSource(currentDataSource);
  }, [kanbanData.dataSource, (kanbanData as any).activeJobId, previousDataSource, isRunning, isStopping, userStoppedJobId, setRunning, setCurrentJob]);

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

  return (
    <BoardContainer 
      title="📋 Task Board"
      titleActions={
        <DataSourceIndicator 
          dataSource={kanbanData.dataSource} 
          isStopping={isStopping}  // ✅ 즉각적인 피드백
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
      {/* Paused State: Show resume prompt (only when NOT running) */}
      {kanbanData.pausedDueToLimit && !kanbanData.isEstimating && !isRunning && (
        <KanbanPausedPrompt
          tasksRemaining={kanbanData.tasksRemaining || 0}
          onResume={handleResumeTask}
        />
      )}

      {/* Estimating State: Show only banner, hide columns */}
      {/* ✅ 즉각적인 피드백: isStopping이면 Estimating 표시 안 함 */}
      {kanbanData.isEstimating && !isStopping ? (
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

