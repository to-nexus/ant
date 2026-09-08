/**
 * Pipeline canvas nodes — three kinds on the reactflow surface, each with its
 * own silhouette (BPMN shape semantics folded into text-bearing cards):
 * trigger = event → pill · job step = task → rounded rectangle · approval
 * gate = gateway → chamfered octagon. Channels never overlap: silhouette +
 * accent = kind, border = live-run status, ring = selection, dot = advisory.
 * Aurora CSS variables only (theme auto-flip).
 */

import { memo, useState, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Clock, Bot, ShieldCheck, Plus, Zap, Ban, Link2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GateDecision, PipelineStepStatus } from '@ant/shared';
import { TRIGGER_NODE_ID, type TriggerMode } from '../draft';
import { LIVE_STEP_STATUSES, STEP_STATUS_COLOR, gateDecisionLabel, isApprovedDecision, stepStatusLabel } from '../runStepPresentation';
import { HANDLE, NODE_WIDTH, type FlowDir } from './layout';

export { NODE_WIDTH } from './layout';

export type NodeKind = 'trigger' | 'step' | 'gate';
export type NodeSilhouette = 'pill' | 'rounded' | 'chamfer';

/** The ONE kind → look table; the legend and the inspector header read it too. */
export const NODE_KIND_STYLE: Record<NodeKind, { accent: string; silhouette: NodeSilhouette; icon: LucideIcon }> = {
  trigger: { accent: 'var(--teal-500)', silhouette: 'pill', icon: Clock },
  step: { accent: 'var(--violet-500)', silhouette: 'rounded', icon: Bot },
  gate: { accent: 'var(--amber-500)', silhouette: 'chamfer', icon: ShieldCheck },
};

export const TRIGGER_MODE_ICON: Record<TriggerMode, LucideIcon> = { schedule: Clock, manual: Zap, runCompleted: Link2 };

/** Corner cut of the gate octagon, px. */
export const CHAMFER = 12;
/** Octagon clip for a box offset `d` px outward from the card (negative = inset) — keeps the diagonal edges parallel. */
export function chamferPolygon(d: number): string {
  const c = (CHAMFER + d * (2 - Math.SQRT2)).toFixed(2);
  return `polygon(${c}px 0, calc(100% - ${c}px) 0, 100% ${c}px, 100% calc(100% - ${c}px), calc(100% - ${c}px) 100%, ${c}px 100%, 0 calc(100% - ${c}px), 0 ${c}px)`;
}

export interface PipelineNodeData {
  /**
   * The line that NAMES this node — the pinned intent on a job step (the job
   * name when none is pinned), Schedule / Approval otherwise. Wraps, never
   * truncates: an ellipsised name names nothing.
   */
  primary: string;
  /** `agent · job` / cron / timeout — secondary, single-line, truncates. */
  caption?: string;
  /** Full caption plus the raw customJobRef, for the caption's title attribute. */
  captionTitle?: string;
  /** Live-run status overlay. */
  status?: PipelineStepStatus;
  selected: boolean;
  /** Which way this node's row flows — handles and the "+" sit on the forward side. */
  flowDir: FlowDir;
  /** Trigger nodes: picks the icon. */
  triggerMode?: TriggerMode;
  /** The "+" affordance: insert between / branch off. Absent = hidden. */
  onAdd?: (afterNodeId: string, kind: 'job' | 'gate', mode: 'insert' | 'branch') => void;
  /** First step that already depends on this node — names what an insert lands BEFORE, and gates the branch section. */
  successorId?: string;
  nodeId: string;
  invalid?: boolean;
  /** A save-time advisory names this step — amber dot; the inspector shows the text. */
  advisory?: boolean;
  /** Gate nodes, activation context: who may open this gate ("이 게이트는 누가 여는가"). */
  approvers?: string[];
  /** Gate nodes, run context: the landed decision ("✓ B 승인"). */
  gateDecision?: { decision: GateDecision; decidedBy?: string };
}

const HIDDEN_HANDLE: React.CSSProperties = { opacity: 0, pointerEvents: 'none' };

/**
 * The four handle ids `layout.ts` addresses. Both of a type exist on every
 * node, so an edge without explicit handle ids would be dropped by reactflow.
 */
function NodeHandles({ flowDir, withTarget }: { flowDir: FlowDir; withTarget: boolean }) {
  const inPos = flowDir === 'ltr' ? Position.Left : Position.Right;
  const outPos = flowDir === 'ltr' ? Position.Right : Position.Left;
  return (
    <>
      {withTarget && <Handle id={HANDLE.in} type="target" position={inPos} style={HIDDEN_HANDLE} />}
      {withTarget && <Handle id={HANDLE.inTop} type="target" position={Position.Top} style={HIDDEN_HANDLE} />}
      <Handle id={HANDLE.out} type="source" position={outPos} style={HIDDEN_HANDLE} />
      <Handle id={HANDLE.outBottom} type="source" position={Position.Bottom} style={HIDDEN_HANDLE} />
    </>
  );
}

/**
 * One menu section = one structural gesture. The label is what makes the "+"
 * honest: on a node that already has a successor the default gesture INSERTS
 * BETWEEN, which reads as "append a next node" from the button's position.
 */
function AddMenuSection({
  label,
  nodeId,
  mode,
  allowGate,
  onAdd,
  close,
}: {
  label: string;
  nodeId: string;
  mode: 'insert' | 'branch';
  allowGate: boolean;
  onAdd: NonNullable<PipelineNodeData['onAdd']>;
  close: () => void;
}) {
  const { t } = useTranslation('pipelines');
  return (
    <>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', padding: '3px 8px 2px' }}>{label}</div>
      <button
        onClick={() => {
          close();
          onAdd(nodeId, 'job', mode);
        }}
        style={menuItemStyle}
      >
        <Bot size={12} /> {t('canvas.addJobStep', 'Job step')}
      </button>
      {allowGate && (
        <button
          onClick={() => {
            close();
            onAdd(nodeId, 'gate', mode);
          }}
          style={menuItemStyle}
        >
          <ShieldCheck size={12} /> {t('canvas.addGate', 'Approval gate')}
        </button>
      )}
    </>
  );
}

function AddButton({ data }: { data: PipelineNodeData }) {
  const { t } = useTranslation('pipelines');
  const [open, setOpen] = useState(false);
  const onAdd = data.onAdd;
  if (!onAdd) return null;
  const forward = data.flowDir === 'ltr' ? 'right' : 'left';
  // Gate-anchor rule: an approval gate cannot be the entry step — its chat
  // card anchors to the producing job's turn.
  const allowGate = data.nodeId !== TRIGGER_NODE_ID;
  const insertLabel = data.successorId
    ? t('canvas.insertBefore', 'Insert before {{stepId}}', { stepId: data.successorId })
    : t('canvas.appendNext', 'Add next step');
  const close = () => setOpen(false);
  return (
    <div style={{ position: 'absolute', [forward]: -14, top: '50%', transform: 'translateY(-50%)', zIndex: 5 }}>
      <button
        aria-label={insertLabel}
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
            [forward === 'right' ? 'left' : 'right']: 26,
            top: -8,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-1)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow-md)',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            width: 186,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <AddMenuSection label={insertLabel} nodeId={data.nodeId} mode="insert" allowGate={allowGate} onAdd={onAdd} close={close} />
          {/* Branching only means something where a successor already exists;
              the new arm keeps `on: success` until the inspector conditions it. */}
          {data.successorId && (
            <>
              <div style={{ height: 1, background: 'var(--border-1)', margin: '3px 0' }} />
              <AddMenuSection
                label={t('canvas.addBranch', 'Add branch')}
                nodeId={data.nodeId}
                mode="branch"
                allowGate={allowGate}
                onAdd={onAdd}
                close={close}
              />
            </>
          )}
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

const SELECTION_RING = 'color-mix(in srgb, var(--violet-500) 22%, transparent)';

/**
 * Card chrome per kind. Pill / rounded are one bordered box (the accent is an
 * inset stripe that follows the radius); the chamfered gate is three clipped
 * layers — ring, border, surface — because clip-path swallows box-shadow.
 */
function CardShell({ kind, data, tint, children }: { kind: NodeKind; data: PipelineNodeData; tint?: string; children: ReactNode }) {
  const look = NODE_KIND_STYLE[kind];
  const statusColor = data.status ? STEP_STATUS_COLOR[data.status] : undefined;
  const borderColor = data.selected ? look.accent : statusColor ?? 'var(--border-1)';
  const surface = tint ?? 'var(--bg-surface)';
  const stripe = `inset 3px 0 0 ${look.accent}`;

  if (look.silhouette !== 'chamfer') {
    return (
      <div
        style={{
          position: 'relative',
          width: NODE_WIDTH,
          borderRadius: look.silhouette === 'pill' ? 'var(--r-pill)' : 'var(--r-md)',
          background: surface,
          border: `1.5px solid ${borderColor}`,
          boxShadow: data.selected ? `${stripe}, 0 0 0 3px ${SELECTION_RING}` : `${stripe}, var(--shadow-xs)`,
          padding: look.silhouette === 'pill' ? '10px 16px 10px 19px' : '10px 12px 10px 15px',
          cursor: 'pointer',
        }}
      >
        {children}
      </div>
    );
  }
  return (
    <div style={{ position: 'relative', width: NODE_WIDTH, cursor: 'pointer', filter: data.selected ? undefined : 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.08))' }}>
      {data.selected && <div aria-hidden style={{ position: 'absolute', inset: -3, background: SELECTION_RING, clipPath: chamferPolygon(3) }} />}
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: borderColor, clipPath: chamferPolygon(0) }} />
      <div aria-hidden style={{ position: 'absolute', inset: 1.5, background: surface, clipPath: chamferPolygon(-1.5), boxShadow: stripe }} />
      <div style={{ position: 'relative', padding: '10px 14px 10px 17px' }}>{children}</div>
    </div>
  );
}

/** Top-right amber dot — an advisory names this step (details in the inspector). */
function AdvisoryDot({ data, kind }: { data: PipelineNodeData; kind: NodeKind }) {
  const { t } = useTranslation('pipelines');
  if (!data.advisory) return null;
  const onCorner = NODE_KIND_STYLE[kind].silhouette === 'rounded';
  return (
    <span
      title={t('advisory.nodeDot', 'Has advisories — open the step')}
      style={{ position: 'absolute', top: onCorner ? -4 : -2, right: onCorner ? -4 : 8, width: 9, height: 9, borderRadius: 5, background: 'var(--amber-500)', border: '2px solid var(--bg-surface)', zIndex: 1 }}
    />
  );
}

function StatusChip({ status }: { status?: PipelineStepStatus }) {
  const { t } = useTranslation('pipelines');
  if (!status || status === 'pending') return null;
  const color = STEP_STATUS_COLOR[status] ?? 'var(--text-3)';
  const pulse = LIVE_STEP_STATUSES.has(status);
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
          animation: pulse ? 'pulse-soft 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {stepStatusLabel(t, status)}
    </span>
  );
}

function NodeHeader({ kind, icon, primary, caption, captionTitle, invalid }: { kind: NodeKind; icon: ReactNode; primary: string; caption?: string; captionTitle?: string; invalid?: boolean }) {
  const accent = NODE_KIND_STYLE[kind].accent;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', minWidth: 0 }}>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: kind === 'trigger' ? 13 : 8,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: invalid ? 'color-mix(in srgb, var(--red-500) 14%, transparent)' : `color-mix(in srgb, ${accent} 16%, transparent)`,
          color: invalid ? 'var(--red-500)' : accent,
        }}
      >
        {icon}
      </div>
      {/* Only the naming line is protected from truncation. A pipeline is
          usually several intents of one agent × job, so the intent is the
          discriminator and takes the size; `agent · job` is identical across
          those cards and recedes to a truncating caption (full value + the raw
          ref in its tooltip). */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: '19px', color: 'var(--text-1)', overflowWrap: 'anywhere' }}>
          {primary}
        </div>
        {caption && (
          <div
            title={captionTitle ?? caption}
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              lineHeight: '15px',
              marginTop: 1,
              color: 'var(--text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {caption}
          </div>
        )}
      </div>
    </div>
  );
}

export const TriggerNode = memo(function TriggerNode({ data }: NodeProps<PipelineNodeData>) {
  const Icon = data.triggerMode ? TRIGGER_MODE_ICON[data.triggerMode] : Clock;
  return (
    <CardShell kind="trigger" data={data}>
      <NodeHeader kind="trigger" icon={<Icon size={14} />} primary={data.primary} caption={data.caption} />
      <NodeHandles flowDir={data.flowDir} withTarget={false} />
      <AddButton data={data} />
    </CardShell>
  );
});

export const StepNode = memo(function StepNode({ data }: NodeProps<PipelineNodeData>) {
  return (
    <CardShell kind="step" data={data}>
      <NodeHeader
        kind="step"
        icon={data.invalid ? <Ban size={14} /> : <Bot size={14} />}
        primary={data.primary}
        caption={data.caption}
        captionTitle={data.captionTitle}
        invalid={data.invalid}
      />
      <StatusChip status={data.status} />
      <AdvisoryDot data={data} kind="step" />
      <NodeHandles flowDir={data.flowDir} withTarget />
      <AddButton data={data} />
    </CardShell>
  );
});

export const GateNode = memo(function GateNode({ data }: NodeProps<PipelineNodeData>) {
  const { t } = useTranslation('pipelines');
  const awaiting = data.status === 'awaiting_gate';
  const decided = data.gateDecision;
  const approved = decided && isApprovedDecision(decided.decision);
  return (
    <CardShell kind="gate" data={data} tint={`color-mix(in srgb, var(--amber-500) ${awaiting ? 12 : 6}%, var(--bg-surface))`}>
      <NodeHeader kind="gate" icon={<ShieldCheck size={14} />} primary={data.primary} caption={data.caption} invalid={data.invalid} />
      {/* "이 게이트는 누가 여는가" — the roster, right on the node (activation ctx). */}
      {data.approvers && data.approvers.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3, overflowWrap: 'anywhere' }}>
          🛡 {data.approvers.join(', ')}
        </div>
      )}
      <StatusChip status={data.status} />
      {decided && (
        <div style={{ fontSize: 10, fontWeight: 600, marginTop: 3, color: approved ? 'var(--status-done-fg)' : 'var(--status-error-fg)' }}>
          {gateDecisionLabel(t, decided.decision, decided.decidedBy)}
        </div>
      )}
      <AdvisoryDot data={data} kind="gate" />
      <NodeHandles flowDir={data.flowDir} withTarget />
      <AddButton data={data} />
    </CardShell>
  );
});
