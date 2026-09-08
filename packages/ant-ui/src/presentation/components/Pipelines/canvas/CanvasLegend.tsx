/**
 * CanvasLegend — the card grammar and edge conditions in one glance. Reads
 * the same tables the nodes and edges paint from (NODE_KIND_STYLE /
 * edgeStyleFor), so it cannot drift from the canvas. Collapsed to a chip so it
 * never sits on a card; hover or click opens it.
 */

import { useState } from 'react';
import { Panel } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import type { StepEdgeCondition } from '@ant/shared';
import { NODE_KIND_STYLE, chamferPolygon, type NodeKind } from './nodes';
import { edgeStyleFor } from './layout';

const KINDS: NodeKind[] = ['trigger', 'step', 'gate'];
const EDGE_ROWS: Array<{ key: string; condition: StepEdgeCondition }> = [
  { key: 'edgeSuccess', condition: 'success' },
  { key: 'edgeFailure', condition: 'failure' },
  { key: 'edgeAlways', condition: 'always' },
  { key: 'edgeVerdict', condition: 'verdict:name' },
];

function KindSwatch({ kind }: { kind: NodeKind }) {
  const look = NODE_KIND_STYLE[kind];
  const base: React.CSSProperties = { width: 22, height: 12, display: 'inline-block', flexShrink: 0 };
  if (look.silhouette === 'chamfer') {
    return (
      <span style={{ ...base, position: 'relative' }}>
        <span aria-hidden style={{ position: 'absolute', inset: 0, background: 'var(--border-2)', clipPath: chamferPolygon(-7) }} />
        <span aria-hidden style={{ position: 'absolute', inset: 1, background: 'var(--bg-surface)', clipPath: chamferPolygon(-8), boxShadow: `inset 2px 0 0 ${look.accent}` }} />
      </span>
    );
  }
  return (
    <span
      style={{
        ...base,
        borderRadius: look.silhouette === 'pill' ? 999 : 3,
        border: '1px solid var(--border-2)',
        background: 'var(--bg-surface)',
        boxShadow: `inset 2px 0 0 ${look.accent}`,
      }}
    />
  );
}

function EdgeSwatch({ condition }: { condition: StepEdgeCondition }) {
  const spec = edgeStyleFor(condition);
  return (
    <svg width={22} height={12} aria-hidden style={{ flexShrink: 0 }}>
      <line x1={1} y1={6} x2={21} y2={6} stroke={spec.stroke} strokeWidth={1.5} strokeDasharray={spec.dasharray} />
    </svg>
  );
}

export function CanvasLegend() {
  const { t } = useTranslation('pipelines');
  const [open, setOpen] = useState(false);
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-3)', lineHeight: '14px' };
  const chrome: React.CSSProperties = {
    borderRadius: open ? 'var(--r-md)' : 'var(--r-pill)',
    background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
    border: '1px solid var(--border-1)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  };
  return (
    <Panel position="top-right" style={{ margin: 12 }}>
      <div onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        {open ? (
          <div style={{ ...chrome, display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 14, rowGap: 3, padding: '6px 10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {KINDS.map((kind) => (
                <span key={kind} style={rowStyle}>
                  <KindSwatch kind={kind} />
                  {t(`legend.${kind}`, kind)}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {EDGE_ROWS.map((row) => (
                <span key={row.key} style={rowStyle}>
                  <EdgeSwatch condition={row.condition} />
                  {t(`legend.${row.key}`, row.condition)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            aria-label={t('legend.title', 'Legend')}
            onClick={() => setOpen(true)}
            style={{ ...chrome, ...rowStyle, padding: '4px 9px', cursor: 'pointer' }}
          >
            <Info size={12} />
            {t('legend.title', 'Legend')}
          </button>
        )}
      </div>
    </Panel>
  );
}
