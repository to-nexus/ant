/**
 * ChoiceCard shared infrastructure.
 *
 * useChoiceCardState  — state management hook (loading, persist, dismiss)
 * ChoiceCardShell     — layout wrapper (header + resolved badge / action area)
 * TwoButtonLayout     — standard two-button row
 * VerticalChoiceLayout — three-button vertical stack
 * THEMES              — theme color tokens
 */

import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Play, Loader2, XCircle } from 'lucide-react';
import { useStore } from '@/domain/store';
import { submitChoiceDismiss } from '@/infrastructure/http/api';
import type { MessageContent } from '@/domain/models/chat';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ChoiceVariant =
  | 'triage_choice' | 'cancelled' | 'eval_save'
  | 'prd_apply' | 'clarifying' | 'spec_complete';

export interface ChoiceCardProps {
  content: MessageContent;
  variant: ChoiceVariant;
  messageId: string;
}

export interface VariantProps {
  content: MessageContent;
  messageId: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared Hook: useChoiceCardState
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UseChoiceCardStateParams {
  content: MessageContent;
  messageId: string;
  contentType: string;
  contentFilter?: (c: MessageContent) => boolean;
  metadataFilter?: Record<string, string>;
}

export function useChoiceCardState({ content, messageId, contentType, contentFilter, metadataFilter }: UseChoiceCardStateParams) {
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

  const persistChoice = useCallback((choiceAction: string, label: string) => {
    const message = chatMessages.find(m => m.id === messageId);
    if (!message) return;

    const matchFn = contentFilter
      || ((c: MessageContent) => c.type === contentType);

    const contentIndex = message.contents.findIndex(matchFn);
    if (contentIndex === -1) return;

    const updatedContents = [...message.contents];
    updatedContents[contentIndex] = {
      ...updatedContents[contentIndex],
      metadata: {
        ...updatedContents[contentIndex].metadata,
        choiceSelected: choiceAction,
        resolvedLabel: label,
      },
    };
    updateChatMessage(messageId, { contents: updatedContents });
  }, [chatMessages, messageId, contentType, contentFilter, updateChatMessage]);

  const persistToBackend = useCallback(async (choiceAction: string, label: string, extraMetadata?: Record<string, any>) => {
    if (!selectedProject || !selectedFeature) return;
    try {
      await submitChoiceDismiss(
        selectedProject, selectedFeature,
        contentType, choiceAction, label,
        metadataFilter,
        extraMetadata
      );
    } catch (error) {
      console.warn('[ChoiceCard] dismiss-choice API failed (non-blocking):', error);
    }
  }, [selectedProject, selectedFeature, contentType, metadataFilter]);

  return {
    selectedProject,
    selectedFeature,
    isLoading,
    setIsLoading,
    selectedChoice,
    resolvedLabel,
    isSelected,
    localSelectedChoice,
    setLocalSelectedChoice,
    localResolvedLabel,
    setLocalResolvedLabel,
    persistChoice,
    persistToBackend,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Theme system
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ThemeColor = 'blue' | 'orange' | 'emerald' | 'violet' | 'teal';

interface ThemeConfig {
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  buttonBg: string;
}

export const THEMES: Record<ThemeColor, ThemeConfig> = {
  blue: {
    bg: 'from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900',
    border: 'border-blue-200 dark:border-gray-700',
    iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    iconColor: 'text-blue-600 dark:text-blue-400',
    buttonBg: 'bg-blue-500 hover:bg-blue-600',
  },
  orange: {
    bg: 'from-orange-50 to-amber-50 dark:from-gray-800 dark:to-gray-900',
    border: 'border-orange-200 dark:border-orange-800/50',
    iconBg: 'bg-orange-100 dark:bg-orange-900/30',
    iconColor: 'text-orange-600 dark:text-orange-400',
    buttonBg: 'bg-orange-500 hover:bg-orange-600',
  },
  emerald: {
    bg: 'from-emerald-50 to-teal-50 dark:from-gray-800 dark:to-gray-900',
    border: 'border-emerald-200 dark:border-emerald-800/50',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    buttonBg: 'bg-emerald-500 hover:bg-emerald-600',
  },
  violet: {
    bg: 'from-violet-50 to-purple-50 dark:from-gray-800 dark:to-gray-900',
    border: 'border-violet-200 dark:border-violet-800/50',
    iconBg: 'bg-violet-100 dark:bg-violet-900/30',
    iconColor: 'text-violet-600 dark:text-violet-400',
    buttonBg: 'bg-violet-500 hover:bg-violet-600',
  },
  teal: {
    bg: 'from-teal-50 to-cyan-50 dark:from-gray-800 dark:to-gray-900',
    border: 'border-teal-200 dark:border-teal-800/50',
    iconBg: 'bg-teal-100 dark:bg-teal-900/30',
    iconColor: 'text-teal-600 dark:text-teal-400',
    buttonBg: 'bg-teal-500 hover:bg-teal-600',
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ResolvedBadge
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ResolvedIcon = 'dismiss' | 'resume' | null;

function ResolvedBadge({ label, icon }: { label: string; icon?: ResolvedIcon }) {
  return (
    <div className="pt-3 border-t border-gray-200 dark:border-gray-600">
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ChoiceCardShell
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ChoiceCardShellProps {
  theme: ThemeColor;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  isSelected: boolean;
  resolvedLabel: string | null;
  resolvedIcon?: ResolvedIcon;
  children: React.ReactNode;
}

export function ChoiceCardShell({
  theme, icon, title, subtitle,
  isSelected, resolvedLabel, resolvedIcon,
  children,
}: ChoiceCardShellProps) {
  const t = THEMES[theme];

  return (
    <div className={`choice-card bg-gradient-to-br ${t.bg} rounded-xl p-4 border ${t.border} shadow-sm`}>
      <div className="flex items-start gap-3 mb-4">
        <div className={`flex-shrink-0 w-8 h-8 rounded-full ${t.iconBg} flex items-center justify-center`}>
          <span className={t.iconColor}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {title}
            </ReactMarkdown>
          </div>
          {subtitle && (
            <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 whitespace-pre-line">
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {isSelected && resolvedLabel ? (
        <ResolvedBadge label={resolvedLabel} icon={resolvedIcon} />
      ) : (
        children
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Button Layouts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function TwoButtonLayout({
  positiveLabel,
  positiveIcon,
  positiveLoadingLabel,
  negativeLabel,
  isLoading,
  onPositive,
  onNegative,
  disablePositive,
  theme,
}: {
  positiveLabel: string;
  positiveIcon?: React.ReactNode;
  positiveLoadingLabel?: string;
  negativeLabel: string;
  isLoading: boolean;
  onPositive: () => void;
  onNegative: () => void;
  disablePositive?: boolean;
  theme: ThemeColor;
}) {
  const t = THEMES[theme];
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onPositive}
        disabled={isLoading || disablePositive}
        className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${t.buttonBg} text-white ${isLoading || disablePositive ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {positiveLoadingLabel || 'Processing...'}
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            {positiveIcon}
            {positiveLabel}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onNegative}
        disabled={isLoading}
        className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}
      >
        {negativeLabel}
      </button>
    </div>
  );
}

export function VerticalChoiceLayout({
  positiveLabel,
  neutralLabel,
  negativeLabel,
  isLoading,
  loadingAction,
  onPositive,
  onNeutral,
  onNegative,
  theme,
}: {
  positiveLabel: string;
  neutralLabel: string;
  negativeLabel: string;
  isLoading: boolean;
  loadingAction: 'positive' | 'neutral' | null;
  onPositive: () => void;
  onNeutral: () => void;
  onNegative: () => void;
  theme: ThemeColor;
}) {
  const t = THEMES[theme];
  const disabled = isLoading;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onPositive}
        disabled={disabled}
        className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${t.buttonBg} text-white ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}
      >
        {isLoading && loadingAction === 'positive' ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            처리 중...
          </span>
        ) : (
          positiveLabel
        )}
      </button>
      <button
        type="button"
        onClick={onNeutral}
        disabled={disabled}
        className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 border ${t.border} text-gray-700 dark:text-gray-200 bg-transparent ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:shadow-sm'}`}
      >
        {isLoading && loadingAction === 'neutral' ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            처리 중...
          </span>
        ) : (
          neutralLabel
        )}
      </button>
      <button
        type="button"
        onClick={onNegative}
        disabled={disabled}
        className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-sm'}`}
      >
        {negativeLabel}
      </button>
    </div>
  );
}
