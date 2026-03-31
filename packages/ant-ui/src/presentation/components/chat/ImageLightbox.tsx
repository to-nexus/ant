/**
 * ImageLightbox — Full-screen modal overlay for expanding chat image previews.
 *
 * Opens via native <dialog> (top-layer, no z-index wars).
 * Click backdrop or press Escape to close.
 */

import { useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
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
      <div className="flex items-center justify-center w-full h-full p-8">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
        <img
          src={src}
          alt={alt || 'Preview'}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        />
      </div>
    </dialog>
  );
}
