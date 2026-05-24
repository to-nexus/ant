
/**
 * ChoiceCard shared infrastructure.
 *
 * useChoiceCardState  — state management hook (loading, persist, dismiss)
 * ChoiceCardShell     — layout wrapper (header + resolved badge / action area)
 * TwoButtonLayout     — standard two-button row
 * VerticalChoiceLayout — three-button vertical stack
 * THEMES              — token-driven recipe per theme color
 */

import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Play, XCircle } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import { createMarkdownComponents } from '@/presentation/components/markdown/createMarkdownComponents';
import { useStore } from '@/domain/store';
import { resolveChoice } from '@/infrastructure/http/api';
import type {
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
} from '@ant/shared';
import { TurnCardShell, type TurnCardAccent } from '../cards/TurnCardShell';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ChoiceVariant =
  | 'triage_choice' | 'cancelled' | 'eval_save'
  | 'clarifying' | 'spec_complete';

export interface ChoiceCardProps {
  presented: ChatChoicePresentedLine;
  resolved?: ChatChoiceResolvedLine;
  variant: ChoiceVariant;
}

export interface VariantProps {
  presented: ChatChoicePresentedLine;
  resolved?: ChatChoiceResolvedLine;
}

const TITLE_MARKDOWN_COMPONENTS = createMarkdownComponents({
  paragraphTag: 'p',
  paragraphClassName: 'my-1 leading-relaxed break-words',
  headingClassName: {
    h1: 'text-base font-semibold my-1 break-words',
    h2: 'text-base font-semibold my-1 break-words',
    h3: 'text-sm font-semibold my-1 break-words',
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared Hook: useChoiceCardState
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface UseChoiceCardStateParams {
  presented: ChatChoicePresentedLine;
  resolved?: ChatChoiceResolvedLine;
}

/**
 * Common state plumbing for every choice-card variant.
 *
 * Phase 11 chat-SSOT — choice cards now consume the SSOT pair
 * `(ChatChoicePresentedLine, ChatChoiceResolvedLine?)`. The durable
 * resolution arrives via the BE `/chat/choice-resolved` route and
 * flows back as a `choice_resolved` SSE line; the projector folds it
 * onto the same card. Optimistic UI lives in component-local state
 * `localSelectedChoice` / `localResolvedLabel` so clicks stay snappy.
 */
export function useChoiceCardState({ presented, resolved }: UseChoiceCardStateParams) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);

  const [isLoading, setIsLoading] = useState(false);
  const [localSelectedChoice, setLocalSelectedChoice] = useState<string | null>(null);
  const [localResolvedLabel, setLocalResolvedLabel] = useState<string | null>(null);

  const selectedChoice = resolved?.choiceSelected || localSelectedChoice;
  const resolvedLabel = resolved?.resolvedLabel || localResolvedLabel;
  const isSelected = !!selectedChoice;

  const persistToBackend = useCallback(async (
    choiceAction: string,
    label: string,
    extraMetadata?: Record<string, any>,
  ) => {
    if (!selectedProject || !selectedFeature || !presented.cardId) return;
    try {
      await resolveChoice(selectedProject, selectedFeature, {
        cardId: presented.cardId,
        choiceSelected: choiceAction,
        resolvedLabel: label,
        answer: extraMetadata,
      });
    } catch (error) {
      console.warn('[ChoiceCard] resolveChoice API failed (non-blocking):', error);
    }
  }, [selectedProject, selectedFeature, presented.cardId]);

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
    persistToBackend,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Theme system (token-driven)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ThemeColor = 'blue' | 'orange' | 'emerald' | 'violet' | 'teal';

export interface ThemeConfig {
  accent: TurnCardAccent;
  iconColor: string;
  iconBg: string;
  gradient: string;
}

export const THEMES: Record<ThemeColor, ThemeConfig> = {
  blue: {
    accent: 'info',
    iconColor: 'var(--violet-500)',
    iconBg: 'oklch(from var(--violet-500) 94% 0.05 270 / 0.5)',
    gradient: 'var(--gradient-cool)',
  },
  orange: {
    accent: 'warning',
    iconColor: 'var(--orange-500)',
    iconBg: 'oklch(from var(--orange-500) 94% 0.05 50 / 0.5)',
    gradient: 'var(--gradient-pink-orange)',
  },
  emerald: {
    accent: 'success',
    iconColor: 'var(--status-done-fg)',
    iconBg: 'var(--status-done-bg)',
    gradient: 'linear-gradient(135deg, var(--status-done-fg) 0%, var(--teal-500) 100%)',
  },
  violet: {
    accent: 'info',
    iconColor: 'var(--violet-500)',
    iconBg: 'oklch(from var(--violet-500) 94% 0.05 290 / 0.5)',
    gradient: 'var(--gradient-aurora)',
  },
  teal: {
    accent: 'info',
    iconColor: 'var(--teal-500)',
    iconBg: 'oklch(from var(--teal-500) 94% 0.04 195 / 0.5)',
    gradient: 'var(--gradient-cool)',
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ResolvedBadge
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ResolvedIcon = 'dismiss' | 'resume' | null;

function ResolvedBadge({ label, icon }: { label: string; icon?: ResolvedIcon }) {
  return (
    <div className="pt-3" style={{ borderTop: '1px solid var(--border-1)' }}>
      <div
        className="flex items-center justify-center gap-2 text-sm"
        style={{ color: 'var(--text-3)' }}
      >
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
          style={{ background: 'var(--bg-surface-2)' }}
        >
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
    <TurnCardShell accent={t.accent} hoverLift={false} className="choice-card">
      <div style={{ padding: 16 }}>
        <div className="flex items-start gap-3 mb-4">
          <div
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: t.iconBg, color: t.iconColor }}
          >
            <span>{icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="text-sm font-medium prose prose-sm dark:prose-invert max-w-none"
              style={{ color: 'var(--text-1)' }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={TITLE_MARKDOWN_COMPONENTS}>
                {title}
              </ReactMarkdown>
            </div>
            {subtitle && (
              <div
                className="text-xs mt-0.5 whitespace-pre-line"
                style={{ color: 'var(--text-2)' }}
              >
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
    </TurnCardShell>
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
  const positiveDisabled = isLoading || disablePositive;
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onPositive}
        disabled={positiveDisabled}
        className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${positiveDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        style={{ background: t.gradient, color: 'var(--text-on-brand)' }}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner size="md" tone="inverse" />
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
        className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        style={{ background: 'var(--bg-surface-2)', color: 'var(--text-1)' }}
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
        className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        style={{ background: t.gradient, color: 'var(--text-on-brand)' }}
      >
        {isLoading && loadingAction === 'positive' ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner size="md" tone="inverse" />
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
        className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        style={{ background: 'transparent', color: 'var(--text-1)', border: '1px solid var(--border-1)' }}
      >
        {isLoading && loadingAction === 'neutral' ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner size="md" tone="inherit" />
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
        className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        style={{ background: 'var(--bg-surface-2)', color: 'var(--text-1)' }}
      >
        {negativeLabel}
      </button>
    </div>
  );
}
