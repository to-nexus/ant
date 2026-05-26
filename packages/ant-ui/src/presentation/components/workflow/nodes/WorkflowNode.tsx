/**
 * WorkflowNode Component
 *
 * Aurora-tokenized workflow node.
 *
 * State signals (NO palette tints):
 *  - running (data.isActive=true)              → violet borderglow
 *  - todo    (isActive=false, not yet visited) → opacity 0.45
 *  - done    (visited && !isActive)            → opacity 0.9
 *
 * Worker chip stack is gated on plan/execute phase nodes only.
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position } from 'reactflow';
import { NodeType, NodeImportance, ActiveWorkerNode } from '@/domain/models/workflow';
import { cn } from '@/shared/utils/design-system';
import { getActorInfoList } from '@/shared/utils/actor-utils';

interface NodeData {
  id?: string;                  // Optional node id (used for phase gating of worker chips)
  label: string;
  description?: string;
  importance: NodeImportance;
  isActive?: boolean;
  visitedBefore?: boolean;      // True once the node has been entered at least once
  workers?: ActiveWorkerNode[]; // Workers currently active on this node
  nodeType: NodeType;
  actors?: string[];            // Actor IDs
  isExpanded?: boolean;
  llmInfo?: { provider: string; model: string };
}

interface WorkflowNodeProps {
  data: NodeData;
}

// Worker chips are only meaningful for plan / execute phase nodes.
function isWorkerChipPhase(identifier: string | undefined): boolean {
  const normalized = (identifier ?? '').toLowerCase().trim();
  return normalized === 'plan' || normalized === 'execute';
}

// 노드 크기
const NODE_SIZE = {
  collapsed: {
    width: 160,
    height: 64,
    fontSize: '14px',
    fontWeight: '600',
    borderWidth: 2
  },
  expanded: {
    width: 360,
    height: 120,
    fontSize: '14px',
    fontWeight: '600',
    borderWidth: 3
  }
};

export const WorkflowNode = memo(({ data }: WorkflowNodeProps) => {
  const { t } = useTranslation('kanban');
  const isExpanded = data.isExpanded || false;
  const size = isExpanded ? NODE_SIZE.expanded : NODE_SIZE.collapsed;

  const actorInfoList = getActorInfoList(data.actors || [], data.llmInfo);

  // Fixed LR layout — workflow is a full-pane view, edges flow left → right.
  const targetPosition = Position.Left;
  const sourcePosition = Position.Right;

  // State-signal opacity derivation: running > done > todo.
  const isRunning = data.isActive === true;
  const isDone = !isRunning && data.visitedBefore === true;
  const stateOpacity = isRunning ? 1 : (isDone ? 0.9 : 0.45);

  // Phase gate for worker chip stack.
  const showWorkerChips =
    isWorkerChipPhase(data.id ?? data.label) &&
    isRunning &&
    !!data.workers &&
    data.workers.length > 0;

  if (isExpanded) {
    // 확장된 상태
    const expandedStyle: React.CSSProperties = {
      width: size.width,
      borderWidth: size.borderWidth,
      borderStyle: 'solid',
      borderColor: isRunning ? 'transparent' : 'var(--border-1)',
      background: 'var(--bg-surface)',
      color: 'var(--text-1)',
      borderRadius: 'var(--r-md, 12px)',
      opacity: stateOpacity,
      boxShadow: isRunning
        ? 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18)), 0 0 0 2px var(--violet-500), 0 0 24px var(--shadow-glow-aurora)'
        : 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18))',
      zIndex: 1000
    };

    return (
      <div
        className="workflow-node rounded-lg transition-all duration-300 relative"
        style={expandedStyle}
      >
        <Handle
          type="target"
          position={targetPosition}
          style={{ background: 'var(--border-1)' }}
        />

        {/* Expanded Content */}
        <div className="p-4 space-y-3">
          {/* Title */}
          <div className="text-center">
            <div
              className="font-semibold"
              style={{ fontSize: size.fontSize, color: 'var(--text-1)' }}
            >
              {data.label}
            </div>
          </div>

          {/* Description */}
          {data.description && (
            <div
              className="text-xs leading-relaxed"
              style={{ color: 'var(--text-2)' }}
            >
              {data.description}
            </div>
          )}

          {/* Linked Actors */}
          {actorInfoList.length > 0 && (
            <div className="space-y-2">
              <div
                className="text-xs font-semibold"
                style={{ color: 'var(--text-3)' }}
              >
                {t('workflow.linkedActors')}
              </div>
              <div className="flex flex-wrap gap-2">
                {actorInfoList.map((actor) => (
                  <div
                    key={actor.id}
                    className="text-xs px-2 py-1 rounded font-mono flex items-center gap-1.5"
                    style={{
                      background: 'var(--bg-surface-2)',
                      color: 'var(--text-1)',
                      border: '1px solid var(--border-1)'
                    }}
                  >
                    <span>{actor.icon}</span>
                    <span className="font-medium">{actor.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <Handle
          type="source"
          position={sourcePosition}
          style={{ background: 'var(--border-1)' }}
        />
      </div>
    );
  }

  // 접힌 상태 (기본)
  const collapsedStyle: React.CSSProperties = {
    width: size.width,
    height: size.height,
    background: 'var(--bg-surface)',
    color: 'var(--text-1)',
    borderRadius: 'var(--r-md, 12px)',
    borderStyle: 'solid',
    borderWidth: isRunning ? 2 : 1,
    borderColor: isRunning ? 'transparent' : 'var(--border-1)',
    boxShadow: isRunning
      ? '0 0 0 2px var(--violet-500), 0 0 24px var(--shadow-glow-aurora)'
      : 'none',
    opacity: stateOpacity,
    zIndex: 1
  };

  return (
    <div
      className={cn(
        'workflow-node flex flex-col items-center justify-center relative',
        'transition-all duration-200 cursor-pointer'
      )}
      style={collapsedStyle}
    >
      <Handle
        type="target"
        position={targetPosition}
        style={{ background: 'var(--border-1)' }}
      />

      <div className="text-center px-2 w-full">
        <div
          className="truncate"
          style={{
            fontSize: size.fontSize,
            fontWeight: size.fontWeight,
            color: 'var(--text-1)'
          }}
          title={data.label}
        >
          {data.label}
        </div>
      </div>

      {/* Worker chip stack — plan/execute phases only, taskName only */}
      {showWorkerChips && (
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full flex flex-col items-center gap-0.5">
          {data.workers!.map((w) => (
            <span
              key={w.workerId}
              className="font-mono text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-1)',
                color: 'var(--text-1)'
              }}
            >
              {w.taskName}
            </span>
          ))}
        </div>
      )}

      <Handle
        type="source"
        position={sourcePosition}
        style={{ background: 'var(--border-1)' }}
      />
    </div>
  );
});

WorkflowNode.displayName = 'WorkflowNode';

