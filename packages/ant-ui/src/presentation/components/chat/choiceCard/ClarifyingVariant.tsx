import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import type { MessageContent } from '@/domain/models/chat';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell } from './shared';

/**
 * Single question block inside the compound card.
 */
function ClarifyQuestionBlock({
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

export function ClarifyingVariant({ content, messageId }: VariantProps) {
  const { t } = useTranslation('chat');
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedJobType = useStore(state => state.selectedJobType);
  const pendingAnswers = useStore(state => state.pendingClarifyAnswers);
  const setPendingClarifyAnswer = useStore(state => state.setPendingClarifyAnswer);
  const setPendingClarifyContext = useStore(state => state.setPendingClarifyContext);
  const clearPendingClarify = useStore(state => state.clearPendingClarify);
  const chatMessages = useStore(state => state.chatMessages);
  const updateChatMessage = useStore(state => state.updateChatMessage);
  const { runJob } = useJobExecution();

  const cardState = useChoiceCardState({
    content, messageId,
    contentType: 'choice_card',
    contentFilter: (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'clarifying',
    metadataFilter: { cardType: 'clarifying' },
  });

  const blocks = content.metadata?.clarifyBlocks || [];
  const totalQuestions = blocks.length;
  const answeredCount = Object.keys(pendingAnswers).filter(
    k => Number(k) < totalQuestions && pendingAnswers[Number(k)]
  ).length;
  const allAnswered = answeredCount === totalQuestions;
  const hasAnyAnswer = answeredCount > 0;

  useEffect(() => {
    if (blocks.length > 0 && !cardState.isSelected) {
      setPendingClarifyContext(blocks.map((b: { question: string }) => b.question));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOptionSelect = (questionIndex: number, answer: string) => {
    setPendingClarifyAnswer(questionIndex, answer);
  };

  const handleSubmitAll = async () => {
    if (!cardState.selectedProject || !cardState.selectedFeature || cardState.isSelected || !hasAnyAnswer) return;

    cardState.setIsLoading(true);

    const parts = Object.entries(pendingAnswers)
      .sort(([a], [b]) => Number(a) - Number(b))
      .filter(([idx]) => Number(idx) < totalQuestions)
      .map(([idx, answer]) => `- ${blocks[Number(idx)].question}: ${answer}`);
    const directive = parts.join('\n');

    const resolvedAnswers: Record<number, string> = {};
    Object.entries(pendingAnswers).forEach(([idx, answer]) => {
      if (Number(idx) < totalQuestions) resolvedAnswers[Number(idx)] = answer;
    });

    const label = allAnswered
      ? t('clarify.resolvedAll', { total: totalQuestions })
      : t('clarify.resolvedPartial', { answered: answeredCount, total: totalQuestions });
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

  const title = totalQuestions === 1
    ? blocks[0].question
    : t('clarify.title', { count: totalQuestions });

  const resolvedAnswers: Record<number, string> | undefined = content.metadata?.resolvedAnswers;
  const isResolved = cardState.isSelected && !!resolvedAnswers;

  return (
    <ChoiceCardShell
      theme="violet"
      icon={<span className="text-sm">💬</span>}
      title={title}
      isSelected={cardState.isSelected}
      resolvedLabel={cardState.isSelected && !resolvedAnswers ? cardState.resolvedLabel : null}
      resolvedIcon={null}
    >
      <div className="space-y-4">
        {blocks.map((block: { question: string; options: string[] }, idx: number) => {
          const resolvedAnswer = isResolved
            ? (resolvedAnswers[idx] ?? null)
            : undefined;
          return (
            <ClarifyQuestionBlock
              key={idx}
              questionIndex={idx}
              question={totalQuestions === 1 ? '' : block.question}
              options={block.options}
              selectedAnswer={pendingAnswers[idx]}
              disabled={cardState.isLoading || cardState.isSelected}
              resolvedAnswer={resolvedAnswer}
              onSelect={handleOptionSelect}
            />
          );
        })}

        {!isResolved && (
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
                t('clarify.submitAll', { answered: totalQuestions, total: totalQuestions })
              ) : hasAnyAnswer ? (
                t('clarify.submitPartial', { answered: answeredCount, total: totalQuestions })
              ) : (
                t('clarify.submitEmpty', { total: totalQuestions })
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
  );
}
