import { useState, useRef, useEffect } from 'react';
import { Button } from '@/ui/button';
import { Play, Square, Sun, Moon } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { useStore } from '@/lib/store';
import { fetchAgents, Agent } from '@/lib/api';
import { capitalize } from '@/lib/text-utils';

export interface GlobalNavBarProps {
  onRunTask: (agent: string, task: string) => void;  // 'task' here refers to agent's work type (code/design/etc), not to be confused with Task Board tasks
  onStopTask: () => void;
  isRunning: boolean;
}

/**
 * GlobalNavBar - Top-level navigation bar
 * 
 * Contains:
 * - App branding
 * - Theme toggle
 * - Connection status
 * - Agent selection and work type selection (code/design/etc)
 * - Run/Stop buttons for agent jobs
 */
export function GlobalNavBar({ onRunTask, onStopTask, isRunning }: GlobalNavBarProps) {
  const connectionStatus = useStore((state) => state.connectionStatus);
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const theme = useStore((state) => state.theme);
  const toggleTheme = useStore((state) => state.toggleTheme);
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedWorkType = useStore((state) => state.selectedWorkType);
  const setSelectedAgent = useStore((state) => state.setSelectedAgent);
  const setSelectedWorkType = useStore((state) => state.setSelectedWorkType);
  const isDisconnected = connectionStatus !== 'connected';
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [workTypeDropdownOpen, setWorkTypeDropdownOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const agentRef = useRef<HTMLDivElement>(null);
  const workTypeRef = useRef<HTMLDivElement>(null);

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
        console.error('[GlobalNavBar] Failed to load agents:', error);
        setAgents([]);
      } finally {
        setIsLoadingAgents(false);
      }
    }
    loadAgents();
  }, [connectionStatus]);

  const workTypes = agents.find(a => a.value === selectedAgent)?.tasks || [];

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (agentRef.current && !agentRef.current.contains(event.target as Node)) {
        setAgentDropdownOpen(false);
      }
      if (workTypeRef.current && !workTypeRef.current.contains(event.target as Node)) {
        setWorkTypeDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAgentChange = (agent: string) => {
    setSelectedAgent(agent);
    setAgentDropdownOpen(false);
    // Reset work type to first available for this agent
    const agentData = agents.find(a => a.value === agent);
    const firstWorkType = agentData?.tasks?.[0]?.value;
    if (firstWorkType) {
      setSelectedWorkType(firstWorkType);
    }
  };

  const handleWorkTypeChange = (workType: string) => {
    setSelectedWorkType(workType);
    setWorkTypeDropdownOpen(false);
  };

  const handleRun = () => {
    onRunTask(selectedAgent, selectedWorkType);
  };

  // Validation: Project and feature must be selected
  const hasValidSelection = Boolean(selectedProject && selectedFeature);

  // Run button disabled when:
  // - Agent job is already running
  // - Server disconnected
  // - Project/feature not selected
  const isRunDisabled = isRunning || isDisconnected || !hasValidSelection;

  // Stop button disabled when:
  // - No agent job is running
  // - Server disconnected
  // - Project/feature not selected (for safety)
  const isStopDisabled = !isRunning || isDisconnected || !hasValidSelection;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gray-50 dark:bg-[#0d1117] border-b border-gray-300 dark:border-[#30363d] shadow-md transition-colors">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Logo Icon */}
            <div className="relative">
              {/* Light Mode: Dark Ant with Circuit */}
              <svg 
                className="w-7 h-7 block dark:hidden" 
                viewBox="0 0 24 24" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Ant Body */}
                <ellipse cx="12" cy="14" rx="3" ry="4" fill="#1f2937" />
                <circle cx="12" cy="8" r="2.5" fill="#1f2937" />
                <circle cx="12" cy="18" r="1.5" fill="#1f2937" />
                
                {/* Antennae */}
                <path d="M10.5 6.5 L9 4 M13.5 6.5 L15 4" stroke="#1f2937" strokeWidth="1" strokeLinecap="round" />
                
                {/* Legs */}
                <path d="M9 12 L6 14 M9 14 L6 16 M9 16 L7 18" stroke="#1f2937" strokeWidth="1" strokeLinecap="round" />
                <path d="M15 12 L18 14 M15 14 L18 16 M15 16 L17 18" stroke="#1f2937" strokeWidth="1" strokeLinecap="round" />
                
                {/* Circuit Pattern */}
                <circle cx="12" cy="14" r="1" fill="#3b82f6" opacity="0.6" />
                <path d="M12 13 L12 11 L14 11" stroke="#3b82f6" strokeWidth="0.5" opacity="0.6" />
                <circle cx="14" cy="11" r="0.5" fill="#3b82f6" opacity="0.6" />
              </svg>
              
              {/* Dark Mode: Light Ant with Circuit */}
              <svg 
                className="w-7 h-7 hidden dark:block" 
                viewBox="0 0 24 24" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Ant Body */}
                <ellipse cx="12" cy="14" rx="3" ry="4" fill="#f9fafb" />
                <circle cx="12" cy="8" r="2.5" fill="#f9fafb" />
                <circle cx="12" cy="18" r="1.5" fill="#f9fafb" />
                
                {/* Antennae */}
                <path d="M10.5 6.5 L9 4 M13.5 6.5 L15 4" stroke="#f9fafb" strokeWidth="1" strokeLinecap="round" />
                
                {/* Legs */}
                <path d="M9 12 L6 14 M9 14 L6 16 M9 16 L7 18" stroke="#f9fafb" strokeWidth="1" strokeLinecap="round" />
                <path d="M15 12 L18 14 M15 14 L18 16 M15 16 L17 18" stroke="#f9fafb" strokeWidth="1" strokeLinecap="round" />
                
                {/* Circuit Pattern */}
                <circle cx="12" cy="14" r="1" fill="#60a5fa" opacity="0.8" />
                <path d="M12 13 L12 11 L14 11" stroke="#60a5fa" strokeWidth="0.5" opacity="0.8" />
                <circle cx="14" cy="11" r="0.5" fill="#60a5fa" opacity="0.8" />
              </svg>
            </div>
            
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">ANT Works</h1>
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Theme Toggle Switch */}
            <button
              onClick={toggleTheme}
              className="relative inline-flex items-center h-8 rounded-full w-16 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 bg-gray-300 dark:bg-gray-600"
              aria-label="Toggle theme"
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {/* Switch Track */}
              <span className="sr-only">Toggle theme</span>
              {/* Switch Thumb */}
              <span
                className={`${
                  theme === 'dark' ? 'translate-x-8' : 'translate-x-1'
                } inline-flex items-center justify-center h-7 w-7 transform rounded-full bg-white dark:bg-gray-800 shadow-lg transition-transform duration-200 ease-in-out`}
              >
                {theme === 'light' ? (
                  <Sun className="w-4 h-4 text-gray-900" />
                ) : (
                  <Moon className="w-4 h-4 text-blue-400" />
                )}
              </span>
            </button>
            
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
            
            <ConnectionStatus status={connectionStatus} />
            
            <div className="w-px h-6 bg-gray-300"></div>
            
            {/* Agent Selection */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Agent</label>
              <div ref={agentRef} className="relative">
                <button
                  onClick={() => !isRunning && !isDisconnected && !isLoadingAgents && setAgentDropdownOpen(!agentDropdownOpen)}
                  disabled={isRunning || isDisconnected || isLoadingAgents}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 dark:active:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow min-w-[100px]"
                >
                  {isLoadingAgents 
                    ? 'Loading...' 
                    : capitalize(agents.find(a => a.value === selectedAgent)?.label || 'No agents')}
                </button>
                {agentDropdownOpen && !isLoadingAgents && agents.length > 0 && (
                  <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg z-50">
                    {agents.map((agent) => (
                      <button
                        key={agent.value}
                        onClick={() => agent.enabled && handleAgentChange(agent.value)}
                        disabled={!agent.enabled}
                        className={`w-full px-3 py-2 text-left text-sm first:rounded-t-md last:rounded-b-md ${
                          !agent.enabled
                            ? 'bg-gray-50 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-60'
                            : selectedAgent === agent.value
                            ? 'bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 font-medium'
                            : 'text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
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

            {/* Job Type (Work Type) Selection */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 dark:text-gray-300">Job</label>
              <div ref={workTypeRef} className="relative">
                <button
                  onClick={() => !isRunning && !isDisconnected && setWorkTypeDropdownOpen(!workTypeDropdownOpen)}
                  disabled={isRunning || isDisconnected}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 dark:active:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow min-w-[100px]"
                >
                  {capitalize(workTypes.find(t => t.value === selectedWorkType)?.label || '')}
                </button>
                {workTypeDropdownOpen && (
                  <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg z-50">
                    {workTypes.map((workType) => (
                      <button
                        key={workType.value}
                        onClick={() => handleWorkTypeChange(workType.value)}
                        className={`w-full px-3 py-2 text-left text-sm first:rounded-t-md last:rounded-b-md ${
                          selectedWorkType === workType.value 
                            ? 'bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200 font-medium' 
                            : 'text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {workType.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            <Button
              onClick={handleRun}
              disabled={isRunDisabled}
              variant="primary"
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

