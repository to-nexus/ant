import { useState, useEffect } from 'react';
import { GlobalNavBar } from './components/GlobalNavBar';
import { ProjectDropdown } from './components/ProjectDropdown';
import { FeatureDropdown } from './components/FeatureDropdown';
import { ArtifactsPanel } from './components/ArtifactsPanel';
import { KanbanBoard } from './components/kanban';
import { AgentWorkflowBoard } from './components/workflow';
import { MainPanel } from './components/MainPanel';
import { MainPanelBar } from './components/MainPanelBar';
import { TerminalBar } from './components/TerminalBar';
import { SplitLayout } from './components/SplitLayout';
import { Bar } from './components/Bar';
import { FileEditorPanel } from './components/FileEditorPanel';
import { ConfigEditor } from './components/ConfigEditor';
import { checkHealth, fetchProjectConfig, updateProjectConfig, ProjectConfig, fetchFeatureSession, stopJob } from './lib/api';
import { executeCodeJob } from './lib/cli';
import { useStore } from './lib/store';
import { useKanbanSSE } from './hooks/useKanbanSSE';
import { useWorkflowSSE } from './components/workflow/hooks';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function App() {
  const [configData, setConfigData] = useState<ProjectConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(320); // 80 * 4 = 320px (w-80)
  const [isResizingExplorer, setIsResizingExplorer] = useState(false);

  const MIN_EXPLORER_WIDTH = 160; // 최소 너비
  const MAX_EXPLORER_WIDTH = 600; // 최대 너비
  
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const isRunning = useStore((state) => state.isRunning);
  const isStopping = useStore((state) => state.isStopping);
  const currentJobId = useStore((state) => state.currentJobId);
  const userStoppedJobId = useStore((state) => state.userStoppedJobId);
  
  // ✅ Single Kanban SSE connection (project/feature 단위)
  const { kanbanData } = useKanbanSSE();
  
  // ✅ Single Workflow SSE connection (job 단위)
  const shouldSubscribeWorkflow = currentJobId && currentJobId !== userStoppedJobId;
  const { displayedState: workflowState } = useWorkflowSSE(shouldSubscribeWorkflow ? currentJobId : undefined);
  
  const currentJob = useStore((state) => state.currentJob);
  const setCurrentJob = useStore((state) => state.setCurrentJob);
  const setRunning = useStore((state) => state.setRunning);
  const setStopping = useStore((state) => state.setStopping);
  const setConnectionStatus = useStore((state) => state.setConnectionStatus);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const fetchProjects = useStore((state) => state.fetchProjects);
  const setProjects = useStore((state) => state.setProjects);
  const selectedWorkType = useStore((state) => state.selectedWorkType);  // ✅ Get selected work type
  const showConfigEditor = useStore((state) => state.showConfigEditor);
  const showFileEditor = useStore((state) => state.showFileEditor);
  const setShowConfigEditor = useStore((state) => state.setShowConfigEditor);
  const setShowFileEditor = useStore((state) => state.setShowFileEditor);
  const setSession = useStore((state) => state.setSession);
  const splitLayout = useStore((state) => state.splitLayout);
  const startLogStream = useStore((state) => state.startLogStream);

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

  // Load config when config editor is opened
  useEffect(() => {
    async function loadConfig() {
      if (!showConfigEditor || !selectedProject) {
        setConfigData(null);
        return;
      }

      setIsLoadingConfig(true);
      try {
        const config = await fetchProjectConfig(selectedProject);
        if (config) {
          setConfigData(config);
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      } finally {
        setIsLoadingConfig(false);
      }
    }

    loadConfig();
  }, [showConfigEditor, selectedProject]);

  const handleSaveConfig = async (config: ProjectConfig) => {
    if (!selectedProject) return;

    try {
      // Backend now returns the saved config directly
      const savedConfig = await updateProjectConfig(selectedProject, config);
      if (savedConfig) {
        setConfigData(savedConfig);
      }
      alert('Configuration saved successfully!');
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save configuration. Please try again.');
    }
  };

  // Periodic health check and restore running task
  useEffect(() => {
    async function checkConnectionAndLoadProjects() {
      try {
        console.log('[App] Checking health...');
        setConnectionStatus('disconnected');
        
        const isHealthy = await checkHealth();
        if (!isHealthy) {
          console.error('[App] Health check failed');
          setConnectionStatus('error');
          setProjects([]);
          return;
        }
        
        console.log('[App] Health check passed, loading projects...');
        await fetchProjects();
        setConnectionStatus('connected');

        // Restore selected project and feature from localStorage
        try {
          const savedProject = localStorage.getItem('ant-ui:selected-project');
          const savedFeature = localStorage.getItem('ant-ui:selected-feature');

          if (savedProject) {
            const projectId = JSON.parse(savedProject);
            
            // Verify project still exists
            const currentProjects = useStore.getState().projects;
            if (currentProjects.includes(projectId)) {
              console.log('[App] Restoring selected project:', projectId);
              useStore.getState().setSelectedProject(projectId);
              
              // Restore feature after a short delay (wait for features to load)
              if (savedFeature) {
                setTimeout(() => {
                  const featureName = JSON.parse(savedFeature);
                  const currentFeatures = useStore.getState().features;
                  
                  // Verify feature still exists
                  if (currentFeatures.some(f => f.name === featureName)) {
                    console.log('[App] Restoring selected feature:', featureName);
                    useStore.getState().setSelectedFeature(featureName);
                  } else {
                    console.log('[App] Saved feature no longer exists, clearing');
                    localStorage.removeItem('ant-ui:selected-feature');
                  }
                }, 500);
              }
            } else {
              console.log('[App] Saved project no longer exists, clearing');
              localStorage.removeItem('ant-ui:selected-project');
              localStorage.removeItem('ant-ui:selected-feature');
            }
          }
        } catch (error) {
          console.error('[App] Failed to restore selected project/feature:', error);
        }

        // Restore selected agent and work type from localStorage
        try {
          console.log('[App] Restoring agent and work type...');
          const savedAgent = localStorage.getItem('ant-ui:selected-agent');
          const savedWorkType = localStorage.getItem('ant-ui:selected-work-type');
          
          if (savedAgent) {
            const agent = JSON.parse(savedAgent);
            console.log('[App] Restoring selected agent:', agent);
            useStore.getState().setSelectedAgent(agent);
          }
          
          if (savedWorkType) {
            const workType = JSON.parse(savedWorkType);
            console.log('[App] Restoring selected work type:', workType);
            useStore.getState().setSelectedWorkType(workType);
          }
        } catch (error) {
          console.error('[App] Failed to restore agent/work type:', error);
        }

        // Restore running job from localStorage
        try {
          console.log('[App] Checking localStorage for running job...');
          const savedTaskId = localStorage.getItem('ant-ui:running-task');
          const savedStartTime = localStorage.getItem('ant-ui:task-start-time');
          const savedMode = localStorage.getItem('ant-ui:task-mode');
          
          console.log('[App] localStorage values:', { savedTaskId, savedStartTime, savedMode });

          if (savedTaskId && savedStartTime) {
            const jobId = JSON.parse(savedTaskId);
            const startTime = JSON.parse(savedStartTime);
            const mode = savedMode ? JSON.parse(savedMode) : 'generate';
            
            // ✅ CRITICAL: Check if user explicitly stopped this job
            const userStoppedJobId = useStore.getState().userStoppedJobId;
            if (userStoppedJobId === jobId) {
              console.log('[App] 🚫 Skipping restore - user explicitly stopped job:', jobId);
              // Clean up localStorage
              localStorage.removeItem('ant-ui:running-task');
              localStorage.removeItem('ant-ui:task-start-time');
              localStorage.removeItem('ant-ui:task-mode');
              return;
            }
            
            console.log('[App] ✅ Restoring running job:', { jobId, startTime, mode });
            
            // Calculate elapsed time
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            console.log('[App] Elapsed time:', elapsed, 'seconds');
            
            // Restore state
            console.log('[App] Calling setRunning(true, jobId, mode)...');
            setRunning(true, jobId, mode);
            useStore.setState({ 
              taskStartTime: startTime,
              elapsedTime: elapsed 
            });
            
            console.log('[App] Store state after restoration:', {
              isRunning: useStore.getState().isRunning,
              currentJobId: useStore.getState().currentJobId
            });
            
            // 🔥 CRITICAL: Restore Log SSE connection
            // Without this, UI won't receive real-time updates!
            console.log('[App] Reconnecting Log SSE for job:', jobId);
            startLogStream(jobId);
            
            // Note: Kanban/Workflow SSE will auto-reconnect via their useEffects
            // when selectedProject/selectedFeature are restored
          } else {
            console.log('[App] ℹ️ No running job to restore');
          }
        } catch (error) {
          console.error('[App] ❌ Failed to restore running job:', error);
        }
      } catch (error) {
        console.error('Failed to check health or load projects:', error);
        setProjects([]);
        setConnectionStatus('error');
      }
    }

    // Initial check
    checkConnectionAndLoadProjects();

    // Periodic health check every 5 seconds
    const healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = await checkHealth();
        const currentStatus = useStore.getState().connectionStatus;
        
        if (!isHealthy) {
          console.warn('[App] Health check failed during periodic check');
          setConnectionStatus('error');
          setProjects([]);
        } else if (currentStatus === 'error' || currentStatus === 'disconnected') {
          // Reconnected - reload projects
          console.log('[App] Reconnected! Reloading projects...');
          await fetchProjects();
          setConnectionStatus('connected');
        }
      } catch (error) {
        console.error('[App] Periodic health check error:', error);
        setConnectionStatus('error');
        setProjects([]);
      }
    }, 5000);

    return () => {
      clearInterval(healthCheckInterval);
    };
  }, [setConnectionStatus, fetchProjects, setProjects]);

  // Explorer resize handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingExplorer) return;

      const newWidth = e.clientX;
      
      // 최소 너비보다 작으면 접기
      if (newWidth < MIN_EXPLORER_WIDTH) {
        setIsExplorerCollapsed(true);
        setIsResizingExplorer(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        return;
      }

      // 최대 너비 제한
      const constrainedWidth = Math.min(newWidth, MAX_EXPLORER_WIDTH);
      setExplorerWidth(constrainedWidth);
    };

    const handleMouseUp = () => {
      setIsResizingExplorer(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizingExplorer) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingExplorer, MIN_EXPLORER_WIDTH, MAX_EXPLORER_WIDTH]);

  const handleRunTask = (agent: string, task: string) => {
    console.log('[App] handleRunTask called:', { agent, task, isRunning, selectedProject, selectedFeature });
    
    if (isRunning || !selectedProject) {
      console.warn('[App] Cannot run:', { isRunning, selectedProject });
      return;
    }

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
      });

      console.log('[App] jobExecution created:', jobExecution);
      setCurrentJob(jobExecution);

      // Update with actual jobId once server responds
      console.log('[App] Setting up onJobIdReady callback...');
      jobExecution.onJobIdReady((jobId) => {
        console.log('[App] Job ID ready:', jobId);
        setRunning(true, jobId, 'generate');
      });

      console.log('[App] Setting up exit handler...');
      jobExecution.on('exit', (code: number | null, _signal: string | null) => {
        console.log('[App] Job exit:', code);
        setRunning(false);
        setCurrentJob(null);
        
        // Reload session after job completion to get updated data
        if (selectedProject && selectedFeature) {
          console.log('[App] Job completed, reloading session...');
          fetchFeatureSession(selectedProject, selectedFeature)
            .then(session => {
              setSession(session ?? undefined);
              console.log('[App] Session reloaded after job completion');
            })
            .catch(error => {
              console.error('[App] Failed to reload session:', error);
            });
        }
        
        // Refresh file tree after job completion
        refreshFileTree();
        if (code !== 0) {
          console.error(`Job execution failed with code: ${code}`);
        }
      });
    } catch (error) {
      console.error('Failed to execute job:', error);
      setRunning(false);
      setCurrentJob(null);
    }
  };

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
    
    // ✅ CRITICAL: Mark this job as explicitly stopped by user
    // This prevents auto-restore from server SSE events
    if (currentJobId) {
      console.log(`[App] 🚫 Marking job ${currentJobId} as user-stopped (no auto-restore)`);
      useStore.setState({ userStoppedJobId: currentJobId });
    }
    
    // ✅ Send stop request to server and wait for confirmation
    try {
      // Method 1: If we have the currentJob object (direct execution)
      if (currentJob) {
        console.log('[App] Method 1: Stopping via currentJob.kill()');
        await currentJob.kill();
        console.log('[App] ✅ Server confirmed stop (Method 1)');
      }
      // Method 2: If we only have currentJobId (e.g., after page refresh)
      else if (currentJobId) {
        console.log('[App] Method 2: Stopping via API (currentJobId:', currentJobId, ')');
        // ✅ Pass projectId and featureName for proper cleanup
        await stopJob(currentJobId, selectedProject || undefined, selectedFeature || undefined);
        console.log('[App] ✅ Server confirmed stop (Method 2)');
      } else {
        console.warn('[App] ⚠️ No task to stop (no currentJob or currentJobId)');
        console.warn('[App] State:', { currentJob: !!currentJob, currentJobId, selectedProject, selectedFeature });
      }
      
      // ✅ Now update UI after server confirmation
      console.log('[App] 🎯 Server confirmed, updating UI...');
      setRunning(false);
      setCurrentJob(null);
      
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

  return (
    <div className="h-screen bg-[#f6f8fa] dark:bg-[#0d1117] flex flex-col transition-colors">
      <GlobalNavBar onRunTask={handleRunTask} onStopTask={handleStopTask} isRunning={isRunning} isStopping={isStopping} />
      
      {/* Main Layout - Always visible (with top padding for fixed header) */}
      <div className="flex-1 flex gap-0 overflow-hidden pt-16">
        {/* Left Column: Explorer (Collapsible, Resizable) */}
        {!isExplorerCollapsed && (
          <aside 
            className="bg-white dark:bg-[#161b22] border-r border-gray-200 dark:border-[#30363d] flex flex-col overflow-hidden transition-colors shrink-0 relative shadow-sm"
            style={{ width: `${explorerWidth}px` }}
          >
            {/* Explorer Bar - Extends Base Bar */}
            {Bar.render({
              left: (
                <>
                  <button
                    onClick={() => {
                      setIsExplorerCollapsed(true);
                    }}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex items-center justify-center w-10 h-10 -ml-4 -my-4"
                    title="Collapse Explorer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-gray-700 dark:text-gray-200 font-medium">📁 Explorer</span>
                </>
              ),
              right: selectedFile ? (
                  <button
                    onClick={() => setShowFileEditor(!showFileEditor)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      showFileEditor 
                        ? 'bg-blue-500 text-white hover:bg-blue-600' 
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                    title="Toggle Editor"
                  >
                    Editor
                  </button>
                ) : undefined
            })}
            
            <div className="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
              {connectionStatus === 'connected' ? (
                <>
                  <ProjectDropdown />
                  <FeatureDropdown />
                  <ArtifactsPanel />
                </>
              ) : (
                <div className="text-center text-gray-400 dark:text-gray-500 mt-8">
                  <div className="text-4xl mb-2">🔌</div>
                  <div className="text-sm">{connectionStatus === 'error' ? 'Disconnected' : 'Connecting...'}</div>
                </div>
              )}
            </div>

            {/* Resize Handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
              style={{
                backgroundColor: isResizingExplorer ? '#3b82f6' : 'transparent'
              }}
              onMouseDown={() => setIsResizingExplorer(true)}
            />
          </aside>
        )}
        
        {/* Collapsed Explorer Button */}
        {isExplorerCollapsed && (
          <div className="w-10 bg-white dark:bg-[#161b22] border-r border-gray-200 dark:border-[#30363d] flex flex-col items-center shrink-0 transition-colors shadow-sm">
            <button
              onClick={() => {
                setIsExplorerCollapsed(false);
                setExplorerWidth(320); // 권장 사이즈로 리셋
              }}
              className="h-10 w-10 flex items-center justify-center border-b border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title="Expand Explorer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Right Panel: Config and/or File Editor */}
        {(showConfigEditor || showFileEditor) && connectionStatus === 'connected' && (
          <div className="w-96 bg-white dark:bg-[#161b22] border-r border-gray-200 dark:border-[#30363d] flex flex-col overflow-hidden transition-colors shadow-sm">
              {/* Config Editor */}
              {showConfigEditor && configData && !isLoadingConfig && (
                <div className={showFileEditor ? 'h-1/2 border-b border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col' : 'flex-1 overflow-hidden flex flex-col'}>
                  <ConfigEditor
                    config={configData}
                    onSave={handleSaveConfig}
                    onClose={() => setShowConfigEditor(false)}
                  />
                </div>
              )}
              
              {showConfigEditor && isLoadingConfig && (
                <div className={showFileEditor ? 'h-1/2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-center' : 'flex-1 flex items-center justify-center'}>
                  <div className="text-gray-500 dark:text-gray-400">Loading configuration...</div>
                </div>
              )}

              {/* File Editor */}
              {showFileEditor && selectedFile && (
                <div className={showConfigEditor ? 'h-1/2 overflow-hidden' : 'flex-1 overflow-hidden'}>
                  <FileEditorPanel onClose={() => setShowFileEditor(false)} />
                </div>
              )}
            </div>
          )}

          {/* MainPanel: Central viewport for boards and visualizations */}
          <MainPanel
            headerBar={<MainPanelBar />}
            footer={<TerminalBar />}
          >
            {connectionStatus === 'connected' ? (
              // Always split layout view (vertical or horizontal)
              <SplitLayout
                direction={splitLayout}
                first={<KanbanBoard kanbanData={kanbanData} workflowState={workflowState} />}
                second={<AgentWorkflowBoard workflowState={workflowState} />}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="text-6xl mb-4">🔌</div>
                  <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
                    {connectionStatus === 'error' ? 'Connection Failed' : 'Connecting...'}
                  </h2>
                  <p className="text-gray-500 dark:text-gray-400">
                    {connectionStatus === 'error' 
                      ? 'Unable to connect to ANT server. Please make sure the server is running.' 
                      : 'Connecting to ANT server...'}
                  </p>
                  {connectionStatus === 'error' && (
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-4">
                      Run <code className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded">pnpm dev:cli</code> to start the server
                    </p>
                  )}
                </div>
              </div>
            )}
          </MainPanel>
        </div>
    </div>
  );
}

export default App;