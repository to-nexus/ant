/**
 * PipelineCanvas — the n8n-style DAG surface. Node click = inspector focus,
 * "+" on a node = insert-after (linear defs splice positionally; DAG defs
 * splice-through via draft.ts), live-run statuses overlay the nodes so the
 * canvas doubles as the run monitor. Dagre LR layout
 * (components/workflow precedent — no new graph deps).
 */

import { useMemo } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls, MarkerType, type Edge, type Node, type NodeTypes } from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { useTranslation } from 'react-i18next';
import { isApprovalStep, parseCustomJobRef, type PipelineDef, type PipelineStepStatus } from '@ant/shared';
import type { PipelineRunPublic } from '@/domain/store/slices/pipelineSlice';
import { TriggerNode, StepNode, GateNode, NODE_WIDTH, type PipelineNodeData } from './nodes';
import { TRIGGER_NODE_ID, effectiveNeedsOf } from '../draft';

const nodeTypes: NodeTypes = {
  pipelineTrigger: TriggerNode,
  pipelineStep: StepNode,
  pipelineGate: GateNode,
};

/** Agent catalog rows the canvas resolves display names from (accountAgents shape). */
export interface CanvasAgentSummary {
  id: string;
  name: string;
  jobs: Array<{ id: string; name: string }>;
}

/**
 * Dagre needs a height BEFORE the DOM renders — estimate from the text the
 * card will wrap (width 230 − padding/icon ≈ 24 chars per title line at 12px,
 * 28 per subtitle line at 11px). The DOM box itself is height-auto, so the
 * estimate only spaces ranks; a line over/under never clips.
 */
function estimateNodeHeight(data: PipelineNodeData): number {
  const titleLines = Math.max(1, Math.ceil(data.title.length / 24));
  const subtitleLines = data.subtitle ? Math.max(1, Math.ceil(data.subtitle.length / 28)) : 0;
  return 24 + titleLines * 17 + subtitleLines * 15 + (data.chip ? 20 : 0) + (data.status ? 18 : 0) + 16;
}

export interface PipelineCanvasProps {
  def: PipelineDef;
  cronSummary: string;
  /** Account agent catalog for step display names — raw ids fall back when absent. */
  customAgents?: CanvasAgentSummary[];
  run?: PipelineRunPublic | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onAddAfter?: (afterNodeId: string, kind: 'job' | 'gate') => void;
}

export function PipelineCanvas({ def, cronSummary, customAgents, run, selectedNodeId, onSelectNode, onAddAfter }: PipelineCanvasProps) {
  const { t } = useTranslation('pipelines');

  const { nodes, edges } = useMemo(() => {
    const statusOf = new Map<string, PipelineStepStatus>();
    for (const s of run?.steps ?? []) statusOf.set(s.stepId, s.status);

    const rfNodes: Node<PipelineNodeData>[] = [
      {
        id: TRIGGER_NODE_ID,
        type: 'pipelineTrigger',
        position: { x: 0, y: 0 },
        data: {
          nodeId: TRIGGER_NODE_ID,
          title: t('canvas.trigger', 'Schedule'),
          subtitle: cronSummary,
          selected: selectedNodeId === TRIGGER_NODE_ID,
          onAdd: onAddAfter,
        },
      },
    ];

    def.steps.forEach((step) => {
      const gate = isApprovalStep(step);
      const invalid = gate
        ? step.prompt.trim().length === 0
        : step.customJobRef.trim().length === 0;
      // Agent name / job name each on their own line — display names resolved
      // from the account catalog, raw ids as the graceful fallback.
      let title: string;
      let subtitle: string | undefined;
      if (gate) {
        title = t('canvas.approval', 'Approval');
        subtitle = step.timeout ? `${step.timeout.after} → ${step.timeout.onTimeout}` : t('canvas.noTimeout', 'no timeout');
      } else {
        const ref = parseCustomJobRef(step.customJobRef);
        if (!ref) {
          title = t('canvas.unconfigured', 'Choose a job…');
          subtitle = undefined;
        } else {
          const agent = customAgents?.find((a) => a.id === ref.agentId);
          title = agent?.name ?? ref.agentId;
          subtitle = agent?.jobs.find((j) => j.id === ref.jobId)?.name ?? ref.jobId;
        }
      }
      rfNodes.push({
        id: step.id,
        type: gate ? 'pipelineGate' : 'pipelineStep',
        position: { x: 0, y: 0 },
        data: {
          nodeId: step.id,
          title,
          subtitle,
          chip: !gate && step.intent ? step.intent : undefined,
          status: statusOf.get(step.id),
          selected: selectedNodeId === step.id,
          invalid,
          onAdd: onAddAfter,
        },
      });
    });

    const rfEdges: Edge[] = [];
    def.steps.forEach((step, index) => {
      const needs = effectiveNeedsOf(def, index);
      const sources = needs.length > 0 ? needs : [TRIGGER_NODE_ID];
      for (const source of sources) {
        const condition = step.on ?? 'success';
        rfEdges.push({
          id: `${source}->${step.id}`,
          source,
          target: step.id,
          label: condition !== 'success' ? condition : undefined,
          labelStyle: { fontSize: 10, fill: 'var(--text-3)' },
          labelBgStyle: { fill: 'var(--bg-surface-2)', fillOpacity: 0.9 },
          style: {
            stroke: condition === 'failure' ? 'var(--red-500)' : 'var(--text-3)',
            strokeWidth: 1.5,
            opacity: 0.7,
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          animated: statusOf.get(step.id) === 'running' || statusOf.get(step.id) === 'dispatched',
        });
      }
    });

    // Dagre LR layout (workflow/useGraphLayout precedent).
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 44, ranksep: 70 });
    for (const n of rfNodes) g.setNode(n.id, { width: NODE_WIDTH, height: estimateNodeHeight(n.data) });
    for (const e of rfEdges) g.setEdge(e.source, e.target);
    dagre.layout(g);
    for (const n of rfNodes) {
      const pos = g.node(n.id);
      n.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - g.node(n.id).height / 2 };
    }

    return { nodes: rfNodes, edges: rfEdges };
  }, [def, run, selectedNodeId, cronSummary, customAgents, onAddAfter, t]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_e, node) => onSelectNode(node.id)}
      onPaneClick={() => onSelectNode(null)}
      minZoom={0.3}
      maxZoom={1.6}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border-1)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
