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
          console.log('[Kanban SSE] Received update:', {
            todoCount: data.todo?.length ?? 0,
            hasInProgress: !!data.inProgress,
            completedCount: data.completed?.length ?? 0,
            isEstimating: data.isEstimating,
            dataSource: data.dataSource
          });
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

  // Detect agent job completion/stop
  useEffect(() => {
    const currentDataSource = kanbanData.dataSource;
    
    if ((previousDataSource === 'live' || previousDataSource === 'estimating') && 
        currentDataSource === 'session' && 
        isRunning) {
      console.log('[KanbanBoard] Task ended detected (live→session), updating UI state');
      setRunning(false);
    }
    
    setPreviousDataSource(currentDataSource);
  }, [kanbanData.dataSource, previousDataSource, isRunning, setRunning]);

  // Handle Resume Task
  const handleResumeTask = async () => {
    if (!selectedProject || !selectedFeature) return;
    
    console.log('[KanbanBoard] Resume Task clicked');
    setRunning(true, undefined, 'generate');
    
    try {
      const { executeCodeJob } = await import('@/lib/cli');
      const { fetchFeatureSession } = await import('@/lib/api');
      
      const taskExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        task: 'code',
        agent: 'architect',
        mode: 'generate',
        language: 'en',
      });
      
      setCurrentJob(taskExecution);
      
      if (taskExecution.onTaskIdReady) {
        taskExecution.onTaskIdReady((taskId) => {
          console.log('[KanbanBoard] Task ID ready:', taskId);
          setRunning(true, taskId, 'generate');
        });
      }
      
      taskExecution.on('exit', async (code, _signal) => {
        console.log(`[KanbanBoard] Task exited with code ${code}`);
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
      
      console.log('[KanbanBoard] Task resumed successfully');
    } catch (error) {
      console.error('[KanbanBoard] Failed to resume task:', error);
      setRunning(false);
      setCurrentJob(null);
      alert('Failed to resume task. Please try again.');
    }
  };

  // Calculate totals
  const totalTasks = kanbanData.todo.length + (kanbanData.inProgress ? 1 : 0) + kanbanData.completed.length;

  // Render: No selection
  if (!selectedProject || !selectedFeature) {
    return (
      <BoardContainer title="📋 Task Board">
        <div className="text-center py-12">
          {selectedProject && selectedFeature ? (
            <div>
              <div className="mb-2">📋 No tasks yet.</div>
              <div className="text-xs">Run an agent job to start generating the task queue.</div>
            </div>
          ) : (
            <div className="text-gray-500 dark:text-gray-400">
              Select a project and feature to view tasks
            </div>
          )}
        </div>
      </BoardContainer>
    );
  }

  return (
    <BoardContainer 
      title="📋 Task Board"
      titleActions={
        <DataSourceIndicator dataSource={kanbanData.dataSource} />
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
      {kanbanData.isEstimating ? (
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

