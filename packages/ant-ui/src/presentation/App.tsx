import { useEffect, useRef } from 'react';
import { GlobalNavBar } from '@/presentation/components/GlobalNavBar';
// Chat data는 ChatPanel에서만 사용 (App에서는 불필요)
import { fetchFeatureSession, stopJob } from '@/infrastructure/http/api';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { useStore } from '@/domain/store';
import { useKanban } from '@/application/hooks/features/useKanban';
import { useWorkflow } from '@/application/hooks/features/useWorkflow';
import { useLayoutState } from '@/application/hooks/ui/useLayoutState';
import { useResizeHandlers } from '@/application/hooks/ui/useResizeHandlers';
import { useHealthCheck } from '@/application/hooks/ui/useHealthCheck';
import { useSessionLoader } from '@/application/hooks/ui/useSessionLoader';
import { useJobRestoration } from '@/application/hooks/ui/useJobRestoration';
import { useConfigLoader } from '@/application/hooks/ui/useConfigLoader';
import { ExplorerPanel } from '@/presentation/components/layout/ExplorerPanel';
import { MainContentArea } from '@/presentation/components/layout/MainContentArea';
import { ChatSidebarWrapper } from '@/presentation/components/layout/ChatSidebarWrapper';
import { ChevronRight } from 'lucide-react';

function App() {
  // ✅ CRITICAL: Render tracking - 무한 렌더링 디버깅용
  const renderCountRef = useRef(0);
  const prevPropsRef = useRef<any>({});
  renderCountRef.current += 1;
  
  // ✅ Layout state management (extracted to hook)
  const layout = useLayoutState();
  const {
    explorerWidth,
    isExplorerCollapsed,
    isResizingExplorer,
    chatWidth,
    isChatCollapsed,
    isResizingChat,
    setExplorerWidth,
    setIsExplorerCollapsed,
    setIsResizingExplorer,
    setChatWidth,
    setIsChatCollapsed,
    setIsResizingChat,
  } = layout;
  
  // ✅ Resize handlers (extracted to hook)
  useResizeHandlers(layout);
  
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const selectedAgent = useStore((state) => state.selectedAgent);
  const isRunning = useStore((state) => state.isRunning);
  const isStopping = useStore((state) => state.isStopping);
  const currentJobId = useStore((state) => state.currentJobId);
  const userStoppedJobId = useStore((state) => state.userStoppedJobId);
  
  // ✅ Kanban data from Domain (via Application Hook)
  const { kanbanData } = useKanban();
  
  // ✅ Workflow data from Domain (via Application Hook)
  const { workflowData } = useWorkflow();
  const workflowState = workflowData;
  
  const currentJob = useStore((state) => state.currentJob);
  const setCurrentJob = useStore((state) => state.setCurrentJob);
  const setRunning = useStore((state) => state.setRunning);
  const setStopping = useStore((state) => state.setStopping);
  const setLastJobFailed = useStore((state) => state.setLastJobFailed);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const selectedWorkType = useStore((state) => state.selectedWorkType);  // ✅ Get selected work type
  const showConfigEditor = useStore((state) => state.showConfigEditor);
  const showFileEditor = useStore((state) => state.showFileEditor);
  const setShowConfigEditor = useStore((state) => state.setShowConfigEditor);
  const setShowFileEditor = useStore((state) => state.setShowFileEditor);
  const setSession = useStore((state) => state.setSession);
  const splitLayout = useStore((state) => state.splitLayout);
  
  // ✅ Chat SSE는 Store에서 자동 관리 (ChatPanel에서만 사용)
  // App.tsx에서는 불필요하므로 제거 → 불필요한 리렌더링 방지

  // ✅ Health check (extracted to hook)
  useHealthCheck();

  // ✅ Session restoration (extracted to hook)
  useSessionLoader(connectionStatus);

  // ✅ Job restoration (extracted to hook)
  useJobRestoration({ 
    connectionStatus
  });

  // ✅ Config loading (extracted to hook)
  const { configData, isLoadingConfig, handleSaveConfig } = useConfigLoader(
    showConfigEditor,
    selectedProject || null
  );

  // ✅ CRITICAL: Track what changed to trigger re-render
  const currentProps = {
    selectedProject,
    selectedFeature,
    selectedFile,
    selectedAgent,
    isRunning,
    isStopping,
    currentJobId,
    userStoppedJobId,
    kanbanDataSource: kanbanData?.dataSource, // Track data source (live/estimating/session)
    workflowData: workflowData?.currentNode, // Track current node
    configData: !!configData,
    isLoadingConfig,
    isExplorerCollapsed,
    explorerWidth,
    isResizingExplorer,
    isChatCollapsed,
    chatWidth,
    isResizingChat,
  };
  
  if (renderCountRef.current > 1) {
    const changes: string[] = [];
    Object.keys(currentProps).forEach(key => {
      if (prevPropsRef.current[key] !== currentProps[key as keyof typeof currentProps]) {
        changes.push(`${key}: ${prevPropsRef.current[key]} → ${currentProps[key as keyof typeof currentProps]}`);
      }
    });
    if (changes.length > 0) {
      console.log(`[App] 🔄 Render #${renderCountRef.current} - Changes:`, changes);
    } else {
      console.log(`[App] 🔄 Render #${renderCountRef.current} - NO CHANGES (unnecessary render!)`);
    }
  }
  prevPropsRef.current = currentProps;

  // Load session when project/feature changes (but not during task execution)
  useEffect(() => {
    async function loadSession() {
      if (!selectedProject || !selectedFeature) {
        setSession(undefined);
        return;
      }

      // Don't reload session while task is running (use live data instead)
      if (isRunning) {
        console.log('[App] Skipping session load (task is running, using live data)');
        return;
      }

      try {
        console.log('[App] Loading session for:', selectedProject, selectedFeature);
        const job = (selectedWorkType as 'design' | 'code' | 'learn') || 'code';  // ✅ Get job from workType
        const session = await fetchFeatureSession(selectedProject, selectedFeature, job);  // ✅ Pass job
        setSession(session ?? undefined);
        console.log('[App] Session loaded:', {
          hasSession: !!session,
          taskQueueSize: session?.state?.taskQueue?.length ?? 0,
          completedTasksCount: session?.state?.completedTasks?.length ?? 0
        });
      } catch (error) {
        console.error('[App] Failed to load session:', error);
        setSession(undefined);
      }
    }

    loadSession();
    // NOTE: isRunning is intentionally NOT in dependencies to prevent reload during task execution
    // ✅ selectedWorkType 추가 - job 전환 시 session 재로드
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, selectedFeature, selectedWorkType, setSession]);

  // Auto-open file editor when a file is selected
  useEffect(() => {
    if (selectedFile) {
      setShowFileEditor(true);
    } else {
      // Close file editor when file is deselected
      setShowFileEditor(false);
    }
  }, [selectedFile, setShowFileEditor]);

  // ✅ All initialization logic moved to custom hooks above

  const handleRunTask = async (agent: string, task: string) => {
    console.log('[App] handleRunTask called:', { agent, task, isRunning, selectedProject, selectedFeature });
    
    if (isRunning || !selectedProject) {
      console.warn('[App] Cannot run:', { isRunning, selectedProject });
      return;
    }

    // ✅ CRITICAL: Check if this is a Resume or New task
    const kanbanData = useStore.getState().kanban;
    const currentJobId = kanbanData?.jobId;
    const hasInterruption = kanbanData?.interruption?.canResume === true;
    
    // ✅ Resume existing job (jobId exists + interruption)
    if (currentJobId && hasInterruption) {
      console.log(`[App] Resuming existing job: ${currentJobId}`);
      
      try {
        // ✅ Set running state immediately
        setRunning(true, currentJobId);
        
        const result = await resumeJob(currentJobId, selectedProject, selectedFeature!, true);  // chatSource: true
        console.log('[App] Resume successful:', result);
        console.log(`  Original job: ${result.originalJobId}`);
        console.log(`  New job: ${result.jobId}`);
        console.log(`  Job type: ${result.jobType}`);
        
        // ✅ Update with new jobId from server
        setRunning(true, result.jobId);
        
        // ✅ CRITICAL: Dismiss interruption UI globally
        if (kanbanData?.interruption?.timestamp) {
          useStore.getState().setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
        }
      } catch (error) {
        console.error('[App] Failed to resume job:', error);
        setRunning(false);
        alert(`Failed to resume job: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      return;
    }

    // ✅ Start new job
    console.log('[App] Starting new job...');
    
    // Start running state immediately (jobId will be set when server responds)
    console.log('[App] Setting running state...');
    setRunning(true, undefined, 'generate'); // Default mode

    try {
      console.log('[App] Calling executeCodeJob...');
      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,  // Pass selected feature
        task: task as any,
        agent: agent as any,
        mode: 'generate', // This should be inferred or passed from UI
        language: 'en',
        chatSource: true,  // ✅ Enable Chat SSE for task board/GNB runs
      });

      console.log('[App] jobExecution created:', jobExecution);
      setCurrentJob(jobExecution);

      // Update with actual jobId once server responds
      console.log('[App] Setting up onJobIdReady callback...');
      jobExecution.onJobIdReady((jobId) => {
        console.log('[App] Job ID ready:', jobId);
        setRunning(true, jobId, 'generate');
      });

      // ✅ Exit handler is no longer needed - Kanban SSE detects completion
      // Job cleanup will happen via useEffect watching isRunning
      console.log('[App] Job started, completion will be detected by Kanban SSE');
    } catch (error) {
      console.error('Failed to execute job:', error);
      setRunning(false);
      setCurrentJob(null);
    }
  };
  
  // ✅ Watch isRunning to detect job completion (via Kanban SSE)
  useEffect(() => {
    // Skip if still running or stopping
    if (isRunning || isStopping) return;
    
    // Skip if no job was running
    if (!currentJob && !currentJobId) return;
    
    // ✅ Job completed - cleanup and reload
    console.log('[App] Job completion detected (isRunning -> false)');
    
    // Clear currentJob reference
    if (currentJob) {
      console.log('[App] Clearing currentJob reference');
      setCurrentJob(null);
    }
    
    // Reload session and file tree
    if (selectedProject && selectedFeature) {
      console.log('[App] Reloading session after job completion...');
      fetchFeatureSession(selectedProject, selectedFeature)
        .then(session => {
          setSession(session ?? undefined);
          console.log('[App] Session reloaded after job completion');
        })
        .catch(error => {
          console.error('[App] Failed to reload session:', error);
        });
      
      refreshFileTree();
    }
  }, [isRunning, isStopping, currentJob, currentJobId, selectedProject, selectedFeature]);

  // ✅ Centralized Stop Task Handler
  const handleStopTask = async () => {
    console.log('[App] Stopping task...', { 
      hasCurrentTask: !!currentJob, 
      currentJobId: currentJobId,
      isRunning,
      selectedProject, 
      selectedFeature 
    });
    
    // ✅ Set "Stopping..." state immediately
    console.log('[App] 🛑 Setting stopping state...');
    setStopping(true);
    
    // ✅ CRITICAL: Mark this job as explicitly stopped by user and clear localStorage
    if (currentJobId) {
      console.log(`[App] 🚫 Marking job ${currentJobId} as user-stopped`);
      useStore.setState({ userStoppedJobId: currentJobId });
      
      // ✅ Immediately clear localStorage to prevent auto-restore
      localStorage.removeItem('ant-ui:running-task');
      localStorage.removeItem('ant-ui:task-start-time');
      localStorage.removeItem('ant-ui:task-mode');
    }
    
    // ✅ Send stop request to server and wait for confirmation
    try {
      if (!currentJobId) {
        console.warn('[App] ⚠️ No currentJobId to stop');
        return;
      }
      
      // ✅ Send stop request to server (no EventSource to close - logs SSE removed)
      const jobType = (selectedWorkType as 'design' | 'code' | 'learn') || 'code';
      console.log(`[App] Sending stop request to server... jobType: ${jobType}`);
      await stopJob(currentJobId, selectedProject || undefined, selectedFeature || undefined, jobType);
      console.log('[App] ✅ Server confirmed stop');
      
      // ✅ Now update UI after server confirmation
      console.log('[App] 🎯 Server confirmed, updating UI...');
      setRunning(false);
      setCurrentJob(null);
      
      // ✅ Finalize chat message if exists (mark as complete)
      if (selectedProject && selectedFeature) {
        try {
          console.log('[App] Finalizing chat message...');
          await fetch(
            `${import.meta.env.VITE_API_BASE || 'http://localhost:4100/api'}/projects/${selectedProject}/features/${selectedFeature}/chat/finalize-message`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }
          );
          console.log('[App] Chat message finalized');
        } catch (error) {
          console.error('[App] Failed to finalize chat message:', error);
        }
      }
      
      // Reload session after server confirms stop
      if (selectedProject && selectedFeature) {
        console.log('[App] Reloading session after stop...');
        try {
          const session = await fetchFeatureSession(selectedProject, selectedFeature);
          setSession(session ?? undefined);
          console.log('[App] Session reloaded');
        } catch (error) {
          console.error('[App] Failed to reload session:', error);
        }
      }
    } catch (error) {
      console.error('[App] Failed to stop task on server:', error);
      // Still update UI even if server fails
      setRunning(false);
      setCurrentJob(null);
    } finally {
      // ✅ Clear stopping state after everything completes
      // Keep stopping=true during session reload to prevent auto-restore
      console.log('[App] 🔓 Clearing stopping state...');
      setStopping(false);
    }
  };

  // ✅ Register handleStopTask globally for ChatInput to use
  useEffect(() => {
    (window as any).__stopTaskHandler = handleStopTask;
    return () => {
      delete (window as any).__stopTaskHandler;
    };
  }, [handleStopTask]);

  return (
    <div className="h-screen bg-[#f6f8fa] dark:bg-[#0d1117] flex flex-col transition-colors">
      <GlobalNavBar onRunTask={handleRunTask} onStopTask={handleStopTask} isRunning={isRunning} isStopping={isStopping} />
      
      {/* Main Layout */}
      <div className="flex-1 flex gap-0 overflow-hidden pt-16">
        {/* Explorer Panel */}
        <ExplorerPanel
          isCollapsed={isExplorerCollapsed}
          width={explorerWidth}
          selectedFile={selectedFile || null}
          showFileEditor={showFileEditor}
          connectionStatus={connectionStatus}
          onCollapse={() => setIsExplorerCollapsed(true)}
          onToggleFileEditor={() => setShowFileEditor(!showFileEditor)}
          onResizeStart={() => setIsResizingExplorer(true)}
        />
        
        {/* Collapsed Explorer Button */}
        {isExplorerCollapsed && (
          <div className="w-10 bg-white dark:bg-[#161b22] border-r border-gray-200 dark:border-[#30363d] flex flex-col items-center shrink-0 transition-colors shadow-sm">
            <button
              onClick={() => {
                setIsExplorerCollapsed(false);
                setExplorerWidth(320);
              }}
              className="h-10 w-10 flex items-center justify-center border-b border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title="Expand Explorer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <MainContentArea
          showConfigEditor={showConfigEditor}
          configData={configData}
          isLoadingConfig={isLoadingConfig}
          onSaveConfig={handleSaveConfig}
          onCloseConfig={() => setShowConfigEditor(false)}
          showFileEditor={showFileEditor}
          selectedFile={selectedFile || null}
          onCloseFileEditor={() => setShowFileEditor(false)}
          connectionStatus={connectionStatus}
          splitLayout={splitLayout}
          kanbanData={kanbanData}
          workflowState={workflowState}
        />

        {/* Chat Panel */}
        <ChatSidebarWrapper
          isCollapsed={isChatCollapsed}
          width={chatWidth}
          isResizing={isResizingChat}
          selectedAgent={selectedAgent || null}
          selectedProject={selectedProject || null}
          selectedFeature={selectedFeature || null}
          onExpand={() => {
            setIsChatCollapsed(false);
            setChatWidth(400);
          }}
          onCollapse={() => setIsChatCollapsed(true)}
          onResizeStart={() => setIsResizingChat(true)}
        />
      </div>
    </div>
  );
}

export default App;