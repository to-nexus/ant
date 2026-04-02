import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Palette, Check, MessageSquare } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import type { MessageContent } from '@/domain/models/chat';
import { useImagePreview } from '../useImagePreview';
import { DraftLightbox } from '../ImageLightbox';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell } from './shared';

function DraftRow({
  draft,
  isSelectedDraft,
  disabled,
  onClickThumbnail,
  onSelectDraft,
}: {
  draft: { index: number; imagePath: string; thumbnailPath: string };
  isSelectedDraft: boolean;
  disabled: boolean;
  onClickThumbnail: (draftIndex: number) => void;
  onSelectDraft: (draftIndex: number) => void;
}) {
  const { t } = useTranslation('chat');
  const thumbUrl = useImagePreview(draft.thumbnailPath);
  const draftNumber = draft.index + 1;

  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-200
        ${isSelectedDraft
          ? 'bg-teal-100/60 dark:bg-teal-900/20 ring-2 ring-teal-400'
          : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
    >
      <button
        type="button"
        onClick={() => onClickThumbnail(draft.index)}
        disabled={disabled}
        className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-700 cursor-pointer hover:ring-2 hover:ring-teal-300 transition-all"
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt={t('draftSelection.draftAlt', { number: draftNumber })} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <Palette className="w-5 h-5" />
          </div>
        )}
      </button>

      <span className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('draftSelection.draftLabel', { number: draftNumber })}
      </span>

      {isSelectedDraft ? (
        <span className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-teal-500 text-white">
          <Check className="w-3.5 h-3.5" /> {t('draftSelection.selected')}
        </span>
      ) : !disabled ? (
        <button
          type="button"
          onClick={() => onSelectDraft(draft.index)}
          className="px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150
            bg-teal-500 hover:bg-teal-600 text-white hover:shadow-md"
        >
          {t('draftSelection.select')}
        </button>
      ) : null}
    </div>
  );
}

export function DraftSelectionVariant({ content, messageId }: VariantProps) {
  const { t } = useTranslation('chat');
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedJobType = useStore(state => state.selectedJobType);
  const chatMessages = useStore(state => state.chatMessages);
  const updateChatMessage = useStore(state => state.updateChatMessage);
  const { runJob } = useJobExecution();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStartIndex, setLightboxStartIndex] = useState(0);
  const [freeText, setFreeText] = useState('');

  const cardState = useChoiceCardState({
    content, messageId,
    contentType: 'choice_card',
    contentFilter: (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'draft_selection',
    metadataFilter: { cardType: 'draft_selection' },
  });

  const drafts: Array<{ index: number; imagePath: string; thumbnailPath: string }> =
    content.metadata?.drafts || [];

  const selectedDraftIndex: number | undefined = content.metadata?.selectedDraftIndex ?? undefined;
  const customText: string | undefined = content.metadata?.customText;

  const handleSelectDraft = async (draftIndex: number) => {
    if (!cardState.selectedProject || !cardState.selectedFeature || cardState.isSelected) return;

    cardState.setIsLoading(true);
    const label = t('draftSelection.draftSelected', { number: draftIndex + 1 });
    cardState.setLocalSelectedChoice(`draft_${draftIndex}`);
    cardState.setLocalResolvedLabel(label);
    cardState.persistChoice(`draft_${draftIndex}`, label);
    await cardState.persistToBackend(`draft_${draftIndex}`, label, { selectedDraftIndex: draftIndex });

    setLightboxOpen(false);

    try {
      await runJob(selectedAgent, selectedJobType, `Selected draft ${draftIndex + 1} for final rendering`);
    } catch (error) {
      console.error('[ChoiceCard:DraftSelection] Failed:', error);
    } finally {
      cardState.setIsLoading(false);
    }
  };

  const handleFreeTextSubmit = async () => {
    if (!freeText.trim() || !cardState.selectedProject || !cardState.selectedFeature || cardState.isSelected) return;

    cardState.setIsLoading(true);
    const trimmed = freeText.trim();
    const displayText = `${trimmed.substring(0, 40)}${trimmed.length > 40 ? '...' : ''}`;
    const label = t('draftSelection.customLabel', { text: displayText });
    cardState.setLocalSelectedChoice('custom');
    cardState.setLocalResolvedLabel(label);

    const message = chatMessages.find(m => m.id === messageId);
    if (message) {
      const matchFn = (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'draft_selection';
      const contentIndex = message.contents.findIndex(matchFn);
      if (contentIndex !== -1) {
        const updatedContents = [...message.contents];
        updatedContents[contentIndex] = {
          ...updatedContents[contentIndex],
          metadata: {
            ...updatedContents[contentIndex].metadata,
            choiceSelected: 'custom',
            resolvedLabel: label,
            customText: trimmed,
          },
        };
        updateChatMessage(messageId, { contents: updatedContents });
      }
    }
    await cardState.persistToBackend('custom', label, { customText: trimmed });

    try {
      await runJob(selectedAgent, selectedJobType, trimmed);
    } catch (error) {
      console.error('[ChoiceCard:DraftSelection] Custom input failed:', error);
    } finally {
      cardState.setIsLoading(false);
    }
  };

  const handleFreeTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFreeTextSubmit();
    }
  };

  const handleThumbnailClick = (draftIndex: number) => {
    setLightboxStartIndex(draftIndex);
    setLightboxOpen(true);
  };

  const title = t('draftSelection.title', { count: drafts.length });

  return (
    <>
      <ChoiceCardShell
        theme="teal"
        icon={<Palette className="w-4 h-4" />}
        title={title}
        subtitle={t('draftSelection.subtitle')}
        isSelected={cardState.isSelected}
        resolvedLabel={null}
        resolvedIcon={null}
      >
        <div className="space-y-2">
          {drafts.map(draft => (
            <DraftRow
              key={draft.index}
              draft={draft}
              isSelectedDraft={selectedDraftIndex === draft.index || cardState.selectedChoice === `draft_${draft.index}`}
              disabled={cardState.isLoading || cardState.isSelected}
              onClickThumbnail={handleThumbnailClick}
              onSelectDraft={handleSelectDraft}
            />
          ))}

          {cardState.isSelected && customText ? (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-start gap-2 p-2 rounded-lg bg-teal-50 dark:bg-teal-900/20">
                <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-teal-500 flex-shrink-0" />
                <span className="text-xs text-gray-700 dark:text-gray-300">{customText}</span>
              </div>
            </div>
          ) : !cardState.isSelected ? (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  onKeyDown={handleFreeTextKeyDown}
                  placeholder={t('draftSelection.placeholder')}
                  disabled={cardState.isLoading || cardState.isSelected}
                  className="flex-1 px-3 py-2 rounded-lg text-xs border border-teal-300 dark:border-teal-600
                    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                    focus:outline-none focus:ring-1 focus:ring-teal-400
                    disabled:opacity-50 placeholder:text-gray-400"
                />
                <button
                  type="button"
                  onClick={handleFreeTextSubmit}
                  disabled={!freeText.trim() || cardState.isLoading || cardState.isSelected}
                  className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200
                    ${freeText.trim()
                      ? 'bg-teal-500 hover:bg-teal-600 text-white hover:shadow-md'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    }
                    ${cardState.isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {cardState.isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    t('draftSelection.send')
                  )}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </ChoiceCardShell>

      {lightboxOpen && (
        <DraftLightboxLoader
          drafts={drafts}
          startIndex={lightboxStartIndex}
          onClose={() => setLightboxOpen(false)}
          onSelect={handleSelectDraft}
          disabled={cardState.isLoading || cardState.isSelected}
        />
      )}
    </>
  );
}

/**
 * Loads full-size object URLs via useImagePreview (one per draft) then opens the lightbox.
 * The number of drafts is stable per card, so calling hooks in a map is safe.
 */
function DraftLightboxLoader({
  drafts,
  startIndex,
  onClose,
  onSelect,
  disabled,
}: {
  drafts: Array<{ index: number; imagePath: string; thumbnailPath: string }>;
  startIndex: number;
  onClose: () => void;
  onSelect: (draftIndex: number) => void;
  disabled: boolean;
}) {
  const imageUrls = drafts.map(d => ({
    index: d.index,
    // eslint-disable-next-line react-hooks/rules-of-hooks
    objectUrl: useImagePreview(d.imagePath),
  }));

  const loaded = imageUrls.filter(i => i.objectUrl != null) as Array<{ index: number; objectUrl: string }>;
  const targetReady = loaded.some(i => i.index === startIndex);

  if (!targetReady) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <DraftLightbox
      images={loaded}
      startIndex={startIndex}
      onClose={onClose}
      onSelect={onSelect}
      disabled={disabled}
    />
  );
}
