
/**
 * ClarifyingVariant — Compound clarifying-question card (Aurora re-skin).
 *
 * Handles `presented.cardType === 'clarifying'`. Two block flavors share
 * the same card shell:
 *
 *   - Text block  (planner / design): question + N option chips + free-text
 *     fallback. Answers accumulate in `store.pendingClarifyAnswers` keyed
 *     by question index; user submits the batch via the chat input
 *     (`useChatSubmit` reads pendingClarifyAnswers) OR the in-card
 *     "Submit all" button (which runs runJob directly).
 *
 *   - Image block (visual draft selection): N thumbnail rows that
 *     auto-submit on click via `useJobExecution.runJob`. Thumbnail click
 *     opens `DraftLightbox` for zoom/carousel. Optional free-text input
 *     + regenerate button live below the rows.
 *
 * Aurora discipline:
 *   - All surfaces / borders / text colors flow through var(--…) tokens
 *     (auto-flip via [data-theme=dark] in aurora-tokens.css). No
 *     Tailwind dark-mode prefix classes. No `bg-violet-NNN` / `bg-gray-NNN` /
 *     `bg-white` Tailwind palette utilities. No hex literals.
 *   - The card shell is `ChoiceCardShell theme="violet"` (composes
 *     `TurnCardShell accent="info"`).
 */

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Palette,
  Check,
  MessageSquare,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import { useStore } from '@/domain/store';
import { selectPausedNonTaskJob } from '@/domain/store/selectors';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { useImagePreview } from '../useImagePreview';
import { DraftLightbox } from '../ImageLightbox';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell } from './shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types & guards
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ImageOption = {
  label: string;
  imagePath: string;
  thumbnailPath: string;
  value: string;
};
type BlockOption = string | ImageOption;

function isImageOption(opt: BlockOption): opt is ImageOption {
  return typeof opt === 'object' && opt !== null && 'imagePath' in opt;
}

function blockHasImageOptions(options: BlockOption[]): boolean {
  return options.length > 0 && isImageOption(options[0]);
}

// Aurora token recipes used in multiple sub-components.
const VIOLET_TINT_SOFT = 'oklch(from var(--violet-500) 94% 0.05 290 / 0.5)';
const VIOLET_TINT_SELECTED = 'oklch(from var(--violet-500) 94% 0.05 290 / 0.5)';
const VIOLET_HOVER_TINT = 'oklch(from var(--violet-500) 94% 0.04 290 / 0.6)';
const VIOLET_OUTLINE = 'var(--violet-400)';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Text option block (planner / design clarify questions)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface TextQuestionBlockProps {
  questionIndex: number;
  question: string;
  options: string[];
  selectedAnswer: string | undefined;
  disabled: boolean;
  resolvedAnswer?: string | null;
  onSelect: (index: number, answer: string) => void;
}

function TextQuestionBlock({
  questionIndex,
  question,
  options,
  selectedAnswer,
  disabled,
  resolvedAnswer,
  onSelect,
}: TextQuestionBlockProps) {
  const { t } = useTranslation('chat');
  const [showFreeInput, setShowFreeInput] = useState(false);
  const [freeText, setFreeText] = useState('');
  const isFreeInputActive =
    showFreeInput || (selectedAnswer != null && !options.includes(selectedAnswer));

  const handleOptionClick = (option: string) => {
    if (disabled) return;
    setShowFreeInput(false);
    onSelect(questionIndex, option);
  };

  const handleFreeInputToggle = () => {
    if (disabled) return;
    setShowFreeInput(true);
    setFreeText('');
  };

  const handleFreeTextConfirm = () => {
    if (!freeText.trim()) return;
    onSelect(questionIndex, freeText.trim());
    setShowFreeInput(false);
  };

  const handleFreeTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFreeTextConfirm();
    }
  };

  // Resolved (read-only) view.
  if (resolvedAnswer !== undefined) {
    const isSkipped = resolvedAnswer === null;
    return (
      <div className="space-y-1.5">
        {question && (
          <div
            className="text-xs font-semibold"
            style={{ color: 'var(--text-3)' }}
          >
            Q{questionIndex + 1}: {question}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {isSkipped ? (
            <span
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium italic"
              style={{ background: 'var(--bg-surface-2)', color: 'var(--text-3)' }}
            >
              {t('clarify.skipped')}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium"
              style={{ background: 'var(--status-done-bg)', color: 'var(--status-done-fg)' }}
            >
              <span style={{ color: 'var(--violet-500)' }}>✓</span>
              {resolvedAnswer}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {question && (
        <div className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          Q{questionIndex + 1}: {question}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {options.map((option, idx) => {
          const isActive = selectedAnswer === option && !isFreeInputActive;
          const optStyle = isActive
            ? {
                background: 'var(--violet-500)',
                color: 'var(--text-on-brand)',
                boxShadow: 'var(--shadow-sm)',
              }
            : {
                background: 'var(--bg-surface-2)',
                color: 'var(--text-2)',
              };
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleOptionClick(option)}
              disabled={disabled}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
              style={optStyle}
            >
              {isActive && <span className="mr-1">✓</span>}
              {option}
            </button>
          );
        })}

        {isFreeInputActive ? (
          <div className="w-full flex gap-1.5 mt-1">
            <input
              type="text"
              autoFocus
              value={
                freeText ||
                (selectedAnswer && !options.includes(selectedAnswer) ? selectedAnswer : '')
              }
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={handleFreeTextKeyDown}
              onBlur={() => {
                if (freeText.trim()) handleFreeTextConfirm();
              }}
              placeholder={t('clarify.freeInput')}
              disabled={disabled}
              className="flex-1 px-3 py-1.5 rounded-md text-xs focus:outline-none disabled:opacity-50"
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-1)',
                border: '1px solid var(--border-2)',
              }}
            />
            {selectedAnswer && !options.includes(selectedAnswer) && (
              <span
                className="flex items-center text-xs font-medium px-1"
                style={{ color: 'var(--violet-500)' }}
              >
                ✓
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleFreeInputToggle}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
              disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            }`}
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-3)',
              border: '1px dashed var(--border-2)',
            }}
          >
            ✏️ {t('clarify.freeInput')}
          </button>
        )}
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Image option row (visual draft selection — auto-submit)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ExpandableTagLabel({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const tags = useMemo(() => text.split(/\s*\/\s*/).filter(Boolean), [text]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setIsOverflowing(el.scrollHeight > el.clientHeight);
  }, [tags]);

  if (tags.length <= 1) {
    return (
      <span
        className="flex-1 min-w-0 text-sm font-medium truncate"
        style={{ color: 'var(--text-2)' }}
      >
        {text}
      </span>
    );
  }

  return (
    <div className="flex-1 min-w-0">
      <div
        ref={containerRef}
        className={`flex flex-wrap gap-1 ${isExpanded ? '' : 'max-h-6 overflow-hidden'}`}
      >
        {tags.map((tag, i) => (
          <span
            key={i}
            className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap"
            style={{ background: 'var(--bg-surface-2)', color: 'var(--text-2)' }}
          >
            {tag.trim()}
          </span>
        ))}
      </div>
      {isOverflowing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded((prev) => !prev);
          }}
          className="mt-0.5 flex items-center gap-0.5 text-xs transition-colors"
          style={{ color: 'var(--text-3)' }}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3" /> <span>less</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" /> <span>&hellip;more</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

interface DraftRowProps {
  draft: ImageOption;
  draftIndex: number;
  isSelectedDraft: boolean;
  disabled: boolean;
  onClickThumbnail: (value: string) => void;
  onSelectDraft: (value: string) => void;
}

function DraftRow({
  draft,
  draftIndex,
  isSelectedDraft,
  disabled,
  onClickThumbnail,
  onSelectDraft,
}: DraftRowProps) {
  const { t } = useTranslation('chat');
  const thumbUrl = useImagePreview(draft.thumbnailPath);

  const rowStyle: React.CSSProperties = isSelectedDraft
    ? {
        background: VIOLET_TINT_SELECTED,
        outline: `2px solid ${VIOLET_OUTLINE}`,
      }
    : {
        background: 'transparent',
      };

  return (
    <div
      className="flex items-start gap-3 p-2 rounded-lg transition-all duration-200"
      style={rowStyle}
      onMouseEnter={(e) => {
        if (!isSelectedDraft) {
          (e.currentTarget as HTMLDivElement).style.background = VIOLET_HOVER_TINT;
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelectedDraft) {
          (e.currentTarget as HTMLDivElement).style.background = 'transparent';
        }
      }}
    >
      <span
        className="flex-shrink-0 w-6 h-6 mt-0.5 rounded-full text-xs font-bold flex items-center justify-center"
        style={{ background: VIOLET_TINT_SOFT, color: 'var(--violet-500)' }}
      >
        {draftIndex + 1}
      </span>

      <button
        type="button"
        onClick={() => onClickThumbnail(draft.value)}
        className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden cursor-pointer transition-all"
        style={{
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-1)',
        }}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt={draft.label} className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ color: 'var(--text-3)' }}
          >
            <Palette className="w-5 h-5" />
          </div>
        )}
      </button>

      <ExpandableTagLabel text={draft.label} />

      {isSelectedDraft ? (
        <span
          className="flex-shrink-0 mt-0.5 flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium"
          style={{ background: 'var(--violet-500)', color: 'var(--text-on-brand)' }}
        >
          <Check className="w-3.5 h-3.5" /> {t('draftSelection.selected')}
        </span>
      ) : !disabled ? (
        <button
          type="button"
          onClick={() => onSelectDraft(draft.value)}
          className="flex-shrink-0 mt-0.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150"
          style={{ background: 'var(--violet-500)', color: 'var(--text-on-brand)' }}
        >
          {t('draftSelection.select')}
        </button>
      ) : null}
    </div>
  );
}

interface ImageQuestionBlockProps {
  options: ImageOption[];
  selectedValue: string | undefined;
  customText: string | undefined;
  disabled: boolean;
  isLoading: boolean;
  allowFreeText?: boolean;
  allowRegenerate?: boolean;
  onSelectDraft: (value: string) => void;
  onFreeTextSubmit: (text: string) => void;
  onRegenerate: () => void;
  onThumbnailClick: (value: string) => void;
}

function ImageQuestionBlock({
  options,
  selectedValue,
  customText,
  disabled,
  isLoading,
  allowFreeText,
  allowRegenerate,
  onSelectDraft,
  onFreeTextSubmit,
  onRegenerate,
  onThumbnailClick,
}: ImageQuestionBlockProps) {
  const { t } = useTranslation('chat');
  const [freeText, setFreeText] = useState('');

  const handleFreeTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (freeText.trim()) onFreeTextSubmit(freeText.trim());
    }
  };

  const sendButtonEnabled = freeText.trim().length > 0 && !isLoading;

  return (
    <div className="space-y-2">
      {options.map((draft, idx) => (
        <DraftRow
          key={draft.value}
          draft={draft}
          draftIndex={idx}
          isSelectedDraft={selectedValue === draft.value}
          disabled={disabled}
          onClickThumbnail={onThumbnailClick}
          onSelectDraft={onSelectDraft}
        />
      ))}

      {disabled && customText ? (
        <div className="pt-2" style={{ borderTop: '1px solid var(--border-1)' }}>
          <div
            className="flex items-start gap-2 p-2 rounded-lg"
            style={{ background: VIOLET_TINT_SOFT }}
          >
            <MessageSquare
              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
              style={{ color: 'var(--violet-500)' }}
            />
            <span className="text-xs" style={{ color: 'var(--text-2)' }}>
              {customText}
            </span>
          </div>
        </div>
      ) : !disabled ? (
        <div
          className="pt-2 space-y-2"
          style={{ borderTop: '1px solid var(--border-1)' }}
        >
          {allowFreeText !== false && (
            <div className="flex gap-2">
              <input
                type="text"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={handleFreeTextKeyDown}
                placeholder={t('draftSelection.placeholder')}
                disabled={isLoading}
                className="flex-1 px-3 py-2 rounded-lg text-xs focus:outline-none disabled:opacity-50"
                style={{
                  background: 'var(--bg-surface)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--border-2)',
                }}
              />
              <button
                type="button"
                onClick={() => {
                  if (freeText.trim()) onFreeTextSubmit(freeText.trim());
                }}
                disabled={!sendButtonEnabled}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  sendButtonEnabled ? 'cursor-pointer' : 'cursor-not-allowed'
                }`}
                style={
                  sendButtonEnabled
                    ? {
                        background: 'var(--violet-500)',
                        color: 'var(--text-on-brand)',
                      }
                    : {
                        background: 'var(--bg-surface-2)',
                        color: 'var(--text-3)',
                      }
                }
              >
                {isLoading ? (
                  <Spinner size="md" tone="inverse" />
                ) : (
                  t('draftSelection.send')
                )}
              </button>
            </div>
          )}
          {allowRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'transparent',
                color: 'var(--text-2)',
                border: '1px solid var(--border-1)',
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('draftSelection.regenerate')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lightbox loader (loads full-size images before opening)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface LightboxLoaderProps {
  drafts: ImageOption[];
  startValue: string;
  onClose: () => void;
  onSelect: (value: string) => void;
  onError: () => void;
  disabled: boolean;
}

function LightboxLoader({
  drafts,
  startValue,
  onClose,
  onSelect,
  onError,
  disabled,
}: LightboxLoaderProps) {
  const imageUrls = drafts.map((d, i) => ({
    value: d.value,
    index: i,
    // eslint-disable-next-line react-hooks/rules-of-hooks
    objectUrl: useImagePreview(d.imagePath),
  }));

  const loaded = imageUrls.filter((i) => i.objectUrl != null) as Array<{
    value: string;
    index: number;
    objectUrl: string;
  }>;
  const startIndex = drafts.findIndex((d) => d.value === startValue);
  const targetReady = loaded.some((i) => i.value === startValue);

  useEffect(() => {
    if (targetReady) return;
    const timer = setTimeout(() => {
      if (!targetReady) onError();
    }, 3000);
    return () => clearTimeout(timer);
  }, [targetReady, onError]);

  if (!targetReady) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'oklch(from var(--text-on-brand) l c h / 0.0)' }}
      >
        <Spinner size="lg" tone="inverse" />
      </div>
    );
  }

  return (
    <DraftLightbox
      images={loaded.map((i) => ({ index: i.index, objectUrl: i.objectUrl }))}
      startIndex={startIndex >= 0 ? startIndex : 0}
      onClose={onClose}
      onSelect={(idx) => {
        const draft = drafts[idx];
        if (draft) onSelect(draft.value);
      }}
      disabled={disabled}
    />
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ClarifyingVariant — unified text + image clarify card
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function ClarifyingVariant({ presented, resolved }: VariantProps) {
  const { t } = useTranslation('chat');
  const { toast } = useToastContext();
  const selectedAgent = useStore((state) => state.selectedAgent);
  const selectedJobType = useStore((state) => state.selectedJobType);
  // Invariant I1 — when a non-task job (plan / visual) is paused on a
  // clarify card, runJob MUST forward THAT job's (jobType, agent) instead
  // of the store's selected* values, which may have drifted since the
  // card was issued.
  const pausedNonTask = useStore(selectPausedNonTaskJob);
  // D28-revised — workspace domain drives the clarify-card title copy
  // ("…for PRD" vs "…for GDD"). i18next resolves the `_game` variant
  // via `context: domain`.
  const clarifyDomain = useStore((state) => state.actionMetadata.domain);
  const pendingAnswers = useStore((state) => state.pendingClarifyAnswers);
  const setPendingClarifyAnswer = useStore((state) => state.setPendingClarifyAnswer);
  const setPendingClarifyContext = useStore((state) => state.setPendingClarifyContext);
  const clearPendingClarify = useStore((state) => state.clearPendingClarify);
  const { runJob } = useJobExecution();

  const enqueueAgent = pausedNonTask?.agent ?? selectedAgent;
  const enqueueJobType = pausedNonTask?.jobType ?? selectedJobType;

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStartValue, setLightboxStartValue] = useState('');

  const cardState = useChoiceCardState({ presented, resolved });

  const payload = (presented.payload ?? {}) as Record<string, any>;
  const answerMeta = (resolved?.answer ?? {}) as Record<string, any>;

  const blocks = useMemo(() => {
    return (payload.clarifyBlocks as any[]) || [];
  }, [payload.clarifyBlocks]);

  const hasImageBlocks = blocks.some((b: any) => blockHasImageOptions(b.options));
  const textBlocks = blocks.filter((b: any) => !blockHasImageOptions(b.options));
  const totalTextQuestions = textBlocks.length;

  const answeredCount = Object.keys(pendingAnswers).filter(
    (k) => Number(k) < totalTextQuestions && pendingAnswers[Number(k)],
  ).length;
  const allAnswered = totalTextQuestions > 0 && answeredCount === totalTextQuestions;
  const hasAnyAnswer = answeredCount > 0;

  // Only register text blocks as pending clarify context (image blocks
  // use auto-submit and do not surface in the chat-input clarify
  // affordance).
  useEffect(() => {
    if (textBlocks.length > 0 && !cardState.isSelected) {
      setPendingClarifyContext(textBlocks.map((b: any) => b.question));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOptionSelect = (questionIndex: number, answer: string) => {
    setPendingClarifyAnswer(questionIndex, answer);
  };

  // Compound submit for text blocks.
  const handleSubmitAll = async () => {
    if (
      !cardState.selectedProject ||
      !cardState.selectedFeature ||
      cardState.isSelected ||
      !hasAnyAnswer
    )
      return;

    cardState.setIsLoading(true);

    const parts = Object.entries(pendingAnswers)
      .sort(([a], [b]) => Number(a) - Number(b))
      .filter(([idx]) => Number(idx) < totalTextQuestions)
      .map(([idx, answer]) => `- ${textBlocks[Number(idx)].question}: ${answer}`);
    const directive = parts.join('\n');

    const resolvedAnswers: Record<number, string> = {};
    Object.entries(pendingAnswers).forEach(([idx, answer]) => {
      if (Number(idx) < totalTextQuestions) resolvedAnswers[Number(idx)] = answer;
    });

    const label = allAnswered
      ? t('clarify.resolvedAll', { total: totalTextQuestions })
      : t('clarify.resolvedPartial', { answered: answeredCount, total: totalTextQuestions });
    cardState.setLocalSelectedChoice('submitted');
    cardState.setLocalResolvedLabel(label);

    await cardState.persistToBackend('submitted', label, { resolvedAnswers });

    try {
      clearPendingClarify();
      await runJob(enqueueAgent, enqueueJobType, directive);
    } catch (error) {
      console.error('[ChoiceCard:Clarifying] Failed:', error);
    } finally {
      cardState.setIsLoading(false);
    }
  };

  // Auto-submit handlers for image blocks.
  const handleSelectDraft = async (value: string) => {
    if (!cardState.selectedProject || !cardState.selectedFeature || cardState.isSelected) return;

    cardState.setIsLoading(true);
    const sketchIndex = parseInt(value.replace('sketch_', ''), 10);
    const label = t('draftSelection.draftSelected', { number: sketchIndex + 1 });
    cardState.setLocalSelectedChoice(value);
    cardState.setLocalResolvedLabel(label);
    await cardState.persistToBackend(value, label, { selectedSketchIndex: sketchIndex });

    setLightboxOpen(false);

    try {
      clearPendingClarify();
      await runJob(enqueueAgent, enqueueJobType, `[SKETCH_FINALIZE:${sketchIndex}]`);
    } catch (error) {
      console.error('[ChoiceCard:Clarifying] Sketch select failed:', error);
    } finally {
      cardState.setIsLoading(false);
    }
  };

  const handleFreeTextSubmit = async (text: string) => {
    if (!cardState.selectedProject || !cardState.selectedFeature || cardState.isSelected) return;

    cardState.setIsLoading(true);
    const displayText = `${text.substring(0, 40)}${text.length > 40 ? '...' : ''}`;
    const label = t('draftSelection.customLabel', { text: displayText });
    cardState.setLocalSelectedChoice('custom');
    cardState.setLocalResolvedLabel(label);

    await cardState.persistToBackend('custom', label, { customText: text });

    try {
      clearPendingClarify();
      await runJob(enqueueAgent, enqueueJobType, `[SKETCH_FEEDBACK] ${text}`);
    } catch (error) {
      console.error('[ChoiceCard:Clarifying] Custom input failed:', error);
    } finally {
      cardState.setIsLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!cardState.selectedProject || !cardState.selectedFeature || cardState.isSelected) return;

    cardState.setIsLoading(true);
    const label = t('draftSelection.regenerateLabel');
    cardState.setLocalSelectedChoice('regenerate');
    cardState.setLocalResolvedLabel(label);
    await cardState.persistToBackend('regenerate', label, {});

    try {
      clearPendingClarify();
      await runJob(enqueueAgent, enqueueJobType, '[SKETCH_REGENERATE]');
    } catch (error) {
      console.error('[ChoiceCard:Clarifying] Regenerate failed:', error);
    } finally {
      cardState.setIsLoading(false);
    }
  };

  const handleThumbnailClick = (value: string) => {
    setLightboxStartValue(value);
    setLightboxOpen(true);
  };

  const handleImageLoadError = useCallback(() => {
    setLightboxOpen(false);
    toast.error(t('draftSelection.imageNotFound'));
  }, [t, toast]);

  // Title and theme based on content mix.
  const isImageMode = hasImageBlocks && textBlocks.length === 0;
  const title = isImageMode
    ? t('draftSelection.title', { count: blocks[0]?.options?.length || 0 })
    : totalTextQuestions === 1
      ? textBlocks[0]?.question
      : t('clarify.title', { count: totalTextQuestions, context: clarifyDomain });

  const resolvedAnswers: Record<number, string> | undefined = answerMeta.resolvedAnswers as
    | Record<number, string>
    | undefined;
  const isResolved = cardState.isSelected && !!resolvedAnswers;

  const selectedValue =
    answerMeta.selectedSketchIndex != null
      ? `sketch_${answerMeta.selectedSketchIndex}`
      : cardState.selectedChoice || undefined;
  const customText: string | undefined = answerMeta.customText as string | undefined;

  // All image options flattened (for lightbox).
  const allImageOptions = useMemo(() => {
    return blocks
      .filter((b: any) => blockHasImageOptions(b.options))
      .flatMap((b: any) => b.options.filter(isImageOption));
  }, [blocks]) as ImageOption[];

  return (
    <>
      <ChoiceCardShell
        theme="violet"
        icon={isImageMode ? <Palette className="w-4 h-4" /> : <span className="text-sm">💬</span>}
        title={title || ''}
        subtitle={isImageMode ? t('draftSelection.subtitle') : undefined}
        isSelected={cardState.isSelected}
        resolvedLabel={
          cardState.isSelected && !resolvedAnswers && !isImageMode
            ? cardState.resolvedLabel
            : null
        }
        resolvedIcon={null}
      >
        <div className="space-y-4">
          {blocks.map((block: any, idx: number) => {
            if (blockHasImageOptions(block.options)) {
              return (
                <ImageQuestionBlock
                  key={idx}
                  options={block.options.filter(isImageOption)}
                  selectedValue={selectedValue}
                  customText={customText}
                  disabled={cardState.isLoading || cardState.isSelected}
                  isLoading={cardState.isLoading}
                  allowFreeText={block.allowFreeText}
                  allowRegenerate={block.allowRegenerate}
                  onSelectDraft={handleSelectDraft}
                  onFreeTextSubmit={handleFreeTextSubmit}
                  onRegenerate={handleRegenerate}
                  onThumbnailClick={handleThumbnailClick}
                />
              );
            }

            const textIdx = textBlocks.indexOf(block);
            const resolvedAnswer = isResolved
              ? (resolvedAnswers![textIdx] ?? null)
              : undefined;
            return (
              <TextQuestionBlock
                key={idx}
                questionIndex={textIdx}
                question={totalTextQuestions === 1 ? '' : block.question}
                options={block.options as string[]}
                selectedAnswer={pendingAnswers[textIdx]}
                disabled={cardState.isLoading || cardState.isSelected}
                resolvedAnswer={resolvedAnswer}
                onSelect={handleOptionSelect}
              />
            );
          })}

          {/* Submit button for text-only blocks */}
          {totalTextQuestions > 0 && !isResolved && !cardState.isSelected && (
            <div className="pt-2" style={{ borderTop: '1px solid var(--border-1)' }}>
              <button
                type="button"
                onClick={handleSubmitAll}
                disabled={!hasAnyAnswer || cardState.isLoading || cardState.isSelected}
                className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${
                  hasAnyAnswer && !cardState.isLoading ? 'cursor-pointer' : 'cursor-not-allowed'
                } ${cardState.isLoading ? 'opacity-50' : ''}`}
                style={
                  hasAnyAnswer
                    ? {
                        background: 'var(--violet-500)',
                        color: 'var(--text-on-brand)',
                      }
                    : {
                        background: 'var(--bg-surface-2)',
                        color: 'var(--text-3)',
                      }
                }
              >
                {cardState.isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner size="md" tone="inverse" />
                    {t('clarify.submitting')}
                  </span>
                ) : allAnswered ? (
                  t('clarify.submitAll', {
                    answered: totalTextQuestions,
                    total: totalTextQuestions,
                  })
                ) : hasAnyAnswer ? (
                  t('clarify.submitPartial', {
                    answered: answeredCount,
                    total: totalTextQuestions,
                  })
                ) : (
                  t('clarify.submitEmpty', { total: totalTextQuestions })
                )}
              </button>
              {hasAnyAnswer && !allAnswered && (
                <p
                  className="text-xs text-center mt-1.5"
                  style={{ color: 'var(--text-3)' }}
                >
                  {t('clarify.partialHint')}
                </p>
              )}
            </div>
          )}
        </div>
      </ChoiceCardShell>

      {lightboxOpen && allImageOptions.length > 0 && (
        <LightboxLoader
          drafts={allImageOptions}
          startValue={lightboxStartValue}
          onClose={() => setLightboxOpen(false)}
          onSelect={handleSelectDraft}
          onError={handleImageLoadError}
          disabled={cardState.isLoading || cardState.isSelected}
        />
      )}
    </>
  );
}
