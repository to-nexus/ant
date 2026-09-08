/**
 * The canvas's ONE notice slot — an absolute overlay, so neither message can
 * resize the canvas or re-fit the graph.
 *
 * Locked and empty are mutually exclusive by construction (`!editable` vs
 * `editable && no steps`), so they share one slot rather than owning a flow
 * block each.
 */

import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';

export type CanvasNoticeKind = { kind: 'locked'; readonlyOwner?: string; onOpenExecution: () => void } | { kind: 'empty' };

export function CanvasNotice({ notice }: { notice: CanvasNoticeKind | null }) {
  const { t } = useTranslation('pipelines');
  if (!notice) return null;

  const shell: React.CSSProperties = {
    position: 'absolute',
    bottom: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 'calc(100% - 32px)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 'var(--r-md)',
    background: 'oklch(from var(--bg-surface) l c h / 0.95)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    fontSize: 12.5,
    color: 'var(--text-3)',
    zIndex: 4,
  };

  if (notice.kind === 'empty') {
    return (
      <div style={{ ...shell, border: '1px dashed var(--border-1)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
        {t('editor.emptyCanvas', 'Press + on the trigger node to add the first step.')}
      </div>
    );
  }

  return (
    <div style={{ ...shell, border: '1px solid var(--border-1)', boxShadow: 'var(--shadow-md)' }}>
      <Lock size={12} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>
        {notice.readonlyOwner
          ? t('editor.readOnlyShared', 'Shared by {{owner}} — read-only for you.', { owner: notice.readonlyOwner })
          : t('canvas.lockedEnabled', 'Design is locked while the pipeline is published — switch it back to draft in the header to edit.')}
      </span>
      <button
        type="button"
        onClick={notice.onOpenExecution}
        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--violet-500)', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        {t('canvas.openExecution', 'Open execution →')}
      </button>
    </div>
  );
}
