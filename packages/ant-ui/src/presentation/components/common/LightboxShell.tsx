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
  children: React.ReactNode;
}

export function LightboxShell({ onClose, closeLabel, layout = 'center', children }: LightboxShellProps) {
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
      className="fixed inset-0 m-0 w-screen h-screen max-w-none max-h-none bg-black/80 backdrop-blur-sm p-0 border-none outline-none"
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
          style={{
            background: 'oklch(from var(--text-on-brand) l c h / 0.1)',
            color: 'var(--text-on-brand)',
          }}
          aria-label={closeLabel}
        >
          <X className="w-5 h-5" />
        </button>
        {children}
      </div>
    </dialog>
  );
}
