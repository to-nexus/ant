import { useState, useEffect } from 'react';
import Header from './components/Header';
import { ProjectDropdown } from './components/ProjectDropdown';
import { FeatureDropdown } from './components/FeatureDropdown';
import { ArtifactsPanel } from './components/ArtifactsPanel';
import { TaskQueue } from './components/TaskQueue';
import { TerminalOutput } from './components/TerminalOutput';
import { FileEditorPanel } from './components/FileEditorPanel';
import { checkHealth } from './lib/api';
import { executeCodeTask, TaskExecution } from './lib/cli';
import { useStore } from './lib/store';

function App() {
  const [currentTask, setCurrentTask] = useState<TaskExecution | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(true);
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFile = useStore((state) => state.selectedFile);
  const isRunning = useStore((state) => state.isRunning);
  const setRunning = useStore((state) => state.setRunning);
  const setConnectionStatus = useStore((state) => state.setConnectionStatus);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const fetchProjects = useStore((state) => state.fetchProjects);
  const setProjects = useStore((state) => state.setProjects);

  // Auto-open editor when a file is selected
  useEffect(() => {
    if (selectedFile) {
      setIsEditorOpen(true);
    }
  }, [selectedFile]);

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
      } catch (error) {
        console.error('Failed to check health or load projects:', error);
        setProjects([]);
        setConnectionStatus('error');
      }
    }

    checkConnectionAndLoadProjects();
  }, [setConnectionStatus, fetchProjects, setProjects]);

  const handleRunTask = (agent: string, task: string) => {
    if (isRunning || !selectedProject) {
      return;
    }

    setRunning(true);

    try {
      const taskExecution = executeCodeTask({
        projectId: selectedProject,
        task: task as any,
        agent: agent as any,
        language: 'en',
      });

      setCurrentTask(taskExecution);

      taskExecution.on('exit', (code: number | null, _signal: string | null) => {
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
      
      {/* Flexible layout with fixed Explorer width */}
      <div className="flex-1 flex gap-0 pt-16" style={{ height: '100vh' }}>
        {/* Left Column: Explorer (Fixed width 320px) */}
        <aside className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
          <div className="sticky top-0 z-10 bg-white p-4 border-b border-gray-200 flex items-center justify-between h-14">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Explorer</h2>
            {selectedFile && (
              <button
                onClick={() => setIsEditorOpen(!isEditorOpen)}
                className={`text-xs px-3 py-1.5 rounded transition-colors font-medium ${
                  isEditorOpen 
                    ? 'bg-blue-500 text-white hover:bg-blue-600' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
                title={isEditorOpen ? 'Hide Editor' : 'Show Editor'}
              >
                Editor
              </button>
            )}
          </div>
          <div className="flex-1 p-4 space-y-4 overflow-y-auto">
            <ProjectDropdown />
            <FeatureDropdown />
            <ArtifactsPanel />
          </div>
        </aside>

        {/* File Editor (Fixed width 400px, next to Explorer) */}
        {selectedFile && isEditorOpen && (
          <FileEditorPanel onClose={() => setIsEditorOpen(false)} />
        )}

        {/* Main Column: Task Queue & Terminal (Flexible) */}
        <main className="flex-1 bg-gray-50 overflow-y-auto p-4 space-y-4">
          <TaskQueue />
          <TerminalOutput />
        </main>
      </div>
    </div>
  );
}

export default App;