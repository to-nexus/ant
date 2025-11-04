import { useState, useRef, useEffect } from 'react';
import { Button } from '@/ui/button';
import { Play, Square, ChevronDown } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { useStore } from '@/lib/store';

export interface HeaderProps {
  onRunTask: (agent: string, task: string) => void;
  onStopTask: () => void;
  isRunning: boolean;
}

export function Header({ onRunTask, onStopTask, isRunning }: HeaderProps) {
  const connectionStatus = useStore((state) => state.connectionStatus);
  const [selectedAgent, setSelectedAgent] = useState<'architect' | 'reviewer' | 'planner' | 'doc'>('architect');
  const [selectedTask, setSelectedTask] = useState<'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc'>('code');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [taskDropdownOpen, setTaskDropdownOpen] = useState(false);
  const agentRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<HTMLDivElement>(null);

  const agents = [
    { value: 'architect', label: 'Architect' },
    { value: 'reviewer', label: 'Reviewer' },
    { value: 'planner', label: 'Planner' },
    { value: 'doc', label: 'Doc' },
  ] as const;

  const tasks: Record<string, { value: string; label: string }[]> = {
    architect: [
      { value: 'design', label: 'Design' },
      { value: 'code', label: 'Code' },
      { value: 'learn', label: 'Learn' },
    ],
    reviewer: [
      { value: 'review', label: 'Review' },
    ],
    planner: [
      { value: 'plan', label: 'Plan' },
    ],
    doc: [
      { value: 'doc', label: 'Document' },
    ],
  };

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
    setSelectedAgent(agent as any);
    setAgentDropdownOpen(false);
    // Reset task to first available task for this agent
    const firstTask = tasks[agent]?.[0]?.value;
    if (firstTask) {
      setSelectedTask(firstTask as any);
    }
  };

  const handleTaskChange = (task: string) => {
    setSelectedTask(task as any);
    setTaskDropdownOpen(false);
  };

  const handleRun = () => {
    onRunTask(selectedAgent, selectedTask);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-semibold text-gray-900">ANT Workspace</h1>
          </div>
          
          <div className="flex items-center space-x-3">
            <ConnectionStatus status={connectionStatus} />
            
            {/* Agent Selection */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Agent</label>
              <div ref={agentRef} className="relative">
                <button
                  onClick={() => !isRunning && setAgentDropdownOpen(!agentDropdownOpen)}
                  disabled={isRunning}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-w-[100px]"
                >
                  <span className="flex-1 text-left">
                    {agents.find(a => a.value === selectedAgent)?.label}
                  </span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {agentDropdownOpen && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg z-50">
                    {agents.map((agent) => (
                      <button
                        key={agent.value}
                        onClick={() => handleAgentChange(agent.value)}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 first:rounded-t-md last:rounded-b-md ${
                          selectedAgent === agent.value ? 'bg-blue-50 text-blue-700 font-medium' : ''
                        }`}
                      >
                        {agent.label}
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
                  onClick={() => !isRunning && setTaskDropdownOpen(!taskDropdownOpen)}
                  disabled={isRunning}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-w-[100px]"
                >
                  <span className="flex-1 text-left">
                    {tasks[selectedAgent]?.find(t => t.value === selectedTask)?.label}
                  </span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {taskDropdownOpen && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg z-50">
                    {tasks[selectedAgent]?.map((task) => (
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
              disabled={isRunning}
              variant="default"
              size="default"
              className="flex items-center space-x-2"
            >
              <Play className="w-4 h-4" />
              <span>Run</span>
            </Button>
            
            <Button
              onClick={onStopTask}
              disabled={!isRunning}
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