/**
 * Chat UI Policy Hook
 * 
 * Centralized logic for chat UI states based on application state
 */

import { useStore } from '@/domain/store';
import { useTranslation } from 'react-i18next';

export interface ChatPolicy {
  // Header
  headerText: string;
  isOffline: boolean;
  
  // Input
  canSendMessage: boolean;
  inputPlaceholder: string;
  
  // Resize - Always enabled
  canResizeInput: boolean;  // ✅ 항상 true, 작업 진행 중에도 가능
  
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
  const { t } = useTranslation('chat');
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedJobType = useStore((state) => state.selectedJobType);
  const isRunning = useStore((state) => state.isRunning);
  const isQueued = useStore((state) => state.isQueued);
  const queuePosition = useStore((state) => state.queuePosition);
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
      headerText: t('sidebar.offline'),
      isOffline: true,
      canSendMessage: false,
      inputPlaceholder: t('policy.signInPlaceholder'),
      canResizeInput: true,  // ✅ Always allow resize
      emptyStateMessage: t('policy.signInMessage'),
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedJobType || t('sidebar.offline'),
      canChangeJob: false,
      reason: 'not-authenticated'
    };
  }

  // Agent 미선택
  if (!selectedAgent) {
    return {
      headerText: t('sidebar.offline'),
      isOffline: true,
      canSendMessage: false,
      inputPlaceholder: t('policy.selectAgentPlaceholder'),
      canResizeInput: true,  // ✅ Always allow resize
      emptyStateMessage: t('policy.selectAgentMessage'),
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedJobType || t('sidebar.offline'),
      canChangeJob: true,
      reason: 'no-agent'
    };
  }

  // Workspace (Project) 미선택
  if (!selectedProject) {
    return {
      headerText: t('sidebar.chatWith', { agent: getAgentDisplayName(selectedAgent) }),
      isOffline: false,
      canSendMessage: false,
      inputPlaceholder: t('policy.selectWorkspacePlaceholder'),
      canResizeInput: true,  // ✅ Always allow resize
      emptyStateMessage: t('policy.selectWorkspaceMessage'),
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedJobType || t('sidebar.offline'),
      canChangeJob: true,
      reason: 'no-workspace'
    };
  }

  // Workspace 선택 but Feature 미선택
  if (!selectedFeature) {
    return {
      headerText: t('sidebar.chatWith', { agent: getAgentDisplayName(selectedAgent) }),
      isOffline: false,
      canSendMessage: false,
      inputPlaceholder: t('policy.selectFeaturePlaceholder'),
      canResizeInput: true,  // ✅ Always allow resize
      emptyStateMessage: t('policy.selectFeatureMessage'),
      readyEmptyStateMessage: null,
      jobButtonLabel: selectedJobType || t('sidebar.offline'),
      canChangeJob: true,
      reason: 'no-project'
    };
  }

  // Job 미선택 (이론상 불가능하지만 방어 코드)
  if (!selectedJobType) {
    return {
      headerText: t('sidebar.chatWith', { agent: getAgentDisplayName(selectedAgent) }),
      isOffline: false,
      canSendMessage: false,
      inputPlaceholder: t('policy.selectJobPlaceholder'),
      canResizeInput: true,  // ✅ Always allow resize
      emptyStateMessage: t('policy.selectJobMessage'),
      readyEmptyStateMessage: null,
      jobButtonLabel: t('sidebar.offline'),
      canChangeJob: true,
      reason: 'no-job'
    };
  }

  // ✅ Job 진행 중 - 입력 차단 BUT Resize 가능
  if (isRunning) {
    // Build placeholder based on queue status
    let placeholder = t('policy.jobRunningPlaceholder');
    if (isQueued && queuePosition?.position) {
      placeholder = t('policy.queueWaitingPlaceholder', { 
        position: queuePosition.position, 
        total: queuePosition.totalWaiting 
      });
    }
    
    return {
      headerText: t('sidebar.chatWith', { agent: getAgentDisplayName(selectedAgent) }),
      isOffline: false,
      canSendMessage: false,  // ❌ 입력 차단
      inputPlaceholder: placeholder,
      canResizeInput: true,  // ✅ 작업 중에도 resize 가능
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
      headerText: t('sidebar.chatWith', { agent: getAgentDisplayName(selectedAgent) }),
      isOffline: false,
      canSendMessage: true,  // ✅ Send로 Continue 가능 (directive 추가)
      inputPlaceholder: t('policy.interruptedPlaceholder'),
      canResizeInput: true,  // ✅ Always allow resize
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
    headerText: t('sidebar.chatWith', { agent: getAgentDisplayName(selectedAgent) }),
    isOffline: false,
    canSendMessage: true,
    inputPlaceholder: isFirstMessage 
      ? t('policy.firstMessagePlaceholder')
      : t('policy.continuePlaceholder'),
    canResizeInput: true,  // ✅ Always allow resize
    emptyStateMessage: null,
    readyEmptyStateMessage: t('policy.readyEmptyState'),
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
    'doc': 'Documentation',
    'creator': 'Creator'
  };
  
  return agentNames[agentId] || agentId.charAt(0).toUpperCase() + agentId.slice(1);
}
