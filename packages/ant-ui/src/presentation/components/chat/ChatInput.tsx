/**
 * ChatInput - Message input area with job selector
 */

import { useState, useRef, useEffect } from 'react';
import { Send, ChevronDown, ChevronRight, Square } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useChatPolicy } from '@/application/hooks/ui/useChatPolicy';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { fetchAgents, type Agent, getApiBase, authFetch } from '@/infrastructure/http/api';
import type { FileStats } from '@/domain/models/chat';

const API_BASE = () => getApiBase();

interface ChatInputProps {
  disabled?: boolean;
  messageCount?: number;  // ✅ 메시지 개수 (첫 채팅 구분)
  fileStats?: FileStats;   // ✅ 파일 통계 (Cursor-style)
}

export function ChatInput({ disabled, messageCount = 0, fileStats }: ChatInputProps) {
  const selectedJobType = useStore((state) => state.selectedJobType);
  const setSelectedJobType = useStore((state) => state.setSelectedJobType);
  const selectedAgent = useStore((state) => state.selectedAgent);  // ✅ Reactive selectedAgent
  const setSelectedAgent = useStore((state) => state.setSelectedAgent);  // ✅ Add setter for agent
  const isRunning = useStore((state) => state.isRunning);
  const isStopping = useStore((state) => state.isStopping);  // ✅ Use global state
  const backendMode = useStore((state) => state.backendMode);
  const userEmail = useStore((state) => state.userEmail);
  const [showJobMenu, setShowJobMenu] = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);  // ✅ Agent menu state
  const [message, setMessage] = useState('');
  // ✅ Track IME composition state to prevent premature submission
  const [isComposing, setIsComposing] = useState(false);
  // ✅ Initialize agents with default to prevent empty state
  const [agents, setAgents] = useState<Agent[]>([
    { value: 'architect', label: 'Architect', enabled: true, tasks: [
      { value: 'code', label: 'Code' },
      { value: 'design', label: 'Design' },
      { value: 'learn', label: 'Learn' }
    ]}
  ]);
  const [showFileList, setShowFileList] = useState(false);  // ✅ Cursor-style file list toggle
  const menuRef = useRef<HTMLDivElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);  // ✅ Agent menu ref
  
  // ✅ Check authentication status
  const isAuthenticated = backendMode === 'local' || !!userEmail;
  
  // ✅ Use Chat Policy for UI states (메시지 개수 전달)
  const chatPolicy = useChatPolicy(messageCount);
  
  // ✅ Get stop handler from useJobExecution hook
  const { stopJob } = useJobExecution();

  // ✅ Fetch agents to get available jobs for selected agent
  useEffect(() => {
    async function loadAgents() {
      try {
        const agentsData = await fetchAgents();
        setAgents(agentsData);
      } catch (error) {
        console.error('[ChatInput] Failed to load agents:', error);
        // ✅ Provide default agents when API fails
        setAgents([
          { value: 'architect', label: 'Architect', enabled: true, tasks: [
            { value: 'code', label: 'Code' },
            { value: 'design', label: 'Design' },
            { value: 'learn', label: 'Learn' }
          ]}
        ]);
      }
    }
    loadAgents();
  }, []);

  // ✅ Add emoji and description for each agent
  const agentsWithMetadata = agents.map((agent: Agent) => {
    const metadata: Record<string, { emoji: string; description: string }> = {
      architect: { emoji: '🤖', description: 'Optimized for coding tasks' },
      planner: { emoji: '📋', description: 'Creates project plans & roadmaps' },
      reviewer: { emoji: '🔍', description: 'Reviews code & provides feedback' },
      doc: { emoji: '📝', description: 'Generates documentation' }
    };
    const meta = metadata[agent.value] || { emoji: '🤖', description: agent.label };
    return {
      ...agent,
      displayLabel: `${meta.emoji} ${agent.label}`,
      description: meta.description
    };
  });

  const currentAgent = agentsWithMetadata.find((a) => a.value === selectedAgent) || agentsWithMetadata[0];

  // ✅ Get jobs for currently selected agent (dynamically from API, reactive)
  const jobs = agents.find((a: Agent) => a.value === selectedAgent)?.tasks || [];
  
  // ✅ Add emoji and description for each job
  const jobsWithMetadata = jobs.map((job: { value: string; label: string }) => {
    const metadata: Record<string, { emoji: string; description: string }> = {
      design: { emoji: '🎨', description: 'Create architecture & design' },
      code: { emoji: '💻', description: 'Implement features' },
      learn: { emoji: '📚', description: 'Analyze & document' }
    };
    const meta = metadata[job.value] || { emoji: '🎯', description: job.label };
    return {
      value: job.value,
      label: `${meta.emoji} ${job.label}`,
      description: meta.description
    };
  });

  const currentJob = jobsWithMetadata.find((j: { value: string; label: string; description: string }) => j.value === selectedJobType) || jobsWithMetadata[0];

  // Close menu when clicking outside
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

  // Close menu when job starts running
  useEffect(() => {
    if (isRunning && showJobMenu) {
      setShowJobMenu(false);
    }
    if (isRunning && showAgentMenu) {
      setShowAgentMenu(false);
    }
  }, [isRunning, showJobMenu, showAgentMenu]);

  const handleJobSelect = (jobValue: string) => {
    setSelectedJobType(jobValue as 'design' | 'code' | 'learn');
    setShowJobMenu(false);
  };

  const handleAgentSelect = (agentValue: string) => {
    setSelectedAgent(agentValue);
    setShowAgentMenu(false);
    // Reset work type to first available for this agent
    const agentData = agents.find((a: Agent) => a.value === agentValue);
    const firstWorkType = agentData?.tasks?.[0]?.value;
    if (firstWorkType) {
      setSelectedJobType(firstWorkType as 'design' | 'code' | 'learn');
    }
  };

  const handleStop = () => {
    stopJob();
  };

  // ✅ Submit message handler - handles both Continue and New Job
  const handleSubmit = async () => {
    if (!message.trim() || !chatPolicy.canSendMessage) return;
    
    const selectedProject = useStore.getState().selectedProject;
    const selectedFeature = useStore.getState().selectedFeature;
    const selectedAgent = useStore.getState().selectedAgent;
    const kanbanData = useStore.getState().kanban;
    
    if (!selectedProject || !selectedFeature || !selectedAgent || !selectedJobType) {
      console.error('[ChatInput] Missing required selection for job execution');
      return;
    }
    
    // Clear message immediately for better UX
    const userMessage = message;
    setMessage('');
    
    // ✅ Check if there's an interrupted job (not completed)
    const currentJobId = kanbanData?.jobId;
    const hasInterruption = kanbanData?.interruption && !kanbanData?.interruption?.message?.includes('completed');
    
    // ✅ CASE 1: Continue existing interrupted job with new directive
    if (currentJobId && hasInterruption) {
      try {
        // ✅ 1. Add user message to chat history
        await authFetch(
          `${API_BASE()}/projects/${selectedProject}/features/${selectedFeature}/chat/user-message`,
          {
            method: 'POST',
            body: JSON.stringify({ content: userMessage })
          }
        );
        
        // ✅ 2. Dismiss interruption UI before continuing
        if (kanbanData?.interruption?.timestamp) {
          useStore.getState().setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
        }
        
        // ✅ 3. Set running state immediately
        useStore.getState().setRunning(true, currentJobId);
        
        // ✅ 4. Call Continue API (adds directive with highest priority)
        const { continueJob } = await import('@/infrastructure/http/api');
        const result = await continueJob(currentJobId, selectedProject, selectedFeature, userMessage, true);
        
        // ✅ 5. Update with same jobId from server (Continue uses same jobId)
        useStore.getState().setRunning(true, result.jobId);
        
        // ✅ 6. Clear failed state
        useStore.getState().setLastJobFailed(false);
        
      } catch (error) {
        console.error('[ChatInput] Failed to continue job:', error);
        useStore.getState().setRunning(false);
        alert(`Failed to continue job: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      return;
    }
    
    // ✅ CASE 2: Normal path - Start new job
    try {
      // ✅ 1. Add user message to chat history first
      const userMessageResponse = await authFetch(
        `${API_BASE()}/projects/${selectedProject}/features/${selectedFeature}/chat/user-message`,
        {
          method: 'POST',
          body: JSON.stringify({ content: userMessage })
        }
      );
      
      if (!userMessageResponse.ok) {
        throw new Error('Failed to add user message to chat');
      }
      
      try {
        // Start assistant message placeholder (without real jobId yet)
        const startResponse = await authFetch(
          `${API_BASE()}/projects/${selectedProject}/features/${selectedFeature}/chat/start-message`,
          {
            method: 'POST',
            body: JSON.stringify({})  // ✅ No jobId - will get pending jobId from server
          }
        );
        
        if (startResponse.ok) {
          const { pendingJobId: _pendingJobId } = await startResponse.json();
          // pendingJobId is available but not currently used
          console.log('[ChatInput] Started message with pendingJobId:', _pendingJobId);
        }
      } catch (error) {
        console.error('[ChatInput] Failed to start assistant message:', error);
        if (error instanceof Error) {
          console.error('  Error message:', error.message);
        }
      }
      
      // ✅ 3. Execute job with chat input as override directive
      const { executeCodeJob } = await import('@/infrastructure/http/cli');
      
      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        jobType: selectedJobType as 'design' | 'code' | 'learn',
        agent: selectedAgent as 'architect',
        overrideDirective: userMessage,  // ✅ Chat input becomes directive
        chatSource: true                  // ✅ Enable Chat SSE
      });
      
      // ✅ Store job execution object IMMEDIATELY for stop functionality
      // (jobId will be set later when API responds)
      useStore.getState().setCurrentJob(jobExecution);
      
      // ✅ 4. Set up job tracking
      jobExecution.onJobIdReady(async (jobId) => {
        useStore.getState().setRunning(true, jobId);
      });
      
      // ✅ 4. Handle job completion and errors
      jobExecution.on('exit', async (code, signal) => {
        const jobFailed = code !== 0 && code !== null;
        
        // ✅ Update failed state FIRST, then running state
        // This ensures lastJobFailed is set before isRunning is cleared
        useStore.getState().setLastJobFailed(jobFailed);
        useStore.getState().setRunning(false);
        
        // ✅ If job failed, add error message to chat
        if (jobFailed) {
          try {
            const jobId = useStore.getState().currentJobId;
            if (jobId) {
              await fetch(
                `${API_BASE()}/projects/${selectedProject}/features/${selectedFeature}/chat/job-error`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jobId,
                    errorMessage: signal 
                      ? `Job was terminated with signal: ${signal}` 
                      : `Job failed with exit code: ${code}`,
                    errorDetails: { code, signal }
                  })
                }
              );
            }
          } catch (error) {
            console.error('[ChatInput] Failed to add error message:', error);
          }
        }
      });
      
    } catch (error) {
      console.error('[ChatInput] Failed to start job:', error);
      // Restore message on error
      setMessage(userMessage);
    }
  };

  // Calculate file stats summary for display
  const hasFileChanges = fileStats && (fileStats.filesEdited > 0 || fileStats.filesCreated > 0 || fileStats.filesDeleted > 0);
  // ✅ totalFiles is unique-by-path (deduped). Fall back to sum if not present.
  const totalChangedFiles = (fileStats?.totalFiles ?? ((fileStats?.filesCreated || 0) + (fileStats?.filesEdited || 0) + (fileStats?.filesDeleted || 0)));

  // ✅ Show placeholder if not authenticated in cloud mode
  if (!isAuthenticated) {
    return (
      <div className="p-3 relative">
        <div className="bg-white dark:bg-gray-800 
                        border border-gray-200 dark:border-gray-700 
                        rounded-lg shadow-sm overflow-hidden">
          <textarea
            className="w-full px-3 py-2.5 
                       bg-gray-50 dark:bg-gray-900/50
                       text-gray-400 dark:text-gray-500
                       text-sm leading-relaxed 
                       focus:outline-none
                       resize-none border-none
                       cursor-not-allowed"
            placeholder="Please sign in to start chatting..."
            rows={3}
            disabled
            readOnly
          />
          
          <div className="flex items-center justify-between px-2 py-1.5 
                          border-t border-gray-200 dark:border-gray-700
                          bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-2">
              <button
                disabled
                className="flex items-center gap-1 px-2 py-1 text-xs
                           bg-gray-100 dark:bg-gray-700 
                           border border-gray-300 dark:border-gray-600
                           text-gray-400 dark:text-gray-500
                           rounded cursor-not-allowed opacity-50"
              >
                <span>🤖 Agent</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              
              <button
                disabled
                className="flex items-center gap-1 px-2 py-1 text-xs
                           bg-gray-100 dark:bg-gray-700 
                           border border-gray-300 dark:border-gray-600
                           text-gray-400 dark:text-gray-500
                           rounded cursor-not-allowed opacity-50"
              >
                <span>🎯 Job</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            
            <button
              disabled
              className="flex items-center gap-1.5 px-2.5 py-1.5 
                         bg-gray-300 dark:bg-gray-700 
                         text-gray-400 dark:text-gray-500
                         text-xs font-medium rounded-lg
                         cursor-not-allowed opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 relative">
      {/* File Stats Summary - Cursor Style (Collapsible) */}
      {hasFileChanges && (
        <div className="mb-2">
          {/* Header - Clickable to expand/collapse */}
          <button
            onClick={() => setShowFileList(!showFileList)}
            className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors w-full"
          >
            {/* Arrow icon */}
            {showFileList ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            
            {/* File count summary */}
            <span className="font-medium">
              {totalChangedFiles} File{totalChangedFiles > 1 ? 's' : ''} Edited
            </span>
            
            {/* Operation badges */}
            <div className="flex items-center gap-1.5 ml-1">
              {fileStats!.filesCreated > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-[10px] font-medium">
                  +{fileStats!.filesCreated}
                </span>
              )}
              {fileStats!.filesEdited > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-medium">
                  ~{fileStats!.filesEdited}
                </span>
              )}
              {fileStats!.filesDeleted > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-[10px] font-medium">
                  -{fileStats!.filesDeleted}
                </span>
              )}
            </div>
          </button>
          
          {/* File List - Collapsible */}
          {showFileList && fileStats?.files && fileStats.files.length > 0 && (
            <div className="mt-2 ml-5 space-y-1 text-[11px] text-gray-600 dark:text-gray-400">
              {fileStats.files.map((file, idx) => {
                const operationColor = 
                  file.operation === 'create' ? 'text-green-600 dark:text-green-400' :
                  file.operation === 'edit' ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400';
                
                const operationLabel = 
                  file.operation === 'create' ? 'Created' :
                  file.operation === 'edit' ? 'Modified' :
                  'Deleted';
                
                return (
                  <div key={idx} className="flex items-center gap-2 py-0.5">
                    <span className={`font-medium ${operationColor} w-16`}>
                      {operationLabel}
                    </span>
                    <span className={`font-mono truncate flex-1 ${operationColor}`}>
                      {file.path}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      
      {/* Unified Frame - Cursor Chat Style */}
      <div className="border border-gray-300 dark:border-gray-600 rounded-lg 
                      bg-white dark:bg-gray-800">
        {/* Input Area */}
        <textarea
          className="w-full px-3 py-2.5 text-sm
                     bg-transparent text-gray-900 dark:text-gray-100
                     placeholder-gray-400 dark:placeholder-gray-500
                     focus:outline-none
                     resize-none border-none
                     disabled:opacity-50 disabled:cursor-not-allowed"
          placeholder={chatPolicy.inputPlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            // ✅ Ignore Enter key during IME composition (e.g., Korean, Japanese, Chinese input)
            if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
              e.preventDefault();
              if (isRunning) {
                handleStop();
              } else {
                handleSubmit();
              }
            }
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          rows={3}
          disabled={disabled || isRunning}
        />
        
        {/* Bottom Bar with Agent, Job Selector and Submit */}
        <div className="flex items-center justify-between px-2 py-1.5 
                        border-t border-gray-200 dark:border-gray-700
                        bg-gray-50 dark:bg-gray-800/50">
          {/* Agent & Job Selectors - Compact */}
          <div className="flex items-center gap-2">
            {/* Agent Selector */}
            <div className="relative" ref={agentMenuRef}>
              <button
                onClick={() => setShowAgentMenu(!showAgentMenu)}
                disabled={!chatPolicy.canChangeJob || isRunning}
                className="flex items-center gap-1 px-2 py-1 text-xs
                           bg-white dark:bg-gray-700 
                           border border-gray-300 dark:border-gray-600
                           text-gray-700 dark:text-gray-200
                           rounded hover:bg-gray-100 dark:hover:bg-gray-600 
                           transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>
                  {currentAgent?.displayLabel || '🤖 Agent'}
                </span>
                <ChevronDown className={`w-3 h-3 text-gray-500 dark:text-gray-400 transition-transform ${showAgentMenu ? 'rotate-180' : ''}`} />
              </button>

              {/* Agent Menu - Compact with Description */}
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

          {/* Job Selector - Compact */}
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

            {/* Job Menu - Compact */}
            {showJobMenu && jobsWithMetadata.length > 0 && (
              <div className="absolute bottom-full left-0 mb-1 w-48 
                              bg-white dark:bg-gray-800 
                              border border-gray-300 dark:border-gray-600 
                              rounded-lg shadow-lg z-50 overflow-hidden">
                {jobsWithMetadata.map((job: { value: string; label: string; description: string }) => (
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
                    <span className="font-medium">{job.label}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{job.description}</span>
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Submit/Stop Button */}
            {isRunning ? (
              // Stop Button (Job 진행 중)
              <button
                onClick={handleStop}
                disabled={isStopping}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded
                           bg-red-500 hover:bg-red-600 
                           text-white
                           border border-red-600 dark:border-red-500
                           transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
                title="Stop the running job"
              >
                <Square className="w-3 h-3" fill="currentColor" />
                <span>{isStopping ? 'Stopping...' : 'Stop'}</span>
              </button>
            ) : (
              // Submit Button (일반 상태)
              <button
                onClick={handleSubmit}
                disabled={!chatPolicy.canSendMessage || !message.trim()}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded
                           bg-blue-500 hover:bg-blue-600 
                           text-white
                           border border-blue-600 dark:border-blue-500
                           transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-200 
                           disabled:dark:bg-gray-700 disabled:text-gray-400 disabled:dark:text-gray-500
                           disabled:border-gray-300 disabled:dark:border-gray-600"
                title={chatPolicy.canSendMessage ? "Send message" : "Complete selection to enable"}
              >
                <Send className="w-3 h-3" />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

