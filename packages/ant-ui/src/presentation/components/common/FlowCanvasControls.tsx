/**
 * FlowCanvasControls — the ONE zoom/fit toolbar for every reactflow surface
 * (pipeline canvas, agent workflow). Aurora pill of IconButtons rendered in a
 * reactflow Panel; extra per-canvas buttons ride in as children. Must render
 * inside <ReactFlow> (the Panel and the hooks need its store).
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { Panel, useReactFlow, useStore as useFlowStore, type FitViewOptions, type PanelPosition } from 'reactflow';
import { IconButton } from '@/presentation/components/aurora';

export const DEFAULT_FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.2, maxZoom: 1.1, duration: 300 };

export interface FlowCanvasControlsProps {
  position?: PanelPosition;
  /** Extra px between the pane bottom and the pill (a bar overlapping the pane). */
  bottomOffset?: number;
  fitViewOptions?: FitViewOptions;
  children?: ReactNode;
}

const pillButton = { borderRadius: 'var(--r-pill)' } as const;

export function FlowCanvasControls({ position = 'bottom-left', bottomOffset = 0, fitViewOptions = DEFAULT_FIT_VIEW_OPTIONS, children }: FlowCanvasControlsProps) {
  const { t } = useTranslation('common');
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  // Percentage only — subscribing to the raw transform would re-render on every pan.
  const zoomPercent = useFlowStore((s) => Math.round(s.transform[2] * 100));

  return (
    <Panel position={position} style={{ margin: 12, marginBottom: 12 + bottomOffset }}>
      <div
        role="toolbar"
        aria-label={t('flowControls.toolbar', 'Canvas zoom')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: 3,
          borderRadius: 'var(--r-pill)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-1)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <IconButton size="sm" icon={<Minus size={14} />} aria-label={t('flowControls.zoomOut', 'Zoom out')} title={t('flowControls.zoomOut', 'Zoom out')} style={pillButton} onClick={() => zoomOut({ duration: 200 })} />
        <button
          type="button"
          onClick={() => zoomTo(1, { duration: 200 })}
          aria-label={t('flowControls.actualSize', 'Actual size')}
          title={t('flowControls.actualSize', 'Actual size')}
          style={{
            minWidth: 42,
            height: 30,
            padding: '0 4px',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--r-pill)',
            color: 'var(--text-2)',
            fontSize: 11.5,
            fontVariantNumeric: 'tabular-nums',
            cursor: 'pointer',
          }}
        >
          {zoomPercent}%
        </button>
        <IconButton size="sm" icon={<Plus size={14} />} aria-label={t('flowControls.zoomIn', 'Zoom in')} title={t('flowControls.zoomIn', 'Zoom in')} style={pillButton} onClick={() => zoomIn({ duration: 200 })} />
        <span aria-hidden style={{ width: 1, height: 16, margin: '0 3px', background: 'var(--border-1)' }} />
        <IconButton size="sm" icon={<Maximize2 size={14} />} aria-label={t('flowControls.fitView', 'Fit to screen')} title={t('flowControls.fitView', 'Fit to screen')} style={pillButton} onClick={() => fitView(fitViewOptions)} />
        {children}
      </div>
    </Panel>
  );
}
