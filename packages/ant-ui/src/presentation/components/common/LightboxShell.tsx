/**
 * LightboxShell — the full-viewport <dialog> shell shared by every lightbox.
 *
 * Native <dialog> + showModal() is deliberate: it provides the top layer (no
 * z-index competition), Escape-to-close, a real focus trap, and focus restoration
 * to the previously-focused element on close — none of which we implement ourselves.
 *
 * `closeLabel` is a prop rather than a useTranslation call so i18n namespace
 * ownership stays with the consumer.
 */

import { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface LightboxShellProps {
  onClose: () => void;
  /** aria-label for the built-in close button. */
  closeLabel: string;
  /**
   * 'center' — content is centered with padding (image previews).
   * 'bleed'  — the child owns the whole area (pan surfaces with their own toolbar).
   */
  layout?: 'center' | 'bleed';
  /**
   * 'dark'   — neutral dark scrim, the conventional photo-viewer backdrop.
   * 'canvas' — tinted with the app canvas so the overlay reads as the same workspace
   *            rather than a foreign window. Also flips the close button to theme
   *            colors, since --text-on-brand is #ffffff in both themes and would
   *            disappear on a light canvas.
   */
  scrim?: 'dark' | 'canvas';
  children: React.ReactNode;
}

const SCRIM_CLASS: Record<NonNullable<LightboxShellProps['scrim']>, string> = {
  dark: 'bg-black/80 backdrop-blur-sm',
  canvas: 'backdrop-blur-md',
};

export function LightboxShell({
  onClose,
  closeLabel,
  layout = 'center',
  scrim = 'dark',
  children,
}: LightboxShellProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  // The dialog element IS the scrim, so a click landing on it (rather than on a
  // descendant) is a backdrop click.
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      className={`fixed inset-0 m-0 w-screen h-screen max-w-none max-h-none p-0 border-none outline-none ${SCRIM_CLASS[scrim]}`}
      style={
        scrim === 'canvas'
          ? { background: 'oklch(from var(--bg-canvas) l c h / 0.94)' }
          : undefined
      }
      onClick={handleBackdropClick}
      onClose={onClose}
    >
      <div
        className={
          layout === 'bleed'
            ? 'relative w-full h-full'
            : 'relative flex items-center justify-center w-full h-full p-8'
        }
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full transition-colors z-10"
          style={
            scrim === 'canvas'
              ? {
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-1)',
                  color: 'var(--text-2)',
                }
              : {
                  background: 'oklch(from var(--text-on-brand) l c h / 0.1)',
                  color: 'var(--text-on-brand)',
                }
          }
          aria-label={closeLabel}
        >
          <X className="w-5 h-5" />
        </button>
        {children}
      </div>
    </dialog>
  );
}
