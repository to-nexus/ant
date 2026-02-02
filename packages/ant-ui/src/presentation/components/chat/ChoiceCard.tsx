/**
 * ChoiceCard - 통합 선택 카드 컴포넌트
 * 
 * 모든 사용자 선택이 필요한 상황을 처리:
 * - triage_choice: Triage redirect/blocked 선택
 * - cancelled: 작업 취소 후 재개 선택
 */

import { useState } from 'react';
import { Play, Loader2, XCircle } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { submitTriageChoice, TriageChoiceAction, submitCancelledChoice } from '@/infrastructure/http/api';
import type { MessageContent } from '@/domain/models/chat';

type ChoiceVariant = 'triage_choice' | 'cancelled';

interface ChoiceCardProps {
  content: MessageContent;
  variant: ChoiceVariant;
  messageId: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Common Components
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ResolvedIcon = 'dismiss' | 'resume' | 'redirect' | null;
type BorderColor = 'blue' | 'orange';

interface ResolvedBadgeProps {
  label: string;
  icon?: ResolvedIcon;
  borderColor?: BorderColor;
}

function ResolvedBadge({ label, icon, borderColor = 'blue' }: ResolvedBadgeProps) {
  const borderClasses: Record<BorderColor, string> = {
    blue: 'border-blue-200 dark:border-gray-600',
    orange: 'border-orange-200 dark:border-gray-600',
  };
  
  return (
    <div className={`pt-3 border-t ${borderClasses[borderColor]}`}>
      <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700">
          {icon === 'dismiss' && <XCircle className="w-3.5 h-3.5" />}
          {icon === 'resume' && <Play className="w-3.5 h-3.5" />}
          {label}
        </span>
      </div>
    </div>
  );
}

export function ChoiceCard({ content, variant, messageId }: ChoiceCardProps) {
  if (variant === 'triage_choice') {
    return <TriageChoiceVariant content={content} messageId={messageId} />;
  }
  
  if (variant === 'cancelled') {
    return <CancelledChoiceVariant content={content} messageId={messageId} />;
  }
  
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Triage Choice Variant
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TriageChoiceVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const setSelectedJobType = useStore(state => state.setSelectedJobType);
  const updateChatMessage = useStore(state => state.updateChatMessage);
  const chatMessages = useStore(state => state.chatMessages);
  
  const [isLoading, setIsLoading] = useState(false);
  const [localSelectedAction, setLocalSelectedAction] = useState<string | null>(null);
  const [localResolvedLabel, setLocalResolvedLabel] = useState<string | null>(null);
  
  const { runJob } = useJobExecution();
  
  const jobId = content.metadata?.jobId;
  const options = content.metadata?.choiceOptions;
  
  // ✅ Use metadata as source of truth (persisted), local state for optimistic updates
  const selectedAction = content.metadata?.choiceSelected || localSelectedAction;
  const resolvedLabel = content.metadata?.resolvedLabel || localResolvedLabel;
  
  if (!options) return null;
  
  const isSelected = !!selectedAction;
  
  const handleSelect = async (action: string) => {
    if (!selectedProject || !selectedFeature || !jobId || isSelected) {
      console.error('[ChoiceCard:Triage] Missing context or already selected');
      return;
    }
    
    setIsLoading(true);
    setLocalSelectedAction(action);
    
    try {
      const response = await submitTriageChoice(
        selectedProject,
        selectedFeature,
        jobId,
        action as TriageChoiceAction
      );
      
      console.log('[ChoiceCard:Triage] ✅ Choice submitted:', {
        action,
        responseType: response.type,
        suggestedJob: response.suggestedJob,
        hasDirective: !!response.directive
      });
      
      // Helper to persist choice to store
      const persistChoice = (choiceAction: string, label: string) => {
        const message = chatMessages.find(m => m.id === messageId);
        if (message) {
          const contentIndex = message.contents.findIndex(c => c.type === 'triage_choice');
          if (contentIndex !== -1) {
            const updatedContents = [...message.contents];
            updatedContents[contentIndex] = {
              ...updatedContents[contentIndex],
              metadata: {
                ...updatedContents[contentIndex].metadata,
                choiceSelected: choiceAction,
                resolvedLabel: label
              }
            };
            updateChatMessage(messageId, { contents: updatedContents });
          }
        }
      };
      
      // ✅ Handle redirect: switch to suggested job and start it with original directive
      if (response.type === 'continue' && response.action === 'redirect' && response.suggestedJob) {
        console.log(`[ChoiceCard:Triage] 🔄 Redirecting to ${response.suggestedJob} job with directive`);
        const label = `→ ${response.suggestedJob} job으로 전환됨`;
        setLocalResolvedLabel(label);
        persistChoice(action, label);
        setSelectedJobType(response.suggestedJob as 'design' | 'code' | 'learn');
        await runJob('architect', response.suggestedJob as 'design' | 'code' | 'learn', response.directive);
      }
      
      // ✅ Handle dismiss: show system message
      if (response.type === 'dismiss') {
        console.log('[ChoiceCard:Triage] 🚫 Task dismissed');
        setLocalResolvedLabel('Dismissed');
        persistChoice(action, 'Dismissed');
        // Add system message to chat
        useStore.getState().addChatMessage({
          id: `msg-dismiss-${Date.now()}`,
          role: 'assistant',
          contents: [{
            type: 'text',
            content: response.message || '작업이 취소되었습니다. 새 작업을 요청해주세요.'
          }],
          timestamp: new Date().toISOString()
        });
      }
      
      // ✅ Handle guide: show guide message
      if (response.type === 'guide') {
        const label = '가이드 제공됨';
        setLocalResolvedLabel(label);
        persistChoice(action, label);
      }
      
    } catch (error) {
      console.error('[ChoiceCard:Triage] ❌ Failed:', error);
      setLocalSelectedAction(null); // Revert on error
      setLocalResolvedLabel(null);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Get resolved label for display (from state or metadata)
  const displayResolvedLabel = resolvedLabel || content.metadata?.resolvedLabel;
  
  return (
    <div className="choice-card bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900 rounded-xl p-4 border border-blue-200 dark:border-gray-700 shadow-sm">
      {/* Message */}
      <div className={isSelected && displayResolvedLabel ? '' : 'mb-4'}>
        <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
          {content.content}
        </p>
      </div>
      
      {/* Choice Buttons OR Resolved State - Fixed height to prevent layout shift */}
      <div className="min-h-[52px] flex items-center">
        {isSelected && displayResolvedLabel ? (
          <div className="w-full">
            <ResolvedBadge 
              label={displayResolvedLabel} 
              icon={selectedAction === 'dismiss' ? 'dismiss' : null}
              borderColor="blue"
            />
          </div>
        ) : (
          /* Buttons: Show when not resolved */
          <div className="flex gap-3 w-full">
          {/* Positive */}
          <button
            type="button"
            onClick={() => handleSelect(options.positive.action)}
            disabled={isLoading}
            className={`
              flex-1 px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200 
              bg-blue-500 hover:bg-blue-600 text-white
              ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}
            `}
          >
            {isLoading && selectedAction === options.positive.action ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                처리 중...
              </span>
            ) : (
              options.positive.label
            )}
          </button>
          
          {/* Negative */}
          <button
            type="button"
            onClick={() => handleSelect(options.negative.action)}
            disabled={isLoading}
            className={`
              flex-1 px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200 
              bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600
              text-gray-700 dark:text-gray-200
              ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}
            `}
          >
            {isLoading && selectedAction === options.negative.action ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                처리 중...
              </span>
            ) : (
            options.negative.label
          )}
        </button>
        </div>
        )}
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Cancelled Choice Variant
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function CancelledChoiceVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedJobType = useStore(state => state.selectedJobType);
  const isRunning = useStore(state => state.isRunning);
  const kanbanData = useStore(state => state.kanban);
  const setDismissedInterruptTimestamp = useStore(state => state.setDismissedInterruptTimestamp);
  const updateChatMessage = useStore(state => state.updateChatMessage);
  const chatMessages = useStore(state => state.chatMessages);
  
  const [isLoading, setIsLoading] = useState(false);
  const [localSelectedChoice, setLocalSelectedChoice] = useState<string | null>(null);
  const [localResolvedLabel, setLocalResolvedLabel] = useState<string | null>(null);
  
  const { runJob } = useJobExecution();
  
  // ✅ Helper to persist choice to store (prevents Virtuoso remount from resetting state)
  const persistChoice = (choiceAction: string, label: string) => {
    const message = chatMessages.find(m => m.id === messageId);
    if (message) {
      const contentIndex = message.contents.findIndex(c => c.type === 'cancelled');
      if (contentIndex !== -1) {
        const updatedContents = [...message.contents];
        updatedContents[contentIndex] = {
          ...updatedContents[contentIndex],
          metadata: {
            ...updatedContents[contentIndex].metadata,
            choiceSelected: choiceAction,
            resolvedLabel: label
          }
        };
        updateChatMessage(messageId, { contents: updatedContents });
      }
    }
  };
  const jobId = content.metadata?.jobId;
  const originalType = content.metadata?.originalType;
  const reason = content.metadata?.reason;
  
  // ✅ Use metadata as source of truth (persisted), local state for optimistic updates
  const selectedChoice = content.metadata?.choiceSelected || localSelectedChoice;
  const resolvedLabel = content.metadata?.resolvedLabel || localResolvedLabel;
  
  // Get display text based on original work type
  const getWorkTypeLabel = (type: string | undefined): string => {
    if (!type) return 'Task';
    
    const labels: Record<string, string> = {
      'analyzing': 'Analysis',
      'exploring': 'Exploration',
      'retrieving': 'Retrieval',
      'grepping': 'Search',
      'reading': 'Reading',
      'indexing': 'Indexing',
      'storing': 'Storage',
      'listing_files': 'File Listing',
      'searching_code': 'Code Search'
    };
    
    return labels[type] || 'Task';
  };
  
  const workLabel = getWorkTypeLabel(originalType);
  const canResume = !isRunning && jobId && selectedProject && selectedFeature && !!reason;
  const isSelected = !!selectedChoice;
  
  const handleResume = async () => {
    if (!canResume || isSelected || !selectedProject || !selectedFeature || !jobId) return;
    
    setIsLoading(true);
    setLocalSelectedChoice('resume');
    setLocalResolvedLabel('Resumed');
    
    try {
      // Call API (same pattern as triage_choice)
      await submitCancelledChoice(selectedProject, selectedFeature, jobId, 'resume');
      
      // ✅ Persist choice to metadata (prevents Virtuoso remount reset)
      persistChoice('resume', 'Resumed');
      
      // Start job (runJob internally calls setRunning immediately)
      await runJob(selectedAgent, selectedJobType);
    } catch (error) {
      console.error('[ChoiceCard:Cancelled] ❌ Failed:', error);
      setLocalSelectedChoice(null);
      setLocalResolvedLabel(null);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleDismiss = async () => {
    if (isSelected || !selectedProject || !selectedFeature || !jobId) return;
    
    setLocalSelectedChoice('dismiss');
    setLocalResolvedLabel('Dismissed');
    
    // ✅ CRITICAL: Mark interruption as dismissed so new chat input starts fresh job
    if (kanbanData?.interruption?.timestamp) {
      setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
    }
    
    try {
      // Call API (same pattern as triage_choice)
      await submitCancelledChoice(selectedProject, selectedFeature, jobId, 'dismiss');
      
      // ✅ Persist choice to metadata (prevents Virtuoso remount reset)
      persistChoice('dismiss', 'Dismissed');
    } catch (error) {
      console.error('[ChoiceCard:Cancelled] ❌ Failed:', error);
      setLocalSelectedChoice(null);
      setLocalResolvedLabel(null);
    }
  };
  
  return (
    <div className="choice-card bg-gradient-to-br from-orange-50 to-amber-50 dark:from-gray-800 dark:to-gray-900 rounded-xl p-4 border border-orange-200 dark:border-orange-800/50 shadow-sm">
      {/* Header with Icon */}
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
          <XCircle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-orange-900 dark:text-orange-100">
            {originalType ? `${workLabel} cancelled` : 'Task cancelled'}
          </div>
          <div className="text-xs text-orange-700 dark:text-orange-300 mt-0.5">
            {content.content || 'The task was stopped'}
          </div>
        </div>
      </div>
      
      {/* Resolved State */}
      {isSelected && resolvedLabel ? (
        <ResolvedBadge 
          label={resolvedLabel} 
          icon={resolvedLabel === 'Dismissed' ? 'dismiss' : resolvedLabel === 'Resumed' ? 'resume' : null}
          borderColor="orange"
        />
      ) : canResume ? (
        /* Choice Buttons */
        <div className="flex gap-3">
          {/* Resume (Positive) */}
          <button
            type="button"
            onClick={handleResume}
            disabled={isLoading || isRunning}
            className={`
              flex-1 px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200 
              bg-orange-500 hover:bg-orange-600 text-white
              ${isLoading || isRunning ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}
            `}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Resuming...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Play className="w-4 h-4" fill="currentColor" />
                Resume
              </span>
            )}
          </button>
          
          {/* Dismiss (Negative) */}
          <button
            type="button"
            onClick={handleDismiss}
            disabled={isLoading}
            className={`
              flex-1 px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200 
              bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600
              text-gray-700 dark:text-gray-200
              ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}
            `}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default ChoiceCard;
