/**
 * Chat UI Policy Hook
 * 
 * Centralized logic for chat UI states based on application state
 */

import { useStore } from '@/domain/store';

export interface ChatPolicy {
  // Header
  headerText: string;
  isOffline: boolean;
  
  // Input
  canSendMessage: boolean;
  inputPlaceholder: string;
  
  // History Message
  emptyStateMessage: string | null;
  readyEmptyStateMessage: string | null;  // ✅ Ready 상태의 empty state
  
  // Job Selector
  jobButtonLabel: string;
  
  // Retry
  canRetry: boolean;  // ✅ Retry 가능 여부
  
  // Metadata
  reason: 'no-agent' | 'no-workspace' | 'no-project' | 'no-job' | 'ready' | 'job-running' | 'job-failed';
}

export function useChatPolicy(messageCount: number = 0, lastJobFailed: boolean = false): ChatPolicy {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedWorkType = useStore((state) => state.selectedWorkType);
  const isRunning = useStore((state) => state.isRunning);

  // Agent 미선택
  if (!selectedAgent) {
    return {
      headerText: 'Chat is Offline',
      isOffline: true,
      canSendMessage: false,
      inputPlaceholder: 'Select an agent to start chatting...',
      emptyStateMessage: 'Please select an agent from the navigation bar',
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedWorkType || 'Job',
      canRetry: false,
      reason: 'no-agent'
    };
  }

  // Workspace (Project) 미선택
  if (!selectedProject) {
    return {
      headerText: `Chat with ${getAgentDisplayName(selectedAgent)}`,
      isOffline: false,
      canSendMessage: false,
      inputPlaceholder: 'Select a workspace to continue...',
      emptyStateMessage: 'Please select a workspace from the navigation bar',
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedWorkType || 'Job',
      canRetry: false,
      reason: 'no-workspace'
    };
  }

  // Project 선택 but Feature 미선택
  if (!selectedFeature) {
    return {
      headerText: `Chat with ${getAgentDisplayName(selectedAgent)}`,
      isOffline: false,
      canSendMessage: false,
      inputPlaceholder: 'Select a project to continue...',
      emptyStateMessage: 'Please select a project from the navigation bar',
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedWorkType || 'Job',
      canRetry: false,
      reason: 'no-project'
    };
  }

  // Job 미선택 (이론상 불가능하지만 방어 코드)
  if (!selectedWorkType) {
    return {
      headerText: `Chat with ${getAgentDisplayName(selectedAgent)}`,
      isOffline: false,
      canSendMessage: false,
      inputPlaceholder: 'Select a job type to continue...',
      emptyStateMessage: 'Please select a job type from the selector below',
      readyEmptyStateMessage: null,
      jobButtonLabel: 'Job',
      canRetry: false,
      reason: 'no-job'
    };
  }

  // ✅ Job 진행 중 - 입력 차단
  if (isRunning) {
    return {
      headerText: `Chat with ${getAgentDisplayName(selectedAgent)}`,
      isOffline: false,
      canSendMessage: false,  // ❌ 입력 차단
      inputPlaceholder: 'Job is running. Stop the job to send a new message...',
      emptyStateMessage: null,
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedWorkType,
      canRetry: false,  // ❌ 실행 중엔 retry 불가
      reason: 'job-running'
    };
  }

  // ✅ Job 실패 상태 - Retry 가능
  if (lastJobFailed) {
    return {
      headerText: `Chat with ${getAgentDisplayName(selectedAgent)}`,
      isOffline: false,
      canSendMessage: false,  // ❌ 실패 후엔 새 메시지 불가 (retry만 가능)
      inputPlaceholder: 'Job failed. Click Retry to resume or send a new message...',
      emptyStateMessage: null,
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedWorkType,
      canRetry: true,  // ✅ Retry 가능
      reason: 'job-failed'
    };
  }

  // ✅ 모든 조건 만족 - Ready
  const isFirstMessage = messageCount === 0;
  
  return {
    headerText: `Chat with ${getAgentDisplayName(selectedAgent)}`,
    isOffline: false,
    canSendMessage: true,
    inputPlaceholder: isFirstMessage 
      ? 'Start your conversation with the agent...' 
      : 'Continue your conversation...',
    emptyStateMessage: null,
    readyEmptyStateMessage: 'Start chatting to collaborate with the agent',
    jobButtonLabel: selectedWorkType,
    canRetry: false,  // ❌ 정상 상태에선 retry 불필요
    reason: 'ready'
  };
}

/**
 * Get display name for agent
 */
function getAgentDisplayName(agentId: string): string {
  const agentNames: Record<string, string> = {
    'architect': 'Architect',
    'reviewer': 'Reviewer',
    'planner': 'Planner',
    'doc': 'Documentation'
  };
  
  return agentNames[agentId] || agentId.charAt(0).toUpperCase() + agentId.slice(1);
}

