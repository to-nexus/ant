import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Modal } from './Modal';

export type ConflictAction = 'overwrite' | 'copy';
export type ConflictResolution =
  | 'cancel'
  | { perFile: Record<string, ConflictAction> };

export interface UploadConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflictingFiles: string[];
  onResolve: (resolution: ConflictResolution) => void;
}

export function UploadConflictModal({
  isOpen,
  onClose,
  conflictingFiles,
  onResolve,
}: UploadConflictModalProps) {
  const { t } = useTranslation('artifacts');
  const overwriteBtnRef = useRef<HTMLButtonElement>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [applyToAll, setApplyToAll] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, ConflictAction>>({});

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0);
      setApplyToAll(false);
      setDecisions({});
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && overwriteBtnRef.current) {
      const timer = setTimeout(() => overwriteBtnRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentIndex]);

  const handleCancel = useCallback(() => {
    onResolve('cancel');
    onClose();
  }, [onResolve, onClose]);

  const handleAction = useCallback((action: ConflictAction) => {
    const remaining = conflictingFiles.slice(currentIndex);

    if (applyToAll || remaining.length <= 1) {
      const allDecisions = { ...decisions };
      for (const file of remaining) {
        allDecisions[file] = action;
      }
      onResolve({ perFile: allDecisions });
      onClose();
      return;
    }

    setDecisions((prev) => ({ ...prev, [conflictingFiles[currentIndex]]: action }));
    setCurrentIndex((prev) => prev + 1);
  }, [applyToAll, conflictingFiles, currentIndex, decisions, onResolve, onClose]);

  const isSingleFile = conflictingFiles.length === 1;
  const currentFile = conflictingFiles[currentIndex] ?? '';
  const progress = `${currentIndex + 1} / ${conflictingFiles.length}`;

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title={t('conflict.title')} size="sm">
      <div className="space-y-4">
        {/* Icon + message */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1 pt-1">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {isSingleFile
                ? t('conflict.messageSingle')
                : t('conflict.messageMulti', { count: conflictingFiles.length })}
            </p>
          </div>
        </div>

        {/* Current file */}
        <div className="rounded-md bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 p-3">
          {!isSingleFile && (
            <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-1.5 font-medium">
              {progress}
            </p>
          )}
          <p className="text-xs text-gray-700 dark:text-gray-300 font-mono truncate">
            {currentFile}
          </p>
        </div>

        {/* Apply to all checkbox (only for 2+ files) */}
        {!isSingleFile && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600
                         text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('conflict.applyToAll', { count: conflictingFiles.length - currentIndex })}
            </span>
          </label>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300
                       bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600
                       rounded-md hover:bg-gray-50 dark:hover:bg-gray-600
                       focus:outline-none focus:ring-2 focus:ring-gray-500
                       transition-colors"
          >
            {t('common:button.cancel')}
          </button>
          <button
            onClick={() => handleAction('copy')}
            className="px-4 py-2 text-sm font-medium text-white rounded-md
                       bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600
                       focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
                       transition-colors"
          >
            {t('conflict.keepCopy')}
          </button>
          <button
            ref={overwriteBtnRef}
            onClick={() => handleAction('overwrite')}
            className="px-4 py-2 text-sm font-medium text-white rounded-md
                       bg-orange-600 hover:bg-orange-700 dark:bg-orange-500 dark:hover:bg-orange-600
                       focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500
                       transition-colors"
          >
            {t('conflict.overwrite')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
