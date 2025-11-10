import { useState, useRef, useEffect } from 'react';
import { Button } from '@/presentation/components/common/button';
import { Play, Square, Sun, Moon, Monitor, Cloud } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { useStore } from '@/domain/store';
import { fetchAgents, Agent } from '@/infrastructure/http/api';
import { capitalize } from '@/shared/utils/text-utils';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';

export interface GlobalNavBarProps {
  onRunTask: (agent: string, task: string) => void;  // 'task' here refers to agent's work type (code/design/etc), not to be confused with Task Board tasks
  onStopTask: () => void;
  isRunning: boolean;
  isStopping?: boolean;  // ✅ Stopping state
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
export function GlobalNavBar({ onRunTask, onStopTask, isRunning, isStopping = false }: GlobalNavBarProps) {
  const connectionStatus = useStore((state) => state.connectionStatus);
  const theme = useStore((state) => state.theme);
  const toggleTheme = useStore((state) => state.toggleTheme);
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedWorkType = useStore((state) => state.selectedWorkType);
  const setSelectedAgent = useStore((state) => state.setSelectedAgent);
  const setSelectedWorkType = useStore((state) => state.setSelectedWorkType);
  const policy = useUIActionPolicy();
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [workTypeDropdownOpen, setWorkTypeDropdownOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const agentRef = useRef<HTMLDivElement>(null);
  const workTypeRef = useRef<HTMLDivElement>(null);
  
  // Deployment mode state
  const [deploymentMode, _setDeploymentMode] = useState<'local' | 'cloud'>('local');
  const [showLocalTooltip, setShowLocalTooltip] = useState(false);
  const [showCloudTooltip, setShowCloudTooltip] = useState(false);

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

  // Close dropdowns and tooltips when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (agentRef.current && !agentRef.current.contains(event.target as Node)) {
        setAgentDropdownOpen(false);
      }
      if (workTypeRef.current && !workTypeRef.current.contains(event.target as Node)) {
        setWorkTypeDropdownOpen(false);
      }
      // Close tooltips when clicking anywhere
      const target = event.target as HTMLElement;
      if (!target.closest('.deployment-mode-selector')) {
        setShowLocalTooltip(false);
        setShowCloudTooltip(false);
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

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gray-50 dark:bg-[#0d1117] border-b border-gray-300 dark:border-[#30363d] shadow-md transition-colors">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* ANT Logo - Neural Network Pattern */}
            <img 
              src="/logo.svg" 
              alt="ANT Works Logo" 
              className="w-8 h-8" 
            />
            
            <h1 className="text-xl font-display font-bold text-gray-900 dark:text-white tracking-tight">ANT Works</h1>
            
            {/* Deployment Mode Selector */}
            <div className="deployment-mode-selector flex items-center gap-1 ml-4 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
              {/* Local Button */}
              <div className="relative">
                <button
                  onClick={() => {
                    // Already selected, toggle tooltip
                    setShowLocalTooltip(!showLocalTooltip);
                    setShowCloudTooltip(false);
                  }}
                  className={`
                    px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5
                    ${deploymentMode === 'local'
                      ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-md border border-blue-200 dark:border-transparent'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 opacity-60'
                    }
                  `}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Local
                </button>
                
                {/* Local Tooltip */}
                {showLocalTooltip && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 w-64">
                    <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs px-3 py-2 rounded-md shadow-lg">
                      <div className="font-semibold mb-1">Local Mode</div>
                      <div className="text-gray-300 dark:text-gray-400">
                        Work on your local machine. All results are stored locally.
                      </div>
                      {/* Arrow */}
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45"></div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Cloud Button */}
              <div className="relative">
                <button
                  onClick={() => {
                    // Show tooltip but don't change selection
                    setShowCloudTooltip(!showCloudTooltip);
                    setShowLocalTooltip(false);
                  }}
                  className={`
                    px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5
                    text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer opacity-60 hover:opacity-80
                  `}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  Cloud
                </button>
                
                {/* Cloud Tooltip */}
                {showCloudTooltip && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 w-64">
                    <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs px-3 py-2 rounded-md shadow-lg">
                      <div className="font-semibold mb-1">Cloud Mode</div>
                      <div className="text-gray-300 dark:text-gray-400 mb-1">
                        Work on remote machines. All results are stored remotely.
                      </div>
                      <div className="text-yellow-400 dark:text-yellow-300 font-medium">
                        ⚠️ Currently in development
                      </div>
                      {/* Arrow */}
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45"></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
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
            
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
            
            {/* Agent Selection - Compact Inline Design */}
            <div ref={agentRef} className="relative">
              <button
                onClick={() => policy.canChangeAgent && !isLoadingAgents && setAgentDropdownOpen(!agentDropdownOpen)}
                disabled={!policy.canChangeAgent || isLoadingAgents}
                title={!policy.canChangeAgent ? policy.disabledReason || undefined : undefined}
                className="h-10 px-3 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow flex items-center gap-2"
              >
                <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Agent:
                </span>
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {isLoadingAgents 
                    ? 'Loading...' 
                    : capitalize(agents.find(a => a.value === selectedAgent)?.label || 'No agents')}
                </span>
              </button>
              {agentDropdownOpen && !isLoadingAgents && agents.length > 0 && (
                <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg z-50 overflow-hidden">
                  {agents.map((agent) => (
                    <button
                      key={agent.value}
                      onClick={() => agent.enabled && handleAgentChange(agent.value)}
                      disabled={!agent.enabled}
                      className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                        !agent.enabled
                          ? 'bg-gray-50 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-60'
                          : selectedAgent === agent.value
                          ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold'
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

            {/* Job Type Selection - Compact Inline Design */}
            <div ref={workTypeRef} className="relative">
              <button
                onClick={() => policy.canChangeWorkType && setWorkTypeDropdownOpen(!workTypeDropdownOpen)}
                disabled={!policy.canChangeWorkType}
                title={!policy.canChangeWorkType ? policy.disabledReason || undefined : undefined}
                className="h-10 px-3 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow flex items-center gap-2"
              >
                <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Job:
                </span>
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {capitalize(workTypes.find(t => t.value === selectedWorkType)?.label || '')}
                </span>
              </button>
              {workTypeDropdownOpen && (
                <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg z-50 overflow-hidden">
                  {workTypes.map((workType) => (
                    <button
                      key={workType.value}
                      onClick={() => handleWorkTypeChange(workType.value)}
                      className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                        selectedWorkType === workType.value 
                          ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold' 
                          : 'text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {workType.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <Button
              onClick={handleRun}
              disabled={!policy.canRun}
              variant="primary"
              size="default"
              className={`flex items-center space-x-2 transition-all ${
                (isRunning && !isStopping)
                  ? 'bg-gradient-to-r from-emerald-500 via-emerald-600 to-emerald-500 bg-[length:200%_100%] animate-gradient text-white cursor-not-allowed shadow-lg' 
                  : ''
              }`}
            >
              {isRunning && !isStopping ? (
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
              disabled={!policy.canStop}
              variant="outline"
              size="default"
              className="flex items-center space-x-2"
            >
              <Square className="w-4 h-4" />
              <span>{isStopping ? 'Stopping...' : 'Stop'}</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

