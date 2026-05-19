import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface IdeForceResetButtonProps {
  onConfirm: () => void | Promise<void>;
  /** When true the button gets the `primary` emphasis (used in the stuck banner). */
  emphasized?: boolean;
  className?: string;
}

/**
 * Force-reset button with an inline confirm dialog. Uncontrolled — owns its
 * own open/closed state so the parent (IdeConnectionPanel / stuck banner)
 * doesn't need to thread state. Confirm calls `onConfirm`; the parent is
 * responsible for the actual `forceResetIdeSession` dispatch.
 */
export function IdeForceResetButton({ onConfirm, emphasized = false, className }: IdeForceResetButtonProps) {
  const { t } = useTranslation('async');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const baseClass =
    'inline-flex items-center px-3 py-1.5 text-sm rounded-md transition-colors';
  const tone = emphasized
    ? 'bg-rose-600 text-white hover:bg-rose-500 dark:bg-rose-500 dark:hover:bg-rose-400'
    : 'border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#0d1117] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#161b22]';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${baseClass} ${tone} ${className ?? ''}`}
      >
        {t('ide.disconnected.canDo.forceReset.label')}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
        >
          <div className="bg-white dark:bg-[#161b22] rounded-xl shadow-xl border border-gray-200 dark:border-[#30363d] p-6 max-w-md w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {t('ide.forceResetConfirm.title')}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              {t('ide.forceResetConfirm.body')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-[#30363d] bg-white dark:bg-[#0d1117] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#161b22] transition-colors disabled:opacity-50"
              >
                {t('ide.forceResetConfirm.cancel')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  try {
                    await onConfirm();
                  } finally {
                    setBusy(false);
                    setOpen(false);
                  }
                }}
                disabled={busy}
                className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white hover:bg-rose-500 dark:bg-rose-500 dark:hover:bg-rose-400 transition-colors disabled:opacity-50"
              >
                {t('ide.forceResetConfirm.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
