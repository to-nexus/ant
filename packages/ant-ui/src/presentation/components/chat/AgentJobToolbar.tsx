import { useState, useRef, useEffect } from 'react';
import { Send, ChevronDown, Square } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useChatPolicy } from '@/application/hooks/ui/useChatPolicy';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@/infrastructure/http/api';
import type { AgentWithMetadata, JobWithMetadata } from './hooks/useAgentJobOptions';

interface AgentJobToolbarProps {
  agents: Agent[];
  agentsWithMetadata: AgentWithMetadata[];
  currentAgent: AgentWithMetadata | undefined;
  jobsWithMetadata: JobWithMetadata[];
  currentJob: JobWithMetadata | undefined;
  messageCount: number;
  canSubmit: boolean;
  onSubmit: () => void;
}

/**
 * Bottom toolbar: agent dropdown, job-type dropdown (with green active dot),
 * and submit/stop button.
 */
export function AgentJobToolbar({
  agents,
  agentsWithMetadata,
  currentAgent,
  jobsWithMetadata,
  currentJob,
  messageCount,
  canSubmit,
  onSubmit,
}: AgentJobToolbarProps) {
  const { t } = useTranslation('chat');
  const selectedJobType = useStore((state) => state.selectedJobType);
  const setSelectedJobType = useStore((state) => state.setSelectedJobType);
  const selectedAgent = useStore((state) => state.selectedAgent);
  const setSelectedAgent = useStore((state) => state.setSelectedAgent);
  const isRunning = useStore((state) => state.isRunning);
  const isStopping = useStore((state) => state.isStopping);
  const activeJobs = useStore((state) => state.activeJobs);

  const chatPolicy = useChatPolicy(messageCount);
  const { stopJob } = useJobExecution();

  const [showJobMenu, setShowJobMenu] = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowJobMenu(false);
      }
      if (agentMenuRef.current && !agentMenuRef.current.contains(event.target as Node)) {
        setShowAgentMenu(false);
      }
    };

    if (showJobMenu || showAgentMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showJobMenu, showAgentMenu]);

  useEffect(() => {
    if (isRunning && showJobMenu) setShowJobMenu(false);
    if (isRunning && showAgentMenu) setShowAgentMenu(false);
  }, [isRunning, showJobMenu, showAgentMenu]);

  const handleJobSelect = (jobValue: string) => {
    setSelectedJobType(jobValue as 'design' | 'code' | 'learn' | 'plan' | 'visual');
    setShowJobMenu(false);
  };

  const handleAgentSelect = (agentValue: string) => {
    setSelectedAgent(agentValue);
    setShowAgentMenu(false);
    const agentData = agents.find((a) => a.value === agentValue);
    const firstJobType = agentData?.jobs?.[0]?.value;
    if (firstJobType) {
      setSelectedJobType(firstJobType as 'design' | 'code' | 'learn' | 'plan' | 'visual');
    }
  };

  const handleStop = () => stopJob();

  return (
    <div className="flex items-center justify-between px-2 py-1.5 
                    border-t border-gray-200 dark:border-gray-700
                    bg-gray-50 dark:bg-gray-800/50">
      <div className="flex items-center gap-2">
        {/* Agent Selector */}
        <div className="relative" ref={agentMenuRef}>
          <button
            onClick={() => setShowAgentMenu(!showAgentMenu)}
            disabled={!chatPolicy.canChangeJob}
            className="flex items-center gap-1 px-2 py-1 text-xs
                       bg-white dark:bg-gray-700 
                       border border-gray-300 dark:border-gray-600
                       text-gray-700 dark:text-gray-200
                       rounded hover:bg-gray-100 dark:hover:bg-gray-600 
                       transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>{currentAgent?.displayLabel || '🤖 Agent'}</span>
            <ChevronDown className={`w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform ${showAgentMenu ? 'rotate-180' : ''}`} />
          </button>

          {showAgentMenu && agentsWithMetadata.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 w-56
                            bg-white dark:bg-gray-800 
                            border border-gray-300 dark:border-gray-600 
                            rounded-lg shadow-lg z-50 overflow-hidden">
              {agentsWithMetadata.map((agent) => (
                <button
                  key={agent.value}
                  onClick={() => agent.enabled && handleAgentSelect(agent.value)}
                  disabled={!agent.enabled}
                  className={`w-full px-2.5 py-1.5 text-left text-xs 
                             hover:bg-gray-100 dark:hover:bg-gray-700 
                             transition-colors flex flex-col gap-0.5
                             text-gray-900 dark:text-gray-100 ${
                    !agent.enabled
                      ? 'opacity-50 cursor-not-allowed'
                      : agent.value === selectedAgent 
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500 dark:border-blue-400' 
                      : ''
                  }`}
                >
                  <span className="font-medium">{agent.displayLabel}</span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">{agent.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Job Selector */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowJobMenu(!showJobMenu)}
            disabled={!chatPolicy.canChangeJob}
            className="flex items-center gap-1 px-2 py-1 text-xs
                       bg-white dark:bg-gray-700 
                       border border-gray-300 dark:border-gray-600
                       text-gray-700 dark:text-gray-200
                       rounded hover:bg-gray-100 dark:hover:bg-gray-600 
                       transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>
              {chatPolicy.reason === 'no-job' ? '🎯 Job' : (currentJob?.label || '🎯 Job')}
            </span>
            <ChevronDown className={`w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform ${showJobMenu ? 'rotate-180' : ''}`} />
          </button>

          {showJobMenu && jobsWithMetadata.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 w-48 
                            bg-white dark:bg-gray-800 
                            border border-gray-300 dark:border-gray-600 
                            rounded-lg shadow-lg z-50 overflow-hidden">
              {jobsWithMetadata.map((job) => (
                <button
                  key={job.value}
                  onClick={() => handleJobSelect(job.value)}
                  className={`w-full px-2.5 py-1.5 text-left text-xs 
                             hover:bg-gray-100 dark:hover:bg-gray-700 
                             transition-colors flex flex-col gap-0.5
                             text-gray-900 dark:text-gray-100 ${
                    job.value === selectedJobType 
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500 dark:border-blue-400' 
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{job.label}</span>
                    {activeJobs[job.value] && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">{job.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <button
            onClick={handleStop}
            disabled={isStopping}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded
                       bg-red-500 hover:bg-red-600 
                       text-white
                       border border-red-600 dark:border-red-500
                       transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('input.stopJob')}
          >
            <Square className="w-3 h-3" fill="currentColor" />
            <span>{isStopping ? t('input.stopping') : t('input.stop')}</span>
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded
                       bg-blue-500 hover:bg-blue-600 
                       text-white
                       border border-blue-600 dark:border-blue-500
                       transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-200 
                       disabled:dark:bg-gray-700 disabled:text-gray-400 disabled:dark:text-gray-500
                       disabled:border-gray-300 disabled:dark:border-gray-600"
            title={chatPolicy.canSendMessage ? t('input.sendMessage') : t('input.completeSelection')}
          >
            <Send className="w-3 h-3" />
            <span>{t('input.send')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
