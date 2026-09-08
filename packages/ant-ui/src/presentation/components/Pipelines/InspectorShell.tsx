import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, type LucideIcon } from 'lucide-react';
import { STORAGE_KEYS } from '@/domain/store/storage';
import { useResizableWidth } from '../AgentSettings/useResizableWidth';
import { RailResizeHandle } from '../shared/rail';

export const INSPECTOR_MIN_WIDTH = 300;
export const INSPECTOR_MAX_WIDTH = 720;
export const INSPECTOR_DEFAULT_WIDTH = 360;

/**
 * The right-hand drawer chrome shared by StepInspector and PipelineSettingsPanel —
 * drag-resizable on its left border (persisted), with an optional kind icon whose
 * accent matches the canvas card the drawer describes.
 */
export function InspectorShell({ title, icon: Icon, accent, onClose, children }: { title: string; icon?: LucideIcon; accent?: string; onClose?: () => void; children: ReactNode }) {
  const { t } = useTranslation('pipelines');
  const { width, isResizing, startResize } = useResizableWidth({
    storageKey: STORAGE_KEYS.PIPELINE_INSPECTOR_WIDTH,
    min: INSPECTOR_MIN_WIDTH,
    max: INSPECTOR_MAX_WIDTH,
    defaultWidth: INSPECTOR_DEFAULT_WIDTH,
    grow: 'left',
  });
  return (
    <div
      style={{
        position: 'relative',
        width,
        flexShrink: 0,
        height: '100%',
        borderLeft: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <RailResizeHandle side="left" isResizing={isResizing} onMouseDown={startResize} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        {Icon && (
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: accent ? `color-mix(in srgb, ${accent} 16%, transparent)` : 'var(--bg-surface-2)',
              color: accent ?? 'var(--text-2)',
            }}
          >
            <Icon size={13} />
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text-1)' }}>{title}</span>
        {onClose && (
          <button aria-label={t('inspector.close', 'Close')} onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'inline-flex' }}>
            <X size={15} />
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </div>
  );
}
