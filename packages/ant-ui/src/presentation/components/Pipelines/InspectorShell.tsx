import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

/** The 360px right-hand drawer chrome shared by StepInspector and PipelineSettingsPanel. */
export function InspectorShell({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  const { t } = useTranslation('pipelines');
  return (
    <div
      style={{
        width: 360,
        flexShrink: 0,
        height: '100%',
        borderLeft: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{title}</span>
        {onClose && (
          <button aria-label={t('inspector.close', 'Close')} onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer' }}>
            <X size={15} />
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </div>
  );
}
