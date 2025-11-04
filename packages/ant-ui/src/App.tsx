import { useState, useEffect } from 'react';
import Header from './components/Header';
import { ProjectDropdown } from './components/ProjectDropdown';
import { FeatureList } from './components/FeatureList';
import { TaskQueue } from './components/TaskQueue';
import { TerminalOutput } from './components/TerminalOutput';
import { FeatureDetails } from './components/FeatureDetails';
import { listProjects } from './lib/projects';
import { checkHealth } from './lib/api';
import { executeCodeTask, TaskExecution } from './lib/cli';
import { useStore } from './lib/store';

function App() {
  const [projects, setProjects] = useState<string[]>([]);
  const [currentTask, setCurrentTask] = useState<TaskExecution | null>(null);
  const selectedProject = useStore((state) => state.selectedProject);
  const isRunning = useStore((state) => state.isRunning);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const selectProject = useStore((state) => state.selectProject);
  const setRunning = useStore((state) => state.setRunning);
  const setConnectionStatus = useStore((state) => state.setConnectionStatus);

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
        const projectList = await listProjects();
        console.log('[App] Projects loaded:', projectList);
        setProjects(projectList);
        setConnectionStatus('connected');
      } catch (error) {
        console.error('Failed to check health or load projects:', error);
        setProjects([]);
        setConnectionStatus('error');
      }
    }

    checkConnectionAndLoadProjects();
  }, [setConnectionStatus]);

  const loadProjects = async () => {
    try {
      const projectList = await listProjects();
      setProjects(projectList);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const handleProjectSelect = (projectId: string) => {
    selectProject(projectId);
  };

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

  const handleStopTask = () => {
    if (currentTask) {
      currentTask.kill();
      setRunning(false);
      setCurrentTask(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header onRunTask={handleRunTask} onStopTask={handleStopTask} isRunning={isRunning} />
      
      {/* 3-column grid layout */}
      <div className="flex-1 grid grid-cols-12 gap-0 pt-16">
        {/* Left Column: Projects & Features */}
        <aside className="col-span-3 bg-white border-r border-gray-200 overflow-y-auto p-4 space-y-4">
          <ProjectDropdown
            projects={projects}
            selected={selectedProject}
            onSelect={handleProjectSelect}
            onProjectCreated={loadProjects}
          />
          <FeatureList />
        </aside>

        {/* Middle Column: Session & Task Queue & Terminal */}
        <main className="col-span-6 bg-gray-50 overflow-y-auto p-4 space-y-4">
          {connectionStatus !== 'connected' && connectionStatus !== 'disconnected' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <span className="text-yellow-600 font-medium">
                  {connectionStatus === 'error' ? '⚠️ Connection Error' : '🔄 Connecting...'}
                </span>
              </div>
            </div>
          )}
          
          <TaskQueue />
          <TerminalOutput />
        </main>

        {/* Right Column: Feature Details */}
        <aside className="col-span-3 bg-white border-l border-gray-200 overflow-y-auto p-4">
          <FeatureDetails />
        </aside>
      </div>
    </div>
  );
}

export default App;