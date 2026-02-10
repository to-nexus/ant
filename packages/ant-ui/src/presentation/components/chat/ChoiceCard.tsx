/**
 * ChoiceCard - Unified choice card component
 * 
 * Handles all user choice scenarios:
 * - triage_choice: Triage redirect/blocked choices
 * - cancelled: Resume after task cancellation
 * - eval_save: Save evaluation report to outputs/evals/
 * - prd_apply: Apply PRD draft to inputs/sources/prd.md
 */

import { useState } from 'react';
import { Play, Loader2, XCircle, Save, FileCheck } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { submitTriageChoice, TriageChoiceAction, submitCancelledChoice, submitEvalSave, submitPrdApply } from '@/infrastructure/http/api';
import type { MessageContent } from '@/domain/models/chat';

type ChoiceVariant = 'triage_choice' | 'cancelled' | 'eval_save' | 'prd_apply';

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

  if (variant === 'eval_save') {
    return <EvalSaveChoiceVariant content={content} messageId={messageId} />;
  }

  if (variant === 'prd_apply') {
    return <PrdApplyChoiceVariant content={content} messageId={messageId} />;
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
      
      // ✅ Handle redirect: switch to suggested agent/job and start with original directive
      if (response.type === 'continue' && response.action === 'redirect' && response.suggestedJob) {
        const targetAgent = response.suggestedAgent || 'architect';
        console.log(`[ChoiceCard:Triage] 🔄 Redirecting to ${targetAgent}/${response.suggestedJob} with directive`);
        const label = response.suggestedAgent 
          ? `→ ${response.suggestedAgent} / ${response.suggestedJob}`
          : `→ ${response.suggestedJob} job`;
        setLocalResolvedLabel(label);
        persistChoice(action, label);
        // Switch agent if needed
        if (response.suggestedAgent) {
          useStore.getState().setSelectedAgent(response.suggestedAgent);
        }
        setSelectedJobType(response.suggestedJob as any);
        await runJob(targetAgent, response.suggestedJob, response.directive);
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
      // ✅ FIX: Start job FIRST, then persist choice only on success
      // Previously, submitCancelledChoice was called before runJob,
      // so if runJob failed, the choice was already persisted as "Resumed"
      // leaving the UI in an inconsistent state (shows "Resumed" but job not running)
      await runJob(selectedAgent, selectedJobType);
      
      // ✅ Only persist after job starts successfully
      await submitCancelledChoice(selectedProject, selectedFeature, jobId, 'resume');
      persistChoice('resume', 'Resumed');
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Eval Save Choice Variant
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function EvalSaveChoiceVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const updateChatMessage = useStore(state => state.updateChatMessage);
  const chatMessages = useStore(state => state.chatMessages);
  
  const [isLoading, setIsLoading] = useState(false);
  const [localSelectedChoice, setLocalSelectedChoice] = useState<string | null>(null);
  const [localResolvedLabel, setLocalResolvedLabel] = useState<string | null>(null);
  
  const evalType = content.metadata?.evalType;
  const evalContent = content.metadata?.evalContent;
  
  const selectedChoice = content.metadata?.choiceSelected || localSelectedChoice;
  const resolvedLabel = content.metadata?.resolvedLabel || localResolvedLabel;
  const isSelected = !!selectedChoice;
  
  const persistChoice = (choiceAction: string, label: string) => {
    const message = chatMessages.find(m => m.id === messageId);
    if (message) {
      const contentIndex = message.contents.findIndex(c => c.type === 'choice_card' && c.metadata?.cardType === 'eval_save');
      if (contentIndex !== -1) {
        const updatedContents = [...message.contents];
        updatedContents[contentIndex] = {
          ...updatedContents[contentIndex],
          metadata: { ...updatedContents[contentIndex].metadata, choiceSelected: choiceAction, resolvedLabel: label }
        };
        updateChatMessage(messageId, { contents: updatedContents });
      }
    }
  };

  const handleSave = async () => {
    if (!selectedProject || !selectedFeature || !evalType || !evalContent || isSelected) return;
    
    setIsLoading(true);
    setLocalSelectedChoice('save');
    
    try {
      const response = await submitEvalSave(selectedProject, selectedFeature, evalType, evalContent);
      const label = response.resolvedLabel || `Saved`;
      setLocalResolvedLabel(label);
      persistChoice('save', label);
    } catch (error) {
      console.error('[ChoiceCard:EvalSave] Failed:', error);
      setLocalSelectedChoice(null);
      setLocalResolvedLabel(null);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSkip = () => {
    if (isSelected) return;
    setLocalSelectedChoice('skip');
    setLocalResolvedLabel('Skipped');
    persistChoice('skip', 'Skipped');
  };
  
  return (
    <div className="choice-card bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-gray-800 dark:to-gray-900 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800/50 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <Save className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
            {content.content || 'Save evaluation report?'}
          </div>
          <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
            outputs/evals/{evalType}/
          </div>
        </div>
      </div>
      
      {isSelected && resolvedLabel ? (
        <ResolvedBadge label={resolvedLabel} icon={selectedChoice === 'skip' ? 'dismiss' : null} borderColor="blue" />
      ) : (
        <div className="flex gap-3">
          <button type="button" onClick={handleSave} disabled={isLoading}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-emerald-500 hover:bg-emerald-600 text-white ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}>
            {isLoading ? (
              <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Saving...</span>
            ) : (
              <span className="flex items-center justify-center gap-2"><Save className="w-4 h-4" />Save</span>
            )}
          </button>
          <button type="button" onClick={handleSkip} disabled={isLoading}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRD Apply Choice Variant
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function PrdApplyChoiceVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const updateChatMessage = useStore(state => state.updateChatMessage);
  const chatMessages = useStore(state => state.chatMessages);
  
  const [isLoading, setIsLoading] = useState(false);
  const [localSelectedChoice, setLocalSelectedChoice] = useState<string | null>(null);
  const [localResolvedLabel, setLocalResolvedLabel] = useState<string | null>(null);
  
  const selectedChoice = content.metadata?.choiceSelected || localSelectedChoice;
  const resolvedLabel = content.metadata?.resolvedLabel || localResolvedLabel;
  const isSelected = !!selectedChoice;
  
  const persistChoice = (choiceAction: string, label: string) => {
    const message = chatMessages.find(m => m.id === messageId);
    if (message) {
      const contentIndex = message.contents.findIndex(c => c.type === 'choice_card' && c.metadata?.cardType === 'prd_apply');
      if (contentIndex !== -1) {
        const updatedContents = [...message.contents];
        updatedContents[contentIndex] = {
          ...updatedContents[contentIndex],
          metadata: { ...updatedContents[contentIndex].metadata, choiceSelected: choiceAction, resolvedLabel: label }
        };
        updateChatMessage(messageId, { contents: updatedContents });
      }
    }
  };

  const handleApply = async () => {
    if (!selectedProject || !selectedFeature || isSelected) return;
    
    setIsLoading(true);
    setLocalSelectedChoice('apply');
    
    try {
      const response = await submitPrdApply(selectedProject, selectedFeature);
      const label = response.resolvedLabel || 'Applied to inputs/sources/prd.md';
      setLocalResolvedLabel(label);
      persistChoice('apply', label);
    } catch (error) {
      console.error('[ChoiceCard:PrdApply] Failed:', error);
      setLocalSelectedChoice(null);
      setLocalResolvedLabel(null);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleKeepDraft = () => {
    if (isSelected) return;
    setLocalSelectedChoice('keep_draft');
    setLocalResolvedLabel('Kept as draft');
    persistChoice('keep_draft', 'Kept as draft');
  };
  
  return (
    <div className="choice-card bg-gradient-to-br from-violet-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 rounded-xl p-4 border border-violet-200 dark:border-violet-800/50 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
          <FileCheck className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-violet-900 dark:text-violet-100">
            {content.content || 'Apply PRD to inputs/sources/prd.md?'}
          </div>
          <div className="text-xs text-violet-700 dark:text-violet-300 mt-0.5">
            outputs/plan/prd-refine.md → inputs/sources/prd.md
          </div>
        </div>
      </div>
      
      {isSelected && resolvedLabel ? (
        <ResolvedBadge label={resolvedLabel} icon={selectedChoice === 'keep_draft' ? 'dismiss' : null} borderColor="blue" />
      ) : (
        <div className="flex gap-3">
          <button type="button" onClick={handleApply} disabled={isLoading}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-violet-500 hover:bg-violet-600 text-white ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}>
            {isLoading ? (
              <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Applying...</span>
            ) : (
              <span className="flex items-center justify-center gap-2"><FileCheck className="w-4 h-4" />Apply</span>
            )}
          </button>
          <button type="button" onClick={handleKeepDraft} disabled={isLoading}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}>
            Keep as draft
          </button>
        </div>
      )}
    </div>
  );
}

export default ChoiceCard;
