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
    ? 'bg-[color:var(--status-error-fg)] text-white hover:brightness-110'
    : 'border border-[color:var(--border-2)] bg-[color:var(--bg-surface)] text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)]';

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
          <div className="bg-[color:var(--bg-surface)] rounded-xl shadow-xl border border-[color:var(--border-1)] p-6 max-w-md w-full mx-4">
            <h3 className="text-base font-semibold text-[color:var(--text-1)] mb-2">
              {t('ide.forceResetConfirm.title')}
            </h3>
            <p className="text-sm text-[color:var(--text-3)] mb-5">
              {t('ide.forceResetConfirm.body')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-[color:var(--border-2)] bg-[color:var(--bg-surface)] text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)] transition-colors disabled:opacity-50"
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
                className="inline-flex items-center px-3 py-1.5 text-sm rounded-md bg-[color:var(--status-error-fg)] text-white hover:brightness-110 transition-colors disabled:opacity-50"
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
