import { useState, useRef, useEffect } from 'react';
import { Button } from '@/ui/button';
import { Play, Square } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { useStore } from '@/lib/store';
import { fetchAgents, Agent } from '@/lib/api';

export interface HeaderProps {
  onRunTask: (agent: string, task: string) => void;
  onStopTask: () => void;
  isRunning: boolean;
}

export function Header({ onRunTask, onStopTask, isRunning }: HeaderProps) {
  const connectionStatus = useStore((state) => state.connectionStatus);
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const isDisconnected = connectionStatus !== 'connected';
  const [selectedAgent, setSelectedAgent] = useState<string>('architect');
  const [selectedTask, setSelectedTask] = useState<string>('code');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [taskDropdownOpen, setTaskDropdownOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const agentRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<HTMLDivElement>(null);

  // Fetch agents from API when connected
  useEffect(() => {
    if (connectionStatus !== 'connected') {
      setIsLoadingAgents(false);
      return;
    }
    
    async function loadAgents() {
      setIsLoadingAgents(true);
      try {
        const agentsData = await fetchAgents();
        setAgents(agentsData);
      } catch (error) {
        console.error('[Header] Failed to load agents:', error);
        setAgents([]);
      } finally {
        setIsLoadingAgents(false);
      }
    }
    loadAgents();
  }, [connectionStatus]);

  const tasks = agents.find(a => a.value === selectedAgent)?.tasks || [];

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (agentRef.current && !agentRef.current.contains(event.target as Node)) {
        setAgentDropdownOpen(false);
      }
      if (taskRef.current && !taskRef.current.contains(event.target as Node)) {
        setTaskDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAgentChange = (agent: string) => {
    setSelectedAgent(agent);
    setAgentDropdownOpen(false);
    // Reset task to first available task for this agent
    const agentData = agents.find(a => a.value === agent);
    const firstTask = agentData?.tasks?.[0]?.value;
    if (firstTask) {
      setSelectedTask(firstTask);
    }
  };

  const handleTaskChange = (task: string) => {
    setSelectedTask(task);
    setTaskDropdownOpen(false);
  };

  const handleRun = () => {
    onRunTask(selectedAgent, selectedTask);
  };

  // Validation: Project and feature must be selected
  const hasValidSelection = Boolean(selectedProject && selectedFeature);

  // Run button disabled when:
  // - Task is already running
  // - Server disconnected
  // - Project/feature not selected
  const isRunDisabled = isRunning || isDisconnected || !hasValidSelection;

  // Stop button disabled when:
  // - No task is running
  // - Server disconnected
  // - Project/feature not selected (for safety)
  const isStopDisabled = !isRunning || isDisconnected || !hasValidSelection;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-semibold text-gray-900">ANT Workspace</h1>
          </div>
          
          <div className="flex items-center space-x-3">
            <ConnectionStatus status={connectionStatus} />
            
            <div className="w-px h-6 bg-gray-300"></div>
            
            {/* Agent Selection */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Agent</label>
              <div ref={agentRef} className="relative">
                <button
                  onClick={() => !isRunning && !isDisconnected && !isLoadingAgents && setAgentDropdownOpen(!agentDropdownOpen)}
                  disabled={isRunning || isDisconnected || isLoadingAgents}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow min-w-[100px]"
                >
                  {isLoadingAgents 
                    ? 'Loading...' 
                    : agents.find(a => a.value === selectedAgent)?.label || 'No agents'}
                </button>
                {agentDropdownOpen && !isLoadingAgents && agents.length > 0 && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg z-50">
                    {agents.map((agent) => (
                      <button
                        key={agent.value}
                        onClick={() => agent.enabled && handleAgentChange(agent.value)}
                        disabled={!agent.enabled}
                        className={`w-full px-3 py-2 text-left text-sm first:rounded-t-md last:rounded-b-md ${
                          !agent.enabled
                            ? 'bg-gray-50 text-gray-400 cursor-not-allowed opacity-60'
                            : selectedAgent === agent.value
                            ? 'bg-blue-50 text-blue-700 font-medium'
                            : 'hover:bg-gray-100'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{agent.label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Task Selection */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Task</label>
              <div ref={taskRef} className="relative">
                <button
                  onClick={() => !isRunning && !isDisconnected && setTaskDropdownOpen(!taskDropdownOpen)}
                  disabled={isRunning || isDisconnected}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow min-w-[100px]"
                >
                  {tasks.find(t => t.value === selectedTask)?.label}
                </button>
                {taskDropdownOpen && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg z-50">
                    {tasks.map((task) => (
                      <button
                        key={task.value}
                        onClick={() => handleTaskChange(task.value)}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 first:rounded-t-md last:rounded-b-md ${
                          selectedTask === task.value ? 'bg-blue-50 text-blue-700 font-medium' : ''
                        }`}
                      >
                        {task.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            <Button
              onClick={handleRun}
              disabled={isRunDisabled}
              variant={isRunning ? "secondary" : "default"}
              size="default"
              className={`flex items-center space-x-2 transition-all ${
                isRunning 
                  ? 'bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500 bg-[length:200%_100%] animate-gradient text-white cursor-not-allowed' 
                  : ''
              }`}
            >
              {isRunning ? (
                <>
                  <div className="relative flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-white"></span>
                  </div>
                  <span className="font-semibold">Running...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Run</span>
                </>
              )}
            </Button>
            
            <Button
              onClick={onStopTask}
              disabled={isStopDisabled}
              variant="outline"
              size="default"
              className="flex items-center space-x-2"
            >
              <Square className="w-4 h-4" />
              <span>Stop</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;