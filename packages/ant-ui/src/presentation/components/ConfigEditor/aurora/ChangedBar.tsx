
import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ChangedBarProps {
  hasChanges: boolean;
  isSaving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  count?: number;
  /** Save stays visible but inert (validation gate); pair with `blockedReason`. */
  saveDisabled?: boolean;
  /** Why Save is disabled — replaces the subtitle in the error tone. */
  blockedReason?: string;
}

/**
 * Sticky "unsaved changes" bar. Returns null when `!hasChanges`.
 * Uses the global `spring-in` keyframe (defined in aurora-tokens.css).
 */
export function ChangedBar({
  hasChanges,
  isSaving = false,
  onSave,
  onDiscard,
  count,
  saveDisabled = false,
  blockedReason,
}: ChangedBarProps) {
  const { t } = useTranslation('common');
  if (!hasChanges) return null;
  const saveInert = isSaving || saveDisabled;

  return (
    <div
      style={{
        position: 'sticky',
        top: 12,
        zIndex: 20,
        margin: '0 0 16px',
        padding: '10px 14px 10px 16px',
        background: 'oklch(from var(--bg-surface) l c h / 0.95)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: '1.5px solid var(--violet-300)',
        borderRadius: 'var(--r-lg)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow:
          '0 12px 32px -8px oklch(60% 0.20 290 / 0.30), 0 0 0 4px oklch(64% 0.20 290 / 0.10)',
        animation: 'spring-in 0.4s var(--ease-spring) both',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: 'var(--gradient-violet-pink)',
          color: 'white',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 4px 12px -2px oklch(60% 0.20 290 / 0.4)',
        }}
      >
        <Pencil size={13} strokeWidth={2.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: 'var(--text-1)',
          }}
        >
          {t('changedBar.title', 'Unsaved changes')}
          {typeof count === 'number' && count > 0 ? ` (${count})` : ''}
        </div>
        <div
          style={{
            fontSize: 11,
            color: blockedReason ? 'var(--red-500)' : 'var(--text-3)',
            marginTop: 1,
          }}
        >
          {blockedReason ?? t('changedBar.subtitle', 'Nothing is applied until you save.')}
        </div>
      </div>
      <button
        type="button"
        onClick={onDiscard}
        disabled={isSaving}
        style={{
          height: 30,
          padding: '0 12px',
          background: 'transparent',
          color: 'var(--text-2)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-md)',
          fontSize: 12,
          fontWeight: 600,
          cursor: isSaving ? 'not-allowed' : 'pointer',
          opacity: isSaving ? 0.5 : 1,
        }}
      >
        {t('changedBar.discard', 'Discard')}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saveInert}
        style={{
          height: 30,
          padding: '0 14px',
          background: 'var(--gradient-aurora)',
          backgroundSize: '180% 180%',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--r-md)',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.01em',
          cursor: isSaving ? 'wait' : saveDisabled ? 'not-allowed' : 'pointer',
          opacity: saveInert ? 0.6 : 1,
          boxShadow: '0 6px 18px -6px oklch(55% 0.20 290 / 0.5)',
          transition: 'background-position 0.4s ease',
        }}
      >
        {isSaving ? t('changedBar.saving', 'Saving…') : t('changedBar.save', 'Save')}
      </button>
    </div>
  );
}
