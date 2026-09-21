/**
 * PipelineCanvas — the DAG surface. Node click = inspector focus, "+" on a
 * node = insert-after (linear defs splice positionally; DAG defs splice-through
 * via draft.ts), live runs overlay the nodes so the canvas doubles as the run
 * monitor: the wiring is drawn ONCE, each step node lists the live runs at it
 * as chips, the trigger carries a live count, and the focused run's statuses
 * and path are highlighted (`runOverlay.ts`). Geometry comes from `layout.ts`
 * (dagre LR, serpentine-wrapped to the measured pane width); this file only
 * paints it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  MarkerType,
  Position,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStore as useFlowStore,
  type Edge,
  type Node,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useTranslation } from 'react-i18next';
import { isApprovalStep, type PipelineDef, type PipelineLiveRun, type PipelineStepStatus, type StepEdgeCondition } from '@ant/shared';
import type { PipelineRunPublic } from '@/domain/store/slices/pipelineSlice';
import { runHue, runTintFg } from '../runIdentity';
import { focusRunId, selectedPath, stepRunChips, triggerBadge } from './runOverlay';
import { FlowCanvasControls, DEFAULT_FIT_VIEW_OPTIONS } from '@/presentation/components/common/FlowCanvasControls';
import { TriggerNode, StepNode, GateNode, type PipelineNodeData } from './nodes';
import { CanvasLegend } from './CanvasLegend';
import { edgeStyleFor, layoutPipeline, ranksPerRowFor, type EdgeKind } from './layout';
import { estimateNodeHeight } from './nodeMetrics';
import { resolveStepIdentity, type IdentityAgentSummary } from '../stepIdentity';
import { TRIGGER_NODE_ID, effectiveNeedsOf, triggerModeOf } from '../draft';

const nodeTypes: NodeTypes = {
  pipelineTrigger: TriggerNode,
  pipelineStep: StepNode,
  pipelineGate: GateNode,
};

/** Agent catalog rows the canvas resolves display names from (accountAgents shape). */
export type CanvasAgentSummary = IdentityAgentSummary;

export interface PipelineCanvasProps {
  def: PipelineDef;
  cronSummary: string;
  /** Account agent catalog for step display names — raw ids fall back when absent. */
  customAgents?: CanvasAgentSummary[];
  /** Live runs of the activation this canvas monitors — chips per step, count on the trigger. */
  liveRuns?: readonly PipelineLiveRun[];
  /** Held run details (by runId) — chip statuses and the focused run's overlay read them. */
  runDetails?: Record<string, PipelineRunPublic>;
  /** The run a person opened (shared with the execution view's run list); chips of it draw a ring. */
  selectedRunId?: string | null;
  onSelectRun?: (runId: string) => void;
  /** Activation context: per-gate approver roster rendered on gate nodes. */
  approversByGate?: Record<string, string[]>;
  /** Steps a save-time advisory names — rendered as an amber dot on the card. */
  advisoryStepIds?: ReadonlySet<string>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onAddAfter?: (afterNodeId: string, kind: 'job' | 'gate', mode: 'insert' | 'branch') => void;
  /** Design view only — the embedded run monitor is too small for it. */
  showLegend?: boolean;
}

interface EdgeData {
  kind: EdgeKind;
  condition: StepEdgeCondition;
}

/** One provider per canvas instance — the design view and the execution view each own a store. */
export function PipelineCanvas(props: PipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <PipelineCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

/**
 * Re-fit only when the STRUCTURE changes (node count, wrap, bounding box) —
 * never on selection. Returns whether the pane has had its first settled fit,
 * so the caller can hide the unmeasured first-paint layout.
 */
function useFitOnStructureChange(key: string, settled: boolean): boolean {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  useEffect(() => {
    if (!ready) return;
    fitView({ ...DEFAULT_FIT_VIEW_OPTIONS, duration: visibleRef.current ? 300 : 0 });
    if (settled && !visibleRef.current) {
      visibleRef.current = true;
      setVisible(true);
    }
  }, [key, ready, settled, fitView]);
  return visible;
}

const NO_RUNS: readonly PipelineLiveRun[] = [];

function PipelineCanvasInner({ def, cronSummary, customAgents, liveRuns = NO_RUNS, runDetails, selectedRunId, onSelectRun, approversByGate, advisoryStepIds, selectedNodeId, onSelectNode, onAddAfter, showLegend }: PipelineCanvasProps) {
  const { t } = useTranslation('pipelines');
  // reactflow's own ResizeObserver keeps this current — quantized to a rank
  // bucket so a drag on the inspector handle only re-lays out across a 300px step.
  const ranksPerRow = ranksPerRowFor(useFlowStore((s) => s.width));

  // Geometry memo: identity text, run statuses, edges, positions. Decoration
  // (selection, advisories, rosters, the "+" handler) is layered below so a
  // click never re-runs dagre.
  const geometry = useMemo(() => {
    // The focused run (selected if live, else the newest live) owns the
    // per-node status border and the gate decision — the one-run picture is
    // unchanged; the chips are what N runs add.
    const focus = focusRunId(liveRuns, selectedRunId);
    const run = focus ? runDetails?.[focus] : undefined;
    const statusOf = new Map<string, PipelineStepStatus>();
    for (const s of run?.steps ?? []) statusOf.set(s.stepId, s.status);
    const gateOf = new Map(run?.steps.filter((s) => s.gate?.decision).map((s) => [s.stepId, s.gate!]) ?? []);
    const chipsOf = stepRunChips(def, liveRuns, (id) => runDetails?.[id]);
    const path = selectedPath(def, run);
    const focusHue = focus ? runTintFg(runHue(focus)) : undefined;
    const triggerMode = triggerModeOf(def);

    const rfNodes: Node<PipelineNodeData>[] = [
      {
        id: TRIGGER_NODE_ID,
        type: 'pipelineTrigger',
        position: { x: 0, y: 0 },
        data: {
          nodeId: TRIGGER_NODE_ID,
          primary: t(`canvas.triggerMode.${triggerMode}`, { schedule: 'Schedule', manual: 'Manual', upstream: 'Upstream', fetch: 'Fetch' }[triggerMode]),
          caption: cronSummary,
          selected: false,
          flowDir: 'ltr',
          triggerMode,
          liveCount: triggerBadge(liveRuns).count,
        },
      },
    ];

    def.steps.forEach((step) => {
      const gate = isApprovalStep(step);
      const invalid = gate ? step.prompt.trim().length === 0 : step.customJobRef.trim().length === 0;
      // The pinned intent is what distinguishes sibling steps of one agent × job.
      const identity = resolveStepIdentity(step, customAgents, t);
      rfNodes.push({
        id: step.id,
        type: gate ? 'pipelineGate' : 'pipelineStep',
        position: { x: 0, y: 0 },
        data: {
          nodeId: step.id,
          primary: identity.primary,
          caption: identity.caption,
          captionTitle: identity.captionTitle,
          agentId: identity.agentId,
          discovers: !gate && step.discovers !== undefined,
          status: statusOf.get(step.id),
          runChips: chipsOf[step.id],
          selected: false,
          flowDir: 'ltr',
          invalid,
          ...(gate && gateOf.get(step.id)
            ? { gateDecision: { decision: gateOf.get(step.id)!.decision!, decidedBy: gateOf.get(step.id)!.decidedBy } }
            : {}),
        },
      });
    });

    // Edge seeds first — the layout decides each edge's shape (bezier within a
    // row, smoothstep for a row turn) and which handles it addresses.
    const seeds: Array<{ id: string; source: string; target: string; condition: StepEdgeCondition; animated: boolean }> = [];
    def.steps.forEach((step, index) => {
      const needs = effectiveNeedsOf(def, index);
      const sources = needs.length > 0 ? needs : [TRIGGER_NODE_ID];
      const status = statusOf.get(step.id);
      for (const source of sources) {
        seeds.push({ id: `${source}->${step.id}`, source, target: step.id, condition: step.on ?? 'success', animated: status === 'running' || status === 'dispatched' });
      }
    });

    // The "+" names what an insert lands BEFORE, and offers a branch only where
    // a successor exists — derived from the same effective edges as the seeds,
    // so the affordance can never disagree with the drawn graph.
    const nodeById = new Map(rfNodes.map((n) => [n.id, n]));
    for (const seed of seeds) {
      const anchor = nodeById.get(seed.source);
      if (anchor && anchor.data.successorId === undefined) anchor.data.successorId = seed.target;
    }

    const layout = layoutPipeline(
      rfNodes.map((n) => ({ id: n.id, height: estimateNodeHeight({ ...n.data, kind: n.type === 'pipelineTrigger' ? 'trigger' : 'step' }) })),
      seeds,
      ranksPerRow,
    );
    for (const n of rfNodes) {
      const placed = layout.nodes.get(n.id)!;
      n.position = { x: placed.x, y: placed.y };
      n.data.flowDir = placed.flowDir;
      // Flipping a row flips the handle sides; these props are what makes
      // reactflow re-measure handle bounds (a Handle position prop alone does not).
      n.sourcePosition = placed.flowDir === 'ltr' ? Position.Right : Position.Left;
      n.targetPosition = placed.flowDir === 'ltr' ? Position.Left : Position.Right;
    }

    const rfEdges: Edge<EdgeData>[] = seeds.map((seed) => {
      const placed = layout.edges.get(seed.id)!;
      const spec = edgeStyleFor(seed.condition);
      // The focused run's traversed edges take that run's hue — its path on the one canvas.
      const onPath = focusHue !== undefined && path.has(seed.id);
      const shape =
        placed.kind === 'turn'
          ? { type: 'smoothstep' as const, pathOptions: { borderRadius: 16, offset: 20 } }
          : { type: 'default' as const, pathOptions: { curvature: 0.3 } };
      return {
        id: seed.id,
        source: seed.source,
        target: seed.target,
        sourceHandle: placed.sourceHandle,
        targetHandle: placed.targetHandle,
        data: { kind: placed.kind, condition: seed.condition },
        label: spec.label,
        labelStyle: { fontSize: 10, fill: spec.stroke, fontWeight: 600 },
        labelBgStyle: { fill: 'var(--bg-surface-2)', fillOpacity: 0.92 },
        labelBgPadding: [5, 2] as [number, number],
        labelBgBorderRadius: 999,
        style: { stroke: onPath ? focusHue : spec.stroke, strokeWidth: onPath ? 2 : 1.5, opacity: onPath ? 1 : 0.75, strokeDasharray: spec.dasharray },
        // `color` is what the ArrowClosed marker actually paints — without it the head is `none`.
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: onPath ? focusHue : spec.stroke },
        animated: seed.animated,
        ...shape,
      };
    });

    const structureKey = `${rfNodes.length}|${layout.rows}|${layout.ranksPerRow}|${Math.round(layout.width)}x${Math.round(layout.height)}`;
    return { nodes: rfNodes, edges: rfEdges, structureKey };
  }, [def, liveRuns, runDetails, selectedRunId, cronSummary, customAgents, ranksPerRow, t]);

  const { nodes, edges } = useMemo(() => {
    const decorated = geometry.nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        selected: selectedNodeId === n.id,
        onAdd: onAddAfter,
        selectedRunId,
        onSelectRun,
        advisory: advisoryStepIds?.has(n.id) || undefined,
        ...(n.type === 'pipelineGate' && approversByGate?.[n.id]?.length ? { approvers: approversByGate[n.id] } : {}),
      },
    }));
    const highlighted = geometry.edges.map((e) => {
      if (!selectedNodeId || (e.source !== selectedNodeId && e.target !== selectedNodeId)) return e;
      return { ...e, style: { ...e.style, stroke: 'var(--violet-500)', strokeWidth: 2, opacity: 1 }, markerEnd: { ...(e.markerEnd as object), color: 'var(--violet-500)' } as Edge['markerEnd'], zIndex: 1 };
    });
    return { nodes: decorated, edges: highlighted };
  }, [geometry, selectedNodeId, selectedRunId, onSelectRun, onAddAfter, advisoryStepIds, approversByGate]);

  const visible = useFitOnStructureChange(geometry.structureKey, ranksPerRow !== null);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_e, node) => onSelectNode(node.id)}
      onPaneClick={() => onSelectNode(null)}
      minZoom={0.3}
      maxZoom={1.6}
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 120ms ease' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border-1)" />
      <FlowCanvasControls />
      {showLegend && <CanvasLegend />}
    </ReactFlow>
  );
}

