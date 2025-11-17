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
  canChangeJob: boolean;  // ✅ Job 변경 가능 여부
  
  // Metadata
  reason: 'not-authenticated' | 'no-agent' | 'no-workspace' | 'no-project' | 'no-job' | 'ready' | 'job-running' | 'job-interrupted';
}

export function useChatPolicy(messageCount: number = 0): ChatPolicy {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedJobType = useStore((state) => state.selectedJobType);
  const isRunning = useStore((state) => state.isRunning);
  const kanbanData = useStore((state) => state.kanban);
  const dismissedInterruptTimestamp = useStore((state) => state.dismissedInterruptTimestamp);
  const backendMode = useStore((state) => state.backendMode);
  const userEmail = useStore((state) => state.userEmail);
  
  // ✅ Check authentication status
  const isAuthenticated = backendMode === 'local' || !!userEmail;
  
  // ✅ CRITICAL: Check if job is interrupted (user_stopped, recursion_limit, etc.)
  // Chat doesn't have a dismiss button - it only disappears after successful resume
  const hasInterruption = !isRunning 
    && kanbanData?.interruption?.canResume === true
    && kanbanData?.interruption?.timestamp !== dismissedInterruptTimestamp;  // Only hide after resume success

  // ✅ Not authenticated in cloud mode
  if (!isAuthenticated) {
    return {
      headerText: 'Chat is Offline',
      isOffline: true,
      canSendMessage: false,
      inputPlaceholder: 'Please sign in to start chatting...',
      emptyStateMessage: 'Please sign in from the navigation bar to continue',
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedJobType || 'Job',
      canChangeJob: false,
      reason: 'not-authenticated'
    };
  }

  // Agent 미선택
  if (!selectedAgent) {
    return {
      headerText: 'Chat is Offline',
      isOffline: true,
      canSendMessage: false,
      inputPlaceholder: 'Select an agent to start chatting...',
      emptyStateMessage: 'Please select an agent from the navigation bar',
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedJobType || 'Job',
      canChangeJob: true,
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
      jobButtonLabel: selectedJobType || 'Job',
      canChangeJob: true,
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
      jobButtonLabel: selectedJobType || 'Job',
      canChangeJob: true,
      reason: 'no-project'
    };
  }

  // Job 미선택 (이론상 불가능하지만 방어 코드)
  if (!selectedJobType) {
    return {
      headerText: `Chat with ${getAgentDisplayName(selectedAgent)}`,
      isOffline: false,
      canSendMessage: false,
      inputPlaceholder: 'Select a job type to continue...',
      emptyStateMessage: 'Please select a job type from the selector below',
      readyEmptyStateMessage: null,
      jobButtonLabel: 'Job',
      canChangeJob: true,
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
      jobButtonLabel: selectedJobType,
      canChangeJob: false,  // ❌ Job 실행 중엔 변경 불가
      reason: 'job-running'
    };
  }

  // ✅ Job 중단 상태 - Continue 가능 (최신 directive 추가)
  if (hasInterruption) {
    return {
      headerText: `Chat with ${getAgentDisplayName(selectedAgent)}`,
      isOffline: false,
      canSendMessage: true,  // ✅ Send로 Continue 가능 (directive 추가)
      inputPlaceholder: 'Send a message to continue with additional feedback...',
      emptyStateMessage: null,
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedJobType,
      canChangeJob: true,  // ✅ 중단 후엔 변경 가능
      reason: 'job-interrupted'
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
    jobButtonLabel: selectedJobType,
    canChangeJob: true,  // ✅ 정상 상태에선 변경 가능
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

