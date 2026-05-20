/**
 * ChatInput - Message input area with job selector
 */

import { useState, useEffect, useRef } from 'react';
import { Send, ChevronDown } from 'lucide-react';
import { useStore } from '@/domain/store';
import { selectServerMode } from '@/domain/store/selectors/auth';
import { useChatPolicy } from '@/application/hooks/ui/useChatPolicy';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useTranslation } from 'react-i18next';
import type { FileStats } from '@/domain/models/chat';

import { useAgentJobOptions } from './hooks/useAgentJobOptions';
import { useChatSubmit } from './hooks/useChatSubmit';
import { useResizableHeight } from './hooks/useResizableHeight';
import { useMentionAutocomplete } from './hooks/useMentionAutocomplete';
import { useBaselineEstimate } from '@/application/hooks/baseline/useBaselineEstimate';
import { ChatFileChangeSummary } from './ChatFileChangeSummary';
import { AgentJobToolbar, CHAT_INPUT_MIN_WIDTH_PX } from './AgentJobToolbar';
import { ActionMetadataBadges } from './ActionMetadataBadges';
import { MentionDropdown } from './MentionDropdown';


interface ChatInputProps {
  disabled?: boolean;
  messageCount?: number;
  fileStats?: FileStats;
}

export function ChatInput({ disabled, messageCount = 0, fileStats }: ChatInputProps) {
  const { showError } = useAlertModalContext();
  const { t } = useTranslation('chat');
  const isRunning = useStore((state) => state.isRunning);
  const serverMode = useStore((state) => selectServerMode(state));
  const hasPendingClarify = useStore((state) => Object.keys(state.pendingClarifyAnswers).length > 0);
  const userEmail = useStore((state) => state.userEmail);
  const pendingChatInput = useStore((state) => state.pendingChatInput);
  const [message, setMessage] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isAuthenticated = serverMode === 'local' || !!userEmail;

  const chatPolicy = useChatPolicy(messageCount);
  const { stopJob } = useJobExecution();
  const { agents, agentsWithMetadata, currentAgent, jobsWithMetadata, currentJob } = useAgentJobOptions();
  const { handleSubmit } = useChatSubmit({ message, setMessage, showError });
  const { textareaHeight, isResizing, handleResizeStart, handleResizeMove, handleResizeEnd } = useResizableHeight();
  const mention = useMentionAutocomplete(message, cursorPos);

  // PR-2 baseline gauge — fire-and-forget hook. Debounced 300ms inside.
  // Writes `kanban.baselinePhaseTokenUsage` so `TurnTokenRing` renders
  // the predicted next-call floor when no live job is running.
  const selectedIntentId = useStore((state) => state.selectedIntentId);
  const actionMetadataRefs = useStore((state) => state.actionMetadata.refs);
  const actionMetadataContext = useStore((state) => state.actionMetadata.context);
  useBaselineEstimate({
    intent: selectedIntentId ?? undefined,
    refs: actionMetadataRefs ?? [],
    context: actionMetadataContext ?? [],
    draftText: message,
  });

  // Consume pending chat input (from fix, quick action, template, etc.)
  useEffect(() => {
    if (pendingChatInput) {
      console.log('[ChatInput] 💬 Consuming pending input from Chat service:', {
        messageLength: pendingChatInput.message.length,
        source: pendingChatInput.source,
      });
      setMessage(pendingChatInput.message);
      useStore.setState({ pendingChatInput: null });
      console.log('[ChatInput] ✅ Input consumed, submit button enabled');
      if (pendingChatInput.autoSubmit) {
        console.log('[ChatInput] 🚀 Auto-submitting...');
      }
    }
  }, [pendingChatInput]);

  const hasFileChanges = fileStats && (fileStats.filesEdited > 0 || fileStats.filesCreated > 0 || fileStats.filesDeleted > 0);

  // Unauthenticated placeholder (cloud mode)
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
            placeholder={t('input.placeholder')}
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
              <span>{t('input.send')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 relative">
      {hasFileChanges && <ChatFileChangeSummary fileStats={fileStats!} />}
      
      {/* Resize Overlay */}
      {isResizing && (
        <div 
          className="fixed inset-0 cursor-ns-resize"
          style={{ zIndex: 9999 }}
          onMouseMove={handleResizeMove}
          onMouseUp={handleResizeEnd}
        />
      )}
      
      {/* Mention Autocomplete Dropdown */}
      {mention.showSuggestions && (
        <MentionDropdown
          suggestions={mention.suggestions}
          selectedIndex={mention.selectedIndex}
          onSelect={(s) => {
            const { newMessage, newCursorPos } = mention.applySuggestion(s);
            setMessage(newMessage);
            requestAnimationFrame(() => {
              textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
            });
          }}
          onHover={mention.setSelectedIndex}
        />
      )}

      {/* Unified Frame */}
      <div
        style={{ minWidth: `${CHAT_INPUT_MIN_WIDTH_PX}px` }}
        className="relative border border-gray-300 dark:border-gray-600 rounded-lg
                      bg-white dark:bg-gray-800"
      >
        {/* Resize Handle */}
        <div
          className="absolute top-0 left-0 right-0 cursor-ns-resize hover:bg-blue-500/20 
                     transition-colors group"
          style={{ 
            height: '8px',
            marginTop: '-4px',
            zIndex: 999,
            pointerEvents: 'auto'
          }}
          onMouseDown={handleResizeStart}
          title="Drag to resize (always available)"
        >
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-12 h-1 
                         bg-gray-300 dark:bg-gray-600 rounded-full
                         group-hover:bg-blue-500 transition-colors" />
        </div>
        
        {/* Action Metadata Badges */}
        <ActionMetadataBadges />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          data-chat-input
          style={{ height: `${textareaHeight}px` }}
          className="w-full px-3 py-2.5 text-sm
                     bg-transparent text-gray-900 dark:text-gray-100
                     placeholder-gray-400 dark:placeholder-gray-500
                     focus:outline-none
                     resize-none border-none
                     disabled:opacity-50 disabled:cursor-not-allowed"
          placeholder={chatPolicy.inputPlaceholder}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setCursorPos(e.target.selectionStart || 0);
          }}
          onSelect={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart || 0)}
          onKeyDown={(e) => {
            const mentionResult = mention.handleKeyDown(e);
            if (mentionResult !== false) {
              setMessage(mentionResult.newMessage);
              requestAnimationFrame(() => {
                textareaRef.current?.setSelectionRange(mentionResult.newCursorPos, mentionResult.newCursorPos);
              });
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
              e.preventDefault();
              if (isRunning) {
                stopJob();
              } else {
                handleSubmit();
              }
            }
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          disabled={disabled || isRunning}
        />
        
        {/* Bottom Toolbar */}
        <AgentJobToolbar
          agents={agents}
          agentsWithMetadata={agentsWithMetadata}
          currentAgent={currentAgent}
          jobsWithMetadata={jobsWithMetadata}
          currentJob={currentJob}
          messageCount={messageCount}
          canSubmit={chatPolicy.canSendMessage && (!!message.trim() || hasPendingClarify)}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
