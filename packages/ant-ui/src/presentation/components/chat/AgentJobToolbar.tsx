import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Send, ChevronDown, Square, Bot, Briefcase } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useChatPolicy } from '@/application/hooks/ui/useChatPolicy';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@/infrastructure/http/api';
import type { AgentWithMetadata, JobWithMetadata } from './hooks/useAgentJobOptions';
import { TurnTokenGauge } from './TurnTokenGauge';

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
 * Responsive breakpoint (pixels of toolbar container width) below which all
 * buttons collapse to icon-only. Derived from the minimum fit target:
 *
 *   padding(8) + agent(28) + gap(4) + job(28)
 *   + gap(8) [left↔right gutter]
 *   + ring(14) + gap(6) + more(22)
 *   + gap(8) [gauge↔send] + send/stop(28) + padding(8)
 *   = 162px (hard minimum)
 *
 * We start the compact transition at 360px so that text labels disappear
 * well before the layout would otherwise overflow.
 */
const COMPACT_BREAKPOINT_PX = 360;

/**
 * Minimum width enforced on the toolbar itself (agent icon + job icon + one
 * ring + more + send/stop, in icon-only form). Applied to both the
 * toolbar <div> and the chat-input Unified Frame that wraps it.
 *
 * Any narrower and the agent/job/gauge/send group cannot be drawn without
 * overlapping.
 */
export const CHAT_INPUT_MIN_WIDTH_PX = 190;

/**
 * Minimum width of the whole chat sidebar (`aside`) that guarantees every
 * footer button stays visible in icon-only mode. Larger than
 * `CHAT_INPUT_MIN_WIDTH_PX` because the sidebar adds outer chrome:
 *
 *   aside border-l (1) + ChatInput `p-3` (12 left + 12 right)
 *   + Unified Frame border (1 left + 1 right)                    = 27
 *   + toolbar minimum                                         + 190
 *   -----------------------------------------------------------------
 *                                                               = 217
 *
 * We round up to **220px** for a small breathing margin. `useLayoutState`
 * clamps `chatWidth` at this value and `useResizeHandlers` auto-collapses
 * anything narrower.
 */
export const CHAT_SIDEBAR_MIN_WIDTH_PX = 220;

/**
 * Default / "standard" chat sidebar width. Used as the initial value and as
 * the width restored when the user expands from the collapsed bar state.
 * If the user had previously dragged below this value before collapsing,
 * expanding resets back to standard so the footer isn't cramped.
 */
export const CHAT_SIDEBAR_STANDARD_WIDTH_PX = 500;

/**
 * Bottom toolbar: agent dropdown, job-type dropdown (with green active dot),
 * token gauge (one ring per active worker, overflow → more-dropdown),
 * and submit/stop button.
 *
 * Responsive behaviour: when the toolbar's own width drops below
 * `COMPACT_BREAKPOINT_PX`, every labeled button collapses to icon-only so
 * that the gauge and send/stop button still fit.
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

  // Compact mode: measured via ResizeObserver on the toolbar container.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const host = toolbarRef.current;
    if (!host) return;
    const apply = () => setCompact(host.clientWidth < COMPACT_BREAKPOINT_PX);
    apply();
    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        apply();
      });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

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
    if (isRunning) {
      setShowJobMenu(false);
      setShowAgentMenu(false);
    }
  }, [isRunning]);

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

  const agentLabel = currentAgent?.displayLabel || '🤖 Agent';
  const jobLabel =
    chatPolicy.reason === 'no-job' ? '🎯 Job' : currentJob?.label || '🎯 Job';

  return (
    <div
      ref={toolbarRef}
      style={{ minWidth: `${CHAT_INPUT_MIN_WIDTH_PX}px` }}
      className="flex items-center justify-between gap-2 px-2 py-1.5
                 border-t border-gray-200 dark:border-gray-700
                 bg-gray-50 dark:bg-gray-800/50"
    >
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Agent Selector */}
        <div className="relative" ref={agentMenuRef}>
          <button
            onClick={() => setShowAgentMenu(!showAgentMenu)}
            disabled={!chatPolicy.canChangeJob}
            className={`flex items-center gap-1 text-xs
                       bg-white dark:bg-gray-700
                       border border-gray-300 dark:border-gray-600
                       text-gray-700 dark:text-gray-200
                       rounded hover:bg-gray-100 dark:hover:bg-gray-600
                       transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       ${compact ? 'w-7 h-7 justify-center p-0' : 'px-2 py-1'}`}
            title={compact ? agentLabel : undefined}
            aria-label={compact ? agentLabel : undefined}
          >
            {compact ? (
              <Bot className="w-3.5 h-3.5" />
            ) : (
              <>
                <span className="truncate max-w-[120px]">{agentLabel}</span>
                <ChevronDown
                  className={`w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform ${
                    showAgentMenu ? 'rotate-180' : ''
                  }`}
                />
              </>
            )}
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
            className={`flex items-center gap-1 text-xs
                       bg-white dark:bg-gray-700
                       border border-gray-300 dark:border-gray-600
                       text-gray-700 dark:text-gray-200
                       rounded hover:bg-gray-100 dark:hover:bg-gray-600
                       transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       ${compact ? 'w-7 h-7 justify-center p-0' : 'px-2 py-1'}`}
            title={compact ? jobLabel : undefined}
            aria-label={compact ? jobLabel : undefined}
          >
            {compact ? (
              <Briefcase className="w-3.5 h-3.5" />
            ) : (
              <>
                <span className="truncate max-w-[120px]">{jobLabel}</span>
                <ChevronDown
                  className={`w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform ${
                    showJobMenu ? 'rotate-180' : ''
                  }`}
                />
              </>
            )}
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
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-status-pulse flex-shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">{job.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Middle: Token Gauge (fills remaining space) */}
      <TurnTokenGauge />

      {/* Right: Send / Stop */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {isRunning ? (
          <button
            onClick={handleStop}
            disabled={isStopping}
            className={`flex items-center gap-1 text-xs rounded
                       bg-red-500 hover:bg-red-600
                       text-white
                       border border-red-600 dark:border-red-500
                       transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       ${compact ? 'w-7 h-7 justify-center p-0' : 'px-2.5 py-1'}`}
            title={isStopping ? t('input.stopping') : t('input.stopJob')}
            aria-label={isStopping ? t('input.stopping') : t('input.stop')}
          >
            <Square className="w-3 h-3" fill="currentColor" />
            {!compact && <span>{isStopping ? t('input.stopping') : t('input.stop')}</span>}
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className={`flex items-center gap-1 text-xs rounded
                       bg-blue-500 hover:bg-blue-600
                       text-white
                       border border-blue-600 dark:border-blue-500
                       transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-200
                       disabled:dark:bg-gray-700 disabled:text-gray-400 disabled:dark:text-gray-500
                       disabled:border-gray-300 disabled:dark:border-gray-600
                       ${compact ? 'w-7 h-7 justify-center p-0' : 'px-2.5 py-1'}`}
            title={chatPolicy.canSendMessage ? t('input.sendMessage') : t('input.completeSelection')}
            aria-label={t('input.send')}
          >
            <Send className="w-3 h-3" />
            {!compact && <span>{t('input.send')}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
