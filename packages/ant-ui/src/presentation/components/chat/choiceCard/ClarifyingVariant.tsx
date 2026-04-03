import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Palette, Check, MessageSquare, RefreshCw } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import type { MessageContent } from '@/domain/models/chat';
import { useImagePreview } from '../useImagePreview';
import { DraftLightbox } from '../ImageLightbox';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell } from './shared';

type ImageOption = { label: string; imagePath: string; thumbnailPath: string; value: string };
type BlockOption = string | ImageOption;

function isImageOption(opt: BlockOption): opt is ImageOption {
  return typeof opt === 'object' && 'imagePath' in opt;
}

function blockHasImageOptions(options: BlockOption[]): boolean {
  return options.length > 0 && isImageOption(options[0]);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Text option block (existing behavior — planner / design)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TextQuestionBlock({
  questionIndex,
  question,
  options,
  selectedAnswer,
  disabled,
  resolvedAnswer,
  onSelect,
}: {
  questionIndex: number;
  question: string;
  options: string[];
  selectedAnswer: string | undefined;
  disabled: boolean;
  resolvedAnswer?: string | null;
  onSelect: (index: number, answer: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [showFreeInput, setShowFreeInput] = useState(false);
  const [freeText, setFreeText] = useState('');
  const isFreeInputActive = showFreeInput || (selectedAnswer != null && !options.includes(selectedAnswer));

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

  if (resolvedAnswer !== undefined) {
    const isSkipped = resolvedAnswer === null;
    return (
      <div className="space-y-1.5">
        {question && (
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            Q{questionIndex + 1}: {question}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {isSkipped ? (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 italic">
              {t('clarify.skipped')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
              <span className="text-violet-500">✓</span>
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
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          Q{questionIndex + 1}: {question}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {options.map((option, idx) => {
          const isActive = selectedAnswer === option && !isFreeInputActive;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleOptionClick(option)}
              disabled={disabled}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150
                ${isActive
                  ? 'bg-violet-500 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 hover:text-violet-700 dark:hover:text-violet-300'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
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
              value={freeText || (selectedAnswer && !options.includes(selectedAnswer) ? selectedAnswer : '')}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={handleFreeTextKeyDown}
              onBlur={() => { if (freeText.trim()) handleFreeTextConfirm(); }}
              placeholder={t('clarify.freeInput')}
              disabled={disabled}
              className="flex-1 px-3 py-1.5 rounded-md text-xs border border-violet-300 dark:border-violet-600 
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         focus:outline-none focus:ring-1 focus:ring-violet-400
                         disabled:opacity-50"
            />
            {selectedAnswer && !options.includes(selectedAnswer) && (
              <span className="flex items-center text-xs text-violet-500 font-medium px-1">✓</span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleFreeInputToggle}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150
              bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400
              border border-dashed border-gray-300 dark:border-gray-600
              hover:border-violet-300 dark:hover:border-violet-600 hover:text-violet-600 dark:hover:text-violet-400
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
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

function DraftRow({
  draft,
  isSelectedDraft,
  disabled,
  onClickThumbnail,
  onSelectDraft,
}: {
  draft: ImageOption;
  isSelectedDraft: boolean;
  disabled: boolean;
  onClickThumbnail: (value: string) => void;
  onSelectDraft: (value: string) => void;
}) {
  const { t } = useTranslation('chat');
  const thumbUrl = useImagePreview(draft.thumbnailPath);

  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-200
        ${isSelectedDraft
          ? 'bg-violet-100/60 dark:bg-violet-900/20 ring-2 ring-violet-400'
          : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
    >
      <button
        type="button"
        onClick={() => onClickThumbnail(draft.value)}
        className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-700 cursor-pointer hover:ring-2 hover:ring-violet-300 transition-all"
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt={draft.label} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <Palette className="w-5 h-5" />
          </div>
        )}
      </button>

      <span className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300">
        {draft.label}
      </span>

      {isSelectedDraft ? (
        <span className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-500 text-white">
          <Check className="w-3.5 h-3.5" /> {t('draftSelection.selected')}
        </span>
      ) : !disabled ? (
        <button
          type="button"
          onClick={() => onSelectDraft(draft.value)}
          className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150
            bg-violet-500 hover:bg-violet-600 text-white hover:shadow-md"
        >
          {t('draftSelection.select')}
        </button>
      ) : null}
    </div>
  );
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
}: {
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
}) {
  const { t } = useTranslation('chat');
  const [freeText, setFreeText] = useState('');

  const handleFreeTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (freeText.trim()) onFreeTextSubmit(freeText.trim());
    }
  };

  return (
    <div className="space-y-2">
      {options.map(draft => (
        <DraftRow
          key={draft.value}
          draft={draft}
          isSelectedDraft={selectedValue === draft.value}
          disabled={disabled}
          onClickThumbnail={onThumbnailClick}
          onSelectDraft={onSelectDraft}
        />
      ))}

      {disabled && customText ? (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-2 p-2 rounded-lg bg-violet-50 dark:bg-violet-900/20">
            <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-violet-500 flex-shrink-0" />
            <span className="text-xs text-gray-700 dark:text-gray-300">{customText}</span>
          </div>
        </div>
      ) : !disabled ? (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
          {(allowFreeText !== false) && (
            <div className="flex gap-2">
              <input
                type="text"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={handleFreeTextKeyDown}
                placeholder={t('draftSelection.placeholder')}
                disabled={isLoading}
                className="flex-1 px-3 py-2 rounded-lg text-xs border border-violet-300 dark:border-violet-600
                  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                  focus:outline-none focus:ring-1 focus:ring-violet-400
                  disabled:opacity-50 placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={() => { if (freeText.trim()) onFreeTextSubmit(freeText.trim()); }}
                disabled={!freeText.trim() || isLoading}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200
                  ${freeText.trim()
                    ? 'bg-violet-500 hover:bg-violet-600 text-white hover:shadow-md'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  }
                  ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
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
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium
                transition-all duration-200 border border-gray-300 dark:border-gray-600
                text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50
                disabled:opacity-50 disabled:cursor-not-allowed"
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

function LightboxLoader({
  drafts,
  startValue,
  onClose,
  onSelect,
  onError,
  disabled,
}: {
  drafts: ImageOption[];
  startValue: string;
  onClose: () => void;
  onSelect: (value: string) => void;
  onError: () => void;
  disabled: boolean;
}) {
  const imageUrls = drafts.map(d => ({
    value: d.value,
    index: drafts.indexOf(d),
    // eslint-disable-next-line react-hooks/rules-of-hooks
    objectUrl: useImagePreview(d.imagePath),
  }));

  const loaded = imageUrls.filter(i => i.objectUrl != null) as Array<{ value: string; index: number; objectUrl: string }>;
  const startIndex = drafts.findIndex(d => d.value === startValue);
  const targetReady = loaded.some(i => i.value === startValue);

  useEffect(() => {
    if (targetReady) return;
    const timer = setTimeout(() => {
      if (!targetReady) onError();
    }, 3000);
    return () => clearTimeout(timer);
  }, [targetReady, onError]);

  if (!targetReady) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <DraftLightbox
      images={loaded.map(i => ({ index: i.index, objectUrl: i.objectUrl }))}
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

export function ClarifyingVariant({ content, messageId }: VariantProps) {
  const { t } = useTranslation('chat');
  const { toast } = useToastContext();
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedJobType = useStore(state => state.selectedJobType);
  const pendingAnswers = useStore(state => state.pendingClarifyAnswers);
  const setPendingClarifyAnswer = useStore(state => state.setPendingClarifyAnswer);
  const setPendingClarifyContext = useStore(state => state.setPendingClarifyContext);
  const clearPendingClarify = useStore(state => state.clearPendingClarify);
  const chatMessages = useStore(state => state.chatMessages);
  const updateChatMessage = useStore(state => state.updateChatMessage);
  const { runJob } = useJobExecution();

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStartValue, setLightboxStartValue] = useState('');

  const cardState = useChoiceCardState({
    content, messageId,
    contentType: 'choice_card',
    contentFilter: (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'clarifying',
    metadataFilter: { cardType: 'clarifying' },
  });

  const blocks = useMemo(() => {
    return content.metadata?.clarifyBlocks || [];
  }, [content.metadata?.clarifyBlocks]);

  const hasImageBlocks = blocks.some((b: any) => blockHasImageOptions(b.options));
  const textBlocks = blocks.filter((b: any) => !blockHasImageOptions(b.options));
  const totalTextQuestions = textBlocks.length;

  const answeredCount = Object.keys(pendingAnswers).filter(
    k => Number(k) < totalTextQuestions && pendingAnswers[Number(k)]
  ).length;
  const allAnswered = answeredCount === totalTextQuestions;
  const hasAnyAnswer = answeredCount > 0;

  // Only register text blocks as pending clarify context (image blocks use auto-submit)
  useEffect(() => {
    if (textBlocks.length > 0 && !cardState.isSelected) {
      setPendingClarifyContext(textBlocks.map((b: any) => b.question));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOptionSelect = (questionIndex: number, answer: string) => {
    setPendingClarifyAnswer(questionIndex, answer);
  };

  // Compound submit for text blocks
  const handleSubmitAll = async () => {
    if (!cardState.selectedProject || !cardState.selectedFeature || cardState.isSelected || !hasAnyAnswer) return;

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

    const message = chatMessages.find(m => m.id === messageId);
    if (message) {
      const matchFn = (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'clarifying';
      const contentIndex = message.contents.findIndex(matchFn);
      if (contentIndex !== -1) {
        const updatedContents = [...message.contents];
        updatedContents[contentIndex] = {
          ...updatedContents[contentIndex],
          metadata: {
            ...updatedContents[contentIndex].metadata,
            choiceSelected: 'submitted',
            resolvedLabel: label,
            resolvedAnswers,
          },
        };
        updateChatMessage(messageId, { contents: updatedContents });
      }
    }
    await cardState.persistToBackend('submitted', label, { resolvedAnswers });

    try {
      clearPendingClarify();
      await runJob(selectedAgent, selectedJobType, directive);
    } catch (error) {
      console.error('[ChoiceCard:Clarifying] Failed:', error);
    } finally {
      cardState.setIsLoading(false);
    }
  };

  // Auto-submit handlers for image blocks
  const handleSelectDraft = async (value: string) => {
    if (!cardState.selectedProject || !cardState.selectedFeature || cardState.isSelected) return;

    cardState.setIsLoading(true);
    const draftIndex = parseInt(value.replace('draft_', ''), 10);
    const label = t('draftSelection.draftSelected', { number: draftIndex + 1 });
    cardState.setLocalSelectedChoice(value);
    cardState.setLocalResolvedLabel(label);
    cardState.persistChoice(value, label);
    await cardState.persistToBackend(value, label, { selectedDraftIndex: draftIndex });

    setLightboxOpen(false);

    try {
      clearPendingClarify();
      await runJob(selectedAgent, selectedJobType, `[DRAFT_FINALIZE:${draftIndex}]`);
    } catch (error) {
      console.error('[ChoiceCard:Clarifying] Draft select failed:', error);
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

    const message = chatMessages.find(m => m.id === messageId);
    if (message) {
      const matchFn = (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'clarifying';
      const contentIndex = message.contents.findIndex(matchFn);
      if (contentIndex !== -1) {
        const updatedContents = [...message.contents];
        updatedContents[contentIndex] = {
          ...updatedContents[contentIndex],
          metadata: {
            ...updatedContents[contentIndex].metadata,
            choiceSelected: 'custom',
            resolvedLabel: label,
            customText: text,
          },
        };
        updateChatMessage(messageId, { contents: updatedContents });
      }
    }
    await cardState.persistToBackend('custom', label, { customText: text });

    try {
      clearPendingClarify();
      await runJob(selectedAgent, selectedJobType, `[DRAFT_FEEDBACK] ${text}`);
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
    cardState.persistChoice('regenerate', label);
    await cardState.persistToBackend('regenerate', label, {});

    try {
      clearPendingClarify();
      await runJob(selectedAgent, selectedJobType, '[DRAFT_REGENERATE]');
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

  // Determine title and theme based on content type
  const isImageMode = hasImageBlocks && textBlocks.length === 0;
  const title = isImageMode
    ? t('draftSelection.title', { count: blocks[0]?.options?.length || 0 })
    : totalTextQuestions === 1
      ? textBlocks[0]?.question
      : t('clarify.title', { count: totalTextQuestions });

  const resolvedAnswers: Record<number, string> | undefined = content.metadata?.resolvedAnswers;
  const isResolved = cardState.isSelected && !!resolvedAnswers;

  const selectedValue = content.metadata?.selectedDraftIndex != null
    ? `draft_${content.metadata.selectedDraftIndex}`
    : cardState.selectedChoice || undefined;
  const customText: string | undefined = content.metadata?.customText;

  // All image options flattened (for lightbox)
  const allImageOptions = useMemo(() => {
    return blocks
      .filter((b: any) => blockHasImageOptions(b.options))
      .flatMap((b: any) => b.options.filter(isImageOption));
  }, [blocks]);

  return (
    <>
      <ChoiceCardShell
        theme={isImageMode ? 'violet' : 'violet'}
        icon={isImageMode ? <Palette className="w-4 h-4" /> : <span className="text-sm">💬</span>}
        title={title}
        subtitle={isImageMode ? t('draftSelection.subtitle') : undefined}
        isSelected={cardState.isSelected}
        resolvedLabel={cardState.isSelected && !resolvedAnswers && !isImageMode ? cardState.resolvedLabel : null}
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
              ? (resolvedAnswers[textIdx] ?? null)
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
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={handleSubmitAll}
                disabled={!hasAnyAnswer || cardState.isLoading || cardState.isSelected}
                className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200
                  ${hasAnyAnswer
                    ? 'bg-violet-500 hover:bg-violet-600 text-white hover:shadow-md'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  }
                  ${cardState.isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {cardState.isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('clarify.submitting')}
                  </span>
                ) : allAnswered ? (
                  t('clarify.submitAll', { answered: totalTextQuestions, total: totalTextQuestions })
                ) : hasAnyAnswer ? (
                  t('clarify.submitPartial', { answered: answeredCount, total: totalTextQuestions })
                ) : (
                  t('clarify.submitEmpty', { total: totalTextQuestions })
                )}
              </button>
              {hasAnyAnswer && !allAnswered && (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-1.5">
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
