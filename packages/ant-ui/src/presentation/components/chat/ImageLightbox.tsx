/**
 * Lightbox components for full-screen image previews.
 *
 * BaseLightbox  — shared dialog shell (native <dialog>, backdrop, close button)
 * ImageLightbox — single image preview (used by WorkingCard for Figma screenshots)
 * DraftLightbox — carousel with navigation arrows, index indicator, and "Select this" action
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BaseLightbox
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface BaseLightboxProps {
  onClose: () => void;
  children: React.ReactNode;
}

function BaseLightbox({ onClose, children }: BaseLightboxProps) {
  const { t } = useTranslation('chat');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-0 w-screen h-screen max-w-none max-h-none bg-black/80 backdrop-blur-sm p-0 border-none outline-none"
      onClick={handleBackdropClick}
      onClose={onClose}
    >
      <div className="relative flex items-center justify-center w-full h-full p-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full transition-colors z-10"
          style={{
            background: 'oklch(from var(--text-on-brand) l c h / 0.1)',
            color: 'var(--text-on-brand)',
          }}
          aria-label={t('draftSelection.close')}
        >
          <X className="w-5 h-5" />
        </button>
        {children}
      </div>
    </dialog>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ImageLightbox (single image — Figma screenshots, etc.)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  return (
    <BaseLightbox onClose={onClose}>
      <img
        src={src}
        alt={alt || 'Preview'}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
      />
    </BaseLightbox>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DraftLightbox (carousel with navigation + select action)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface DraftLightboxProps {
  /** Object URLs for each draft (full-size images) */
  images: Array<{ index: number; objectUrl: string }>;
  /** Which draft to show initially */
  startIndex: number;
  onClose: () => void;
  onSelect: (draftIndex: number) => void;
  disabled?: boolean;
}

export function DraftLightbox({ images, startIndex, onClose, onSelect, disabled }: DraftLightboxProps) {
  const { t } = useTranslation('chat');

  // Track by image INDEX (logical identity), not array position.
  // images array grows as async loads complete — positional tracking would drift.
  const [currentIndex, setCurrentIndex] = useState(startIndex);

  const currentPos = images.findIndex(img => img.index === currentIndex);
  const safePos = currentPos >= 0 ? currentPos : 0;
  const current = images[safePos];
  const hasPrev = safePos > 0;
  const hasNext = safePos < images.length - 1;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && hasPrev) setCurrentIndex(images[safePos - 1].index);
      if (e.key === 'ArrowRight' && hasNext) setCurrentIndex(images[safePos + 1].index);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasPrev, hasNext, images, safePos]);

  if (!current) return null;

  return (
    <BaseLightbox onClose={onClose}>
      {hasPrev && (
        <button
          onClick={() => setCurrentIndex(images[safePos - 1].index)}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full transition-colors"
          style={{
            background: 'oklch(from var(--text-on-brand) l c h / 0.1)',
            color: 'var(--text-on-brand)',
          }}
          aria-label={t('draftSelection.previousDraft')}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      <div className="flex flex-col items-center gap-4 max-w-[90vw] max-h-[90vh]">
        <img
          src={current.objectUrl}
          alt={t('draftSelection.draftAlt', { number: current.index + 1 })}
          className="max-w-[85vw] max-h-[75vh] object-contain rounded-lg shadow-2xl"
        />

        <div className="flex items-center gap-4">
          <span
            className="text-sm font-medium"
            style={{ color: 'oklch(from var(--text-on-brand) l c h / 0.7)' }}
          >
            {safePos + 1} / {images.length}
          </span>
          {!disabled && (
            <button
              onClick={() => onSelect(current.index)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all duration-200"
              style={{
                background: 'var(--gradient-aurora)',
                color: 'var(--text-on-brand)',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <Check className="w-4 h-4" />
              {t('draftSelection.selectDraft', { number: current.index + 1 })}
            </button>
          )}
        </div>
      </div>

      {hasNext && (
        <button
          onClick={() => setCurrentIndex(images[safePos + 1].index)}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full transition-colors"
          style={{
            background: 'oklch(from var(--text-on-brand) l c h / 0.1)',
            color: 'var(--text-on-brand)',
          }}
          aria-label={t('draftSelection.nextDraft')}
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}
    </BaseLightbox>
  );
}
