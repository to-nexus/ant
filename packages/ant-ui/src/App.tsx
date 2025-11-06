import { useState, useEffect } from 'react';
import Header from './components/Header';
import { ProjectDropdown } from './components/ProjectDropdown';
import { FeatureDropdown } from './components/FeatureDropdown';
import { ArtifactsPanel } from './components/ArtifactsPanel';
import { KanbanBoard } from './components/KanbanBoard';
import { TerminalFooter } from './components/TerminalFooter';
import { FileEditorPanel } from './components/FileEditorPanel';
import { ConfigEditor } from './components/ConfigEditor';
import { InfoFooter } from './components/InfoFooter';
import { checkHealth, fetchProjectConfig, updateProjectConfig, ProjectConfig, fetchFeatureSession, stopTask } from './lib/api';
import { executeCodeTask } from './lib/cli';
import { useStore } from './lib/store';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function App() {
  const [configData, setConfigData] = useState<ProjectConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
  
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const isRunning = useStore((state) => state.isRunning);
  const taskId = useStore((state) => state.currentTaskId);
  const currentTask = useStore((state) => state.currentTask);
  const setCurrentTask = useStore((state) => state.setCurrentTask);
  const setRunning = useStore((state) => state.setRunning);
  const setConnectionStatus = useStore((state) => state.setConnectionStatus);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const fetchProjects = useStore((state) => state.fetchProjects);
  const setProjects = useStore((state) => state.setProjects);
  const showConfigEditor = useStore((state) => state.showConfigEditor);
  const showFileEditor = useStore((state) => state.showFileEditor);
  const setShowConfigEditor = useStore((state) => state.setShowConfigEditor);
  const setShowFileEditor = useStore((state) => state.setShowFileEditor);
  const setSession = useStore((state) => state.setSession);

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
        const session = await fetchFeatureSession(selectedProject, selectedFeature);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, selectedFeature, setSession]);

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
      await updateProjectConfig(selectedProject, config);
      // Don't close the config editor after saving
      // Reload config to sync with saved state
      const updatedConfig = await fetchProjectConfig(selectedProject);
      if (updatedConfig) {
        setConfigData(updatedConfig);
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

        // Restore running task from localStorage
        try {
          const savedTaskId = localStorage.getItem('ant-ui:running-task');
          const savedStartTime = localStorage.getItem('ant-ui:task-start-time');
          const savedMode = localStorage.getItem('ant-ui:task-mode');

          if (savedTaskId && savedStartTime) {
            const taskId = JSON.parse(savedTaskId);
            const startTime = JSON.parse(savedStartTime);
            const mode = savedMode ? JSON.parse(savedMode) : 'generate';
            
            console.log('[App] Restoring running task:', taskId);
            
            // Calculate elapsed time
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            
            // Restore state
            setRunning(true, taskId, mode);
            useStore.setState({ 
              taskStartTime: startTime,
              elapsedTime: elapsed 
            });
            
            // Note: We don't restore the EventSource/TaskExecution
            // User can stop the task manually if needed
          }
        } catch (error) {
          console.error('[App] Failed to restore running task:', error);
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

  const handleRunTask = (agent: string, task: string) => {
    if (isRunning || !selectedProject) {
      return;
    }

    // Start running state immediately (taskId will be set when server responds)
    setRunning(true, undefined, 'generate'); // Default mode

    try {
      const taskExecution = executeCodeTask({
        projectId: selectedProject,
        featureName: selectedFeature,  // Pass selected feature
        task: task as any,
        agent: agent as any,
        mode: 'generate', // This should be inferred or passed from UI
        language: 'en',
      });

      setCurrentTask(taskExecution);

      // Update with actual taskId once server responds
      if (taskExecution.onTaskIdReady) {
        taskExecution.onTaskIdReady((taskId) => {
          console.log('[App] Task ID ready:', taskId);
          setRunning(true, taskId, 'generate');
        });
      }

      taskExecution.on('exit', (code: number | null, _signal: string | null) => {
        console.log('[App] Task exit:', code);
        setRunning(false);
        setCurrentTask(null);
        
        // Reload session after task completion to get updated data
        if (selectedProject && selectedFeature) {
          console.log('[App] Task completed, reloading session...');
          fetchFeatureSession(selectedProject, selectedFeature)
            .then(session => {
              setSession(session ?? undefined);
              console.log('[App] Session reloaded after task completion');
            })
            .catch(error => {
              console.error('[App] Failed to reload session:', error);
            });
        }
        
        // Refresh file tree after task completion
        refreshFileTree();
        if (code !== 0) {
          console.error(`Task execution failed with code: ${code}`);
        }
      });
    } catch (error) {
      console.error('Failed to execute task:', error);
      setRunning(false);
      setCurrentTask(null);
    }
  };

  const handleStopTask = async () => {
    console.log('[App] Stopping task...', { hasCurrentTask: !!currentTask, taskId, selectedProject, selectedFeature });
    
    try {
      // Method 1: If we have the currentTask object (direct execution)
      if (currentTask) {
        console.log('[App] Stopping via currentTask.kill()');
        await currentTask.kill();
      }
      // Method 2: If we only have taskId (e.g., after page refresh)
      else if (taskId) {
        console.log('[App] Stopping via API (taskId:', taskId, ')');
        // ✅ Pass projectId and featureName for proper cleanup
        await stopTask(taskId, selectedProject || undefined, selectedFeature || undefined);
      } else {
        console.warn('[App] No task to stop (no currentTask or taskId)');
      }
    } catch (error) {
      console.error('[App] Failed to stop task:', error);
    } finally {
      // Always clean up state
      setRunning(false);
      setCurrentTask(null);
      
      // Reload session after stopping
      if (selectedProject && selectedFeature) {
        console.log('[App] Task stopped, reloading session...');
        try {
          const session = await fetchFeatureSession(selectedProject, selectedFeature);
          setSession(session ?? undefined);
          console.log('[App] Session reloaded after task stop');
        } catch (error) {
          console.error('[App] Failed to reload session:', error);
        }
      }
    }
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col transition-colors">
      <Header onRunTask={handleRunTask} onStopTask={handleStopTask} isRunning={isRunning} />
      
      {/* Main Layout - Always visible (with top padding for fixed header) */}
      <div className="flex-1 flex gap-0 overflow-hidden pt-16">
        {/* Left Column: Explorer (Collapsible) */}
        {!isExplorerCollapsed && (
          <aside className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden transition-colors">
            {/* Explorer Header (Footer-style) */}
            <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-2 shrink-0">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsExplorerCollapsed(true)}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors p-1"
                    title="Collapse Explorer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-gray-700 dark:text-gray-200 font-medium">📁 Explorer</span>
                </div>
                {selectedFile && (
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
                )}
              </div>
            </div>
            
            <div className="flex-1 p-4 space-y-4 overflow-y-auto">
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
          </aside>
        )}
        
        {/* Collapsed Explorer Button */}
        {isExplorerCollapsed && (
          <div className="w-12 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col shrink-0 transition-colors">
            {/* Match the header height of expanded explorer */}
            <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2 py-2 shrink-0 flex items-center justify-center">
              <button
                onClick={() => setIsExplorerCollapsed(false)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors p-1"
                title="Expand Explorer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Right Panel: Config and/or File Editor */}
        {(showConfigEditor || showFileEditor) && connectionStatus === 'connected' && (
          <div className="w-96 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden transition-colors">
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

          {/* Main Column: Task Board + Footers */}
          <main className="flex-1 bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden transition-colors">
            <div className="flex-1 overflow-y-auto p-4">
              {connectionStatus === 'connected' ? (
                <KanbanBoard />
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
            </div>
            {/* Terminal Footer - Expandable terminal output */}
            <TerminalFooter />
            {/* Info Footer - Task information */}
            <InfoFooter />
          </main>
        </div>
    </div>
  );
}

export default App;