import { useState, useEffect } from 'react';
import Header from './components/Header';
import { ProjectDropdown } from './components/ProjectDropdown';
import { FeatureDropdown } from './components/FeatureDropdown';
import { ArtifactsPanel } from './components/ArtifactsPanel';
import { TaskQueue } from './components/TaskQueue';
import { TerminalOutput } from './components/TerminalOutput';
import { FileEditorPanel } from './components/FileEditorPanel';
import { ConfigEditor } from './components/ConfigEditor';
import { Footer } from './components/Footer';
import { checkHealth, fetchProjectConfig, updateProjectConfig, ProjectConfig } from './lib/api';
import { executeCodeTask, TaskExecution } from './lib/cli';
import { useStore } from './lib/store';

function App() {
  const [currentTask, setCurrentTask] = useState<TaskExecution | null>(null);
  const [configData, setConfigData] = useState<ProjectConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFile = useStore((state) => state.selectedFile);
  const isRunning = useStore((state) => state.isRunning);
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

  // Auto-open file editor when a file is selected
  useEffect(() => {
    if (selectedFile) {
      setShowFileEditor(true);
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
    if (currentTask) {
      try {
        await currentTask.kill();
      } catch (error) {
        console.error('Failed to stop task:', error);
      } finally {
        setRunning(false);
        setCurrentTask(null);
      }
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      <Header onRunTask={handleRunTask} onStopTask={handleStopTask} isRunning={isRunning} />
      
      {/* Only show workspace when connected */}
      {connectionStatus === 'connected' ? (
        <div className="flex-1 flex gap-0 pt-16" style={{ height: '100vh' }}>
          {/* Left Column: Explorer (Fixed width 320px) */}
          <aside className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
            <div className="sticky top-0 z-10 bg-white p-4 border-b border-gray-200 flex items-center justify-between h-14">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Explorer</h2>
              <div className="flex items-center gap-2">
                {/* Editor button - always visible but disabled when no file selected */}
                <button
                  onClick={() => selectedFile && setShowFileEditor(!showFileEditor)}
                  disabled={!selectedFile}
                  className={`text-xs px-3 py-1.5 rounded transition-colors font-medium ${
                    !selectedFile
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : showFileEditor
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                  title={
                    !selectedFile
                      ? 'No file selected'
                      : showFileEditor
                      ? 'Hide Editor'
                      : 'Show Editor'
                  }
                >
                  Editor
                </button>
              </div>
            </div>
            <div className="flex-1 p-4 space-y-4 overflow-y-auto">
              <ProjectDropdown />
              <FeatureDropdown />
              <ArtifactsPanel />
            </div>
          </aside>

          {/* Right Panel: Config and/or File Editor */}
          {(showConfigEditor || showFileEditor) && (
            <div className="w-96 bg-white border-r border-gray-200 flex flex-col h-full">
              {/* Config Editor */}
              {showConfigEditor && configData && !isLoadingConfig && (
                <div className={showFileEditor ? 'h-1/2 border-b border-gray-200 overflow-hidden flex flex-col' : 'flex-1 overflow-hidden flex flex-col'}>
                  <ConfigEditor
                    config={configData}
                    onSave={handleSaveConfig}
                    onClose={() => setShowConfigEditor(false)}
                  />
                </div>
              )}
              
              {showConfigEditor && isLoadingConfig && (
                <div className={showFileEditor ? 'h-1/2 border-b border-gray-200 flex items-center justify-center' : 'flex-1 flex items-center justify-center'}>
                  <div className="text-gray-500">Loading configuration...</div>
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

          {/* Main Column: Task Queue & Terminal (Flexible) */}
          <main className="flex-1 bg-gray-50 flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <TaskQueue />
              <TerminalOutput />
            </div>
            <Footer />
          </main>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center pt-16">
          <div className="text-center">
            <div className="text-6xl mb-4">🔌</div>
            <h2 className="text-2xl font-semibold text-gray-700 mb-2">
              {connectionStatus === 'error' ? 'Connection Failed' : 'Connecting...'}
            </h2>
            <p className="text-gray-500">
              {connectionStatus === 'error' 
                ? 'Unable to connect to ANT server. Please make sure the server is running.' 
                : 'Connecting to ANT server...'}
            </p>
            {connectionStatus === 'error' && (
              <p className="text-sm text-gray-400 mt-4">
                Run <code className="bg-gray-200 px-2 py-1 rounded">pnpm dev:cli</code> to start the server
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;