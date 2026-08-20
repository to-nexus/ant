/**
 * Pipeline canvas nodes — n8n-style cards on the reactflow surface. Three
 * kinds: the cron trigger, a universal-job step, an approval gate. Aurora CSS
 * variables only (theme auto-flip); live-run status paints a ring + status
 * chip so the canvas doubles as the run monitor.
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Clock, Bot, ShieldCheck, Plus, Zap, Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PipelineStepStatus } from '@ant/shared';

/** Card width — PipelineCanvas feeds it to dagre alongside the height estimate. */
export const NODE_WIDTH = 230;

export interface PipelineNodeData {
  /** Primary identity line (agent display name / Schedule / Approval) — wraps, never truncates. */
  title: string;
  /** Secondary identity line (job display name / cron / timeout) — wraps, never truncates. */
  subtitle?: string;
  /** Intent chip (job steps). */
  chip?: string;
  /** Live-run status overlay. */
  status?: PipelineStepStatus;
  selected: boolean;
  /** Insert-after affordance ("+" between nodes, n8n style). Absent = hidden. */
  onAdd?: (afterNodeId: string, kind: 'job' | 'gate') => void;
  nodeId: string;
  invalid?: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--violet-500)',
  dispatched: 'var(--violet-500)',
  awaiting_gate: 'var(--amber-500, #f59e0b)',
  succeeded: 'var(--emerald-500)',
  failed: 'var(--red-500)',
  skipped: 'var(--text-3)',
  cancelled: 'var(--text-3)',
};

function AddButton({ data }: { data: PipelineNodeData }) {
  const { t } = useTranslation('pipelines');
  const [open, setOpen] = useState(false);
  if (!data.onAdd) return null;
  return (
    <div style={{ position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)', zIndex: 5 }}>
      <button
        aria-label="add step"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-1)',
          color: 'var(--text-2)',
          cursor: 'pointer',
        }}
      >
        <Plus size={13} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            left: 26,
            top: -8,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-1)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            width: 150,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setOpen(false);
              data.onAdd?.(data.nodeId, 'job');
            }}
            style={menuItemStyle}
          >
            <Zap size={12} /> {t('canvas.addJobStep', 'Job step')}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              data.onAdd?.(data.nodeId, 'gate');
            }}
            style={menuItemStyle}
          >
            <ShieldCheck size={12} /> {t('canvas.addGate', 'Approval gate')}
          </button>
        </div>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  fontSize: 12,
  color: 'var(--text-2)',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--r-sm)',
  cursor: 'pointer',
  textAlign: 'left',
};

function shell(data: PipelineNodeData, accentVar: string): React.CSSProperties {
  const statusColor = data.status ? STATUS_COLOR[data.status] : undefined;
  return {
    position: 'relative',
    width: NODE_WIDTH,
    borderRadius: 'var(--r-md)',
    background: 'var(--bg-surface)',
    border: `1.5px solid ${data.selected ? accentVar : statusColor ?? 'var(--border-1)'}`,
    boxShadow: data.selected ? '0 0 0 3px color-mix(in srgb, var(--violet-500) 22%, transparent)' : 'var(--shadow-xs)',
    padding: '10px 12px',
    cursor: 'pointer',
  };
}

function StatusChip({ status }: { status?: PipelineStepStatus }) {
  if (!status || status === 'pending') return null;
  const color = STATUS_COLOR[status] ?? 'var(--text-3)';
  const pulse = status === 'running' || status === 'dispatched' || status === 'awaiting_gate';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        fontWeight: 600,
        color,
        marginTop: 4,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          background: color,
          animation: pulse ? 'pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function NodeHeader({ icon, title, subtitle, chip, invalid }: { icon: React.ReactNode; title: string; subtitle?: string; chip?: string; invalid?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', minWidth: 0 }}>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-surface-2)',
          color: invalid ? 'var(--red-500)' : 'var(--text-2)',
        }}
      >
        {icon}
      </div>
      {/* Identity lines wrap instead of truncating — the card's job is to name
          the step, and an ellipsised name names nothing. */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: '17px', color: 'var(--text-1)', overflowWrap: 'anywhere' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, fontWeight: 500, lineHeight: '15px', marginTop: 1, color: 'var(--text-2)', overflowWrap: 'anywhere' }}>
            {subtitle}
          </div>
        )}
        {chip && (
          <span
            style={{
              display: 'inline-block',
              marginTop: 3,
              fontSize: 9.5,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 999,
              background: 'color-mix(in srgb, var(--violet-500) 14%, transparent)',
              color: 'var(--violet-500)',
            }}
          >
            @{chip}
          </span>
        )}
      </div>
    </div>
  );
}

export const TriggerNode = memo(function TriggerNode({ data }: NodeProps<PipelineNodeData>) {
  return (
    <div style={shell(data, 'var(--violet-500)')}>
      <NodeHeader icon={<Clock size={14} />} title={data.title} subtitle={data.subtitle} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <AddButton data={data} />
    </div>
  );
});

export const StepNode = memo(function StepNode({ data }: NodeProps<PipelineNodeData>) {
  return (
    <div style={shell(data, 'var(--violet-500)')}>
      <NodeHeader
        icon={data.invalid ? <Ban size={14} /> : <Bot size={14} />}
        title={data.title}
        subtitle={data.subtitle}
        chip={data.chip}
        invalid={data.invalid}
      />
      <StatusChip status={data.status} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <AddButton data={data} />
    </div>
  );
});

export const GateNode = memo(function GateNode({ data }: NodeProps<PipelineNodeData>) {
  const awaiting = data.status === 'awaiting_gate';
  return (
    <div
      style={{
        ...shell(data, 'var(--amber-500, #f59e0b)'),
        borderStyle: 'dashed',
        background: awaiting ? 'color-mix(in srgb, var(--amber-500, #f59e0b) 8%, var(--bg-surface))' : 'var(--bg-surface)',
      }}
    >
      <NodeHeader icon={<ShieldCheck size={14} />} title={data.title} subtitle={data.subtitle} invalid={data.invalid} />
      <StatusChip status={data.status} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <AddButton data={data} />
    </div>
  );
});
