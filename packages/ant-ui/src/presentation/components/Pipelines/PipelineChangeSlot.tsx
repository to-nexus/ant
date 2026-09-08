/**
 * The header's save slot — unsaved count, Discard, Save.
 *
 * It lives in the HEADER rather than in a bar above the canvas because a
 * conditional block in that column resizes the canvas on the first keystroke
 * and re-fits the graph. It renders nothing when clean: reserving its width
 * was measured to clip the trash icon and the view toggle once the canvas pane
 * is narrow (explorer + rail + chat open). The invariant that matters is the
 * canvas box, and the header's height is fixed either way; two controls
 * shifting sideways on the first edit is the cheaper trade.
 *
 * The shared `ConfigEditor/aurora/ChangedBar` stays where it is used: agent
 * settings mounts it inside a real scroll container, where its `position:
 * sticky` works. Here that ancestor is not scrollable and it degraded to
 * `relative` — a layout mismatch, not a component bug.
 */

import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';

export function PipelineChangeSlot({
  dirtyCount,
  isSaving,
  canSave,
  blockedReason,
  onSave,
  onDiscard,
}: {
  /** 0 = clean; the slot renders nothing. */
  dirtyCount: number;
  isSaving: boolean;
  canSave: boolean;
  /** Why Save is inert (validator / cron gate) — the button's tooltip. */
  blockedReason?: string;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation('common');
  const saveInert = isSaving || !canSave;
  if (dirtyCount === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span
        title={blockedReason}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          fontWeight: 700,
          color: blockedReason ? 'var(--red-500)' : 'var(--violet-500)',
        }}
      >
        <Pencil size={11} strokeWidth={2.4} />
        {dirtyCount}
      </span>
      <button
        type="button"
        onClick={onDiscard}
        disabled={isSaving}
        style={{
          height: 26,
          padding: '0 10px',
          background: 'transparent',
          color: 'var(--text-2)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-md)',
          fontSize: 11.5,
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
        title={blockedReason}
        style={{
          height: 26,
          padding: '0 12px',
          background: 'var(--gradient-aurora)',
          backgroundSize: '180% 180%',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--r-md)',
          fontSize: 11.5,
          fontWeight: 700,
          cursor: isSaving ? 'wait' : saveInert ? 'not-allowed' : 'pointer',
          opacity: saveInert ? 0.6 : 1,
        }}
      >
        {isSaving ? t('changedBar.saving', 'Saving…') : t('changedBar.save', 'Save')}
      </button>
    </div>
  );
}
