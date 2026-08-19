/**
 * PipelineCanvas — the n8n-style DAG surface. Node click = inspector focus,
 * "+" on a node = insert-after (linear defs), live-run statuses overlay the
 * nodes so the canvas doubles as the run monitor. Dagre LR layout
 * (components/workflow precedent — no new graph deps).
 */

import { useMemo } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls, MarkerType, type Edge, type Node, type NodeTypes } from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { useTranslation } from 'react-i18next';
import { isApprovalStep, type PipelineDef, type PipelineStepStatus } from '@ant/shared';
import type { PipelineRunPublic } from '@/domain/store/slices/pipelineSlice';
import { TriggerNode, StepNode, GateNode, type PipelineNodeData } from './nodes';
import { TRIGGER_NODE_ID, effectiveNeedsOf, stepsAreLinear } from '../draft';

const nodeTypes: NodeTypes = {
  pipelineTrigger: TriggerNode,
  pipelineStep: StepNode,
  pipelineGate: GateNode,
};

const NODE_WIDTH = 210;
const NODE_HEIGHT = 78;

export interface PipelineCanvasProps {
  def: PipelineDef;
  cronSummary: string;
  run?: PipelineRunPublic | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onAddAfter?: (afterNodeId: string, kind: 'job' | 'gate') => void;
}

export function PipelineCanvas({ def, cronSummary, run, selectedNodeId, onSelectNode, onAddAfter }: PipelineCanvasProps) {
  const { t } = useTranslation('pipelines');
  const linear = stepsAreLinear(def);

  const { nodes, edges } = useMemo(() => {
    const statusOf = new Map<string, PipelineStepStatus>();
    if (run && (run.status === 'running' || run.status === 'awaiting_human')) {
      for (const s of run.steps) statusOf.set(s.stepId, s.status);
    } else if (run) {
      for (const s of run.steps) statusOf.set(s.stepId, s.status);
    }

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
          onAdd: onAddAfter && linear ? onAddAfter : undefined,
        },
      },
    ];

    def.steps.forEach((step) => {
      const gate = isApprovalStep(step);
      const invalid = gate
        ? step.prompt.trim().length === 0
        : step.customJobRef.trim().length === 0 || step.directive.trim().length === 0;
      rfNodes.push({
        id: step.id,
        type: gate ? 'pipelineGate' : 'pipelineStep',
        position: { x: 0, y: 0 },
        data: {
          nodeId: step.id,
          title: gate ? t('canvas.approval', 'Approval') : step.customJobRef || t('canvas.unconfigured', 'Choose a job…'),
          subtitle: gate
            ? step.timeout
              ? `${step.timeout.after} → ${step.timeout.onTimeout}`
              : t('canvas.noTimeout', 'no timeout')
            : step.id,
          chip: !gate && step.intent ? step.intent : undefined,
          status: statusOf.get(step.id),
          selected: selectedNodeId === step.id,
          invalid,
          onAdd: onAddAfter && linear ? onAddAfter : undefined,
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
    for (const n of rfNodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    for (const e of rfEdges) g.setEdge(e.source, e.target);
    dagre.layout(g);
    for (const n of rfNodes) {
      const pos = g.node(n.id);
      n.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
    }

    return { nodes: rfNodes, edges: rfEdges };
  }, [def, run, selectedNodeId, cronSummary, onAddAfter, linear, t]);

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
