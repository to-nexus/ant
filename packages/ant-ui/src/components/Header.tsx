import { useState } from 'react';
import { Button } from '@/ui/button';
import { Play, Square } from 'lucide-react';
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

  const handleAgentChange = (agent: string) => {
    setSelectedAgent(agent as any);
    // Reset task to first available task for this agent
    const firstTask = tasks[agent]?.[0]?.value;
    if (firstTask) {
      setSelectedTask(firstTask as any);
    }
  };

  const handleRun = () => {
    onRunTask(selectedAgent, selectedTask);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-semibold text-gray-900">ANT UI</h1>
          </div>
          
          <div className="flex items-center space-x-3">
            <ConnectionStatus status={connectionStatus} />
            
            {/* Agent Selection */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Agent</label>
              <select
                value={selectedAgent}
                onChange={(e) => handleAgentChange(e.target.value)}
                disabled={isRunning}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {agents.map((agent) => (
                  <option key={agent.value} value={agent.value}>
                    {agent.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Task Selection */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Task</label>
              <select
                value={selectedTask}
                onChange={(e) => setSelectedTask(e.target.value as any)}
                disabled={isRunning}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {tasks[selectedAgent]?.map((task) => (
                  <option key={task.value} value={task.value}>
                    {task.label}
                  </option>
                ))}
              </select>
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