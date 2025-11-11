/**
 * ChatInput - Message input area with job selector
 */

import { useState, useRef, useEffect } from 'react';
import { Send, ChevronDown, ChevronRight, Square, RefreshCw } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useChatPolicy } from '@/application/hooks/ui/useChatPolicy';
import { stopJob, fetchAgents, type Agent } from '@/infrastructure/http/api';
import type { FileStats } from '@/domain/models/chat';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

interface ChatInputProps {
  disabled?: boolean;
  messageCount?: number;  // ✅ 메시지 개수 (첫 채팅 구분)
  fileStats?: FileStats;   // ✅ 파일 통계 (Cursor-style)
}

export function ChatInput({ disabled, messageCount = 0, fileStats }: ChatInputProps) {
  const selectedWorkType = useStore((state) => state.selectedWorkType);
  const setSelectedWorkType = useStore((state) => state.setSelectedWorkType);
  const selectedAgent = useStore((state) => state.selectedAgent);  // ✅ Reactive selectedAgent
  const isRunning = useStore((state) => state.isRunning);
  const isStopping = useStore((state) => state.isStopping);  // ✅ Use global state
  const currentJobId = useStore((state) => state.currentJobId);
  const setRunning = useStore((state) => state.setRunning);
  const setStopping = useStore((state) => state.setStopping);  // ✅ Use global state
  const [showJobMenu, setShowJobMenu] = useState(false);
  const [message, setMessage] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showFileList, setShowFileList] = useState(false);  // ✅ Cursor-style file list toggle
  const menuRef = useRef<HTMLDivElement>(null);
  
  // ✅ Use Chat Policy for UI states (메시지 개수 전달)
  const chatPolicy = useChatPolicy(messageCount);

  // ✅ Fetch agents to get available jobs for selected agent
  useEffect(() => {
    async function loadAgents() {
      try {
        const agentsData = await fetchAgents();
        setAgents(agentsData);
      } catch (error) {
        console.error('[ChatInput] Failed to load agents:', error);
        setAgents([]);
      }
    }
    loadAgents();
  }, []);

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

  const currentJob = jobsWithMetadata.find((j: { value: string; label: string; description: string }) => j.value === selectedWorkType) || jobsWithMetadata[0];

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowJobMenu(false);
      }
    };

    if (showJobMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showJobMenu]);

  // Close menu when job starts running
  useEffect(() => {
    if (isRunning && showJobMenu) {
      setShowJobMenu(false);
    }
  }, [isRunning, showJobMenu]);

  const handleJobSelect = (jobValue: string) => {
    setSelectedWorkType(jobValue as 'design' | 'code' | 'learn');
    setShowJobMenu(false);
  };

  // ✅ Stop job handler - delegates to App's centralized handler
  const handleStop = () => {
    console.log('[ChatInput] Stop button clicked, delegating to App.handleStopTask');
    // Get the stop handler from window (set by App.tsx)
    const globalStopHandler = (window as any).__stopTaskHandler;
    if (globalStopHandler) {
      globalStopHandler();
    } else {
      console.error('[ChatInput] Global stop handler not found!');
    }
  };

  // ✅ Retry job handler (resume from last checkpoint)
  const handleRetry = async () => {
    const selectedProject = useStore.getState().selectedProject;
    const selectedFeature = useStore.getState().selectedFeature;
    const kanbanData = useStore.getState().kanban;
    
    if (!selectedProject || !selectedFeature) {
      console.error('[ChatInput] Missing required selection for retry');
      return;
    }
    
    // ✅ Get jobId from kanban (session data after interruption)
    const jobIdToResume = kanbanData?.jobId;
    
    if (!jobIdToResume) {
      console.error('[ChatInput] Missing jobId for retry - cannot resume');
      console.error('[ChatInput] KanbanData:', kanbanData);
      return;
    }
    
    console.log(`[ChatInput] Retrying job ${jobIdToResume} (resume from last checkpoint)...`);
    
    try {
      // ✅ Set running state immediately
      useStore.getState().setRunning(true, jobIdToResume);
      
      // ✅ Use new resumeJob API - server will auto-detect job type
      const { resumeJob } = await import('@/infrastructure/http/api');
      const result = await resumeJob(jobIdToResume, selectedProject, selectedFeature, true);  // chatSource: true
      
      console.log(`[ChatInput] Retry successful:`, result);
      console.log(`  Original job: ${result.originalJobId}`);
      console.log(`  New job: ${result.jobId}`);
      console.log(`  Job type: ${result.jobType}`);
      
      // ✅ Update with new jobId from server
      useStore.getState().setRunning(true, result.jobId);
      
      // ✅ Clear failed state
      useStore.getState().setLastJobFailed(false);
      
      // ✅ CRITICAL: Dismiss interruption UI globally (hides it in KanbanBoard too)
      if (kanbanData?.interruption?.timestamp) {
        useStore.getState().setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
      }
      
    } catch (error) {
      console.error('[ChatInput] Failed to retry job:', error);
      useStore.getState().setRunning(false);  // ✅ Clear running state on error
      alert(`Failed to retry job: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // ✅ Submit message handler
  const handleSubmit = async () => {
    if (!message.trim() || !chatPolicy.canSendMessage) return;
    
    const selectedProject = useStore.getState().selectedProject;
    const selectedFeature = useStore.getState().selectedFeature;
    const selectedAgent = useStore.getState().selectedAgent;
    
    if (!selectedProject || !selectedFeature || !selectedAgent || !selectedWorkType) {
      console.error('[ChatInput] Missing required selection for job execution');
      return;
    }
    
    console.log('[ChatInput] Submitting chat message as job...');
    console.log('   Message:', message);
    console.log('   Project:', selectedProject);
    console.log('   Feature:', selectedFeature);
    console.log('   Agent:', selectedAgent);
    console.log('   Job Type:', selectedWorkType);
    
    // Clear message immediately for better UX
    const userMessage = message;
    setMessage('');
    
    try {
      // ✅ 1. Add user message to chat history first
      const userMessageResponse = await fetch(
        `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/chat/user-message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: userMessage })
        }
      );
      
      if (!userMessageResponse.ok) {
        throw new Error('Failed to add user message to chat');
      }
      
      // ✅ 2. Immediately show "Planning next moves..." (like Cursor)
      // This will be replaced when actual LLM thinking starts
      let pendingJobId: string | undefined;
      try {
        // Start assistant message placeholder (without real jobId yet)
        const startResponse = await fetch(
          `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/chat/start-message`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})  // ✅ No jobId - will get pending jobId from server
          }
        );
        
        if (startResponse.ok) {
          const { pendingJobId: returnedPendingJobId } = await startResponse.json();
          pendingJobId = returnedPendingJobId;
          console.log('[ChatInput] Started assistant message with pending jobId:', pendingJobId);
        }
        
        // Add planning status immediately (thinking type - will merge with actual thinking)
        await fetch(
          `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/chat/llm-event`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              event: {
                type: 'thinking',
                content: 'Planning next moves...'
              }
            })
          }
        );
        
        console.log('[ChatInput] Planning message added successfully');
      } catch (error) {
        console.error('[ChatInput] Failed to add planning message:', error);
        if (error instanceof Error) {
          console.error('  Error message:', error.message);
        }
      }
      
      // ✅ 3. Execute job with chat input as override directive
      const { executeCodeJob } = await import('@/infrastructure/http/cli');
      
      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        task: selectedWorkType as 'design' | 'code' | 'learn',
        agent: selectedAgent as 'architect',
        overrideDirective: userMessage,  // ✅ Chat input becomes directive
        chatSource: true                  // ✅ Enable Chat SSE
      });
      
      // ✅ Store job execution object IMMEDIATELY for stop functionality
      // (jobId will be set later when API responds)
      useStore.getState().setCurrentJob(jobExecution);
      
      // ✅ 4. Set up job tracking
      jobExecution.onJobIdReady(async (jobId) => {
        console.log('[ChatInput] Job started with ID:', jobId);
        useStore.getState().setRunning(true, jobId);
      });
      
      // ✅ 4. Handle job completion and errors
      jobExecution.on('exit', async (code, signal) => {
        console.log('[ChatInput] Job finished:', { code, signal });
        
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
                `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/chat/job-error`,
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
  const totalChangedFiles = (fileStats?.filesCreated || 0) + (fileStats?.filesEdited || 0) + (fileStats?.filesDeleted || 0);

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
            // Submit on Enter (without Shift)
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (isRunning) {
                handleStop();
              } else {
                handleSubmit();
              }
            }
          }}
          rows={3}
          disabled={disabled || isRunning}
        />
        
        {/* Bottom Bar with Job Selector and Submit */}
        <div className="flex items-center justify-between px-2 py-1.5 
                        border-t border-gray-200 dark:border-gray-700
                        bg-gray-50 dark:bg-gray-800/50">
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
                      job.value === selectedWorkType 
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

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Retry Button (Job 실패 상태일 때만 표시) */}
            {chatPolicy.canRetry && !isRunning && (
              <button
                onClick={handleRetry}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded
                           bg-amber-500 hover:bg-amber-600 
                           text-white
                           border border-amber-600 dark:border-amber-500
                           transition-colors"
                title="Retry the failed job"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            )}

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

