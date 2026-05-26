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
import { Sparkles } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
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

/**
 * Running-state aurora overlay.
 *
 * Absolute-positioned child rendered inside the (already `relative`) workflow
 * node root. The overlay paints an aurora-gradient ring that visually replaces
 * the previous static violet box-shadow ring. Shared by collapsed and expanded
 * branches to avoid drift.
 *
 * Tokens are owned by `styles/aurora-tokens.css`:
 *   - `--gradient-aurora`     (gradient definition)
 *   - `.gradient-flow`        (background-size 200% + gradient-shift keyframe)
 *   - `--shadow-glow-aurora`  (applied via box-shadow on the node itself)
 */
function RunningAuroraOverlay() {
  return (
    <div
      aria-hidden="true"
      className="gradient-flow"
      style={{
        position: 'absolute',
        inset: -2,
        borderRadius: 'inherit',
        background: 'var(--gradient-aurora)',
        backgroundSize: '200% 200%',
        zIndex: -1,
        pointerEvents: 'none'
      }}
    />
  );
}

/**
 * 활성 상태(running) 노드용 3-layer 모션 스택.
 *
 * 칸반 in-progress 카드(TaskCardEffects.tsx)의 ShimmerSweepOverlay +
 * TaskGlowPulseLayer 조합과 동등한 시각 강도를 워크플로 노드에 적용하기 위한
 * colocation 헬퍼다. SparkleOrbits는 노드 크기(160×64) 대비 시각 잡음이 과해
 * 의도적으로 제외했다.
 *
 * 레이어 z-index 순서:
 *   - RunningAuroraOverlay : zIndex -1 (외곽 aurora ring, 노드 바깥)
 *   - soft glow pulse      : zIndex  1 (task-glow-pulse 2.6s)
 *   - diagonal shimmer band: zIndex  2 (task-shimmer-sweep 1.6s)
 *
 * 키프레임(task-glow-pulse, task-shimmer-sweep)은 styles/aurora-tokens.css의
 * 기존 자산만 재사용한다 — 신규 토큰/키프레임 정의 금지.
 *
 * prefers-reduced-motion: reduce 환경에서는 헬퍼 전체가 null을 반환하여
 * 두 신규 오버레이를 비활성화한다. 외곽 RunningAuroraOverlay도 함께 사라지지만,
 * border-color/box-shadow 등 비-애니메이션 active 시각 신호는 노드 root에서
 * 유지되므로 active 상태 식별에는 영향이 없다.
 */
function WorkflowNodeRunningEffects({ rounded }: { rounded: string }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <>
      {/* 1) Outer aurora ring — 기존 RunningAuroraOverlay 재사용 */}
      <RunningAuroraOverlay />
      {/* 2) Soft pulsing glow — task-glow-pulse 2.6s infinite */}
      <div
        aria-hidden
        className={`absolute inset-0 pointer-events-none ${rounded}`}
        style={{
          ['--task-glow' as string]: 'var(--violet-500)',
          animation: 'task-glow-pulse 2.6s var(--ease-smooth) infinite',
          zIndex: 1,
        }}
      />
      {/* 3) Diagonal shimmer band — task-shimmer-sweep 1.6s infinite */}
      <div
        aria-hidden
        className={`absolute inset-0 pointer-events-none overflow-hidden ${rounded}`}
        style={{ zIndex: 2 }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(110deg, transparent 0%, oklch(from var(--violet-300) l c h / 0.55) 40%, oklch(from var(--pink-300) l c h / 0.75) 50%, oklch(from var(--violet-300) l c h / 0.55) 60%, transparent 100%)',
            animation: 'task-shimmer-sweep 1.6s var(--ease-smooth) infinite',
            filter: 'blur(1px)',
          }}
        />
      </div>
    </>
  );
}

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
      borderWidth: isRunning ? 1.5 : size.borderWidth,
      borderStyle: 'solid',
      borderColor: isRunning ? 'transparent' : 'var(--border-1)',
      background: 'var(--bg-surface)',
      color: 'var(--text-1)',
      borderRadius: 'var(--r-md, 12px)',
      opacity: stateOpacity,
      boxShadow: isRunning
        ? 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18)), var(--shadow-glow-aurora)'
        : 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.18))',
      zIndex: 1000
    };

    return (
      <div
        className="workflow-node rounded-lg transition-all duration-300 relative"
        style={expandedStyle}
      >
        {isRunning && <WorkflowNodeRunningEffects rounded="rounded-lg" />}
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
    borderWidth: isRunning ? 1.5 : 1,
    borderColor: isRunning ? 'transparent' : 'var(--border-1)',
    boxShadow: isRunning
      ? 'var(--shadow-glow-aurora)'
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
      {isRunning && <WorkflowNodeRunningEffects rounded="rounded-lg" />}
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
              className="gradient-flow font-mono text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap inline-flex items-center gap-1"
              style={{
                background: 'var(--gradient-aurora)',
                backgroundSize: '200% 200%',
                color: 'white',
                border: 'none',
                boxShadow: '0 0 10px oklch(60% 0.25 320 / 0.45)'
              }}
              title={w.taskName}
            >
              <Sparkles className="w-2.5 h-2.5" strokeWidth={3} />
              <span className="truncate max-w-[140px]">{w.taskName}</span>
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

