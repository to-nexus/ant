
import type { ReactNode } from 'react';

/**
 * Column-level accent tokens. Mirrors the handoff `KANBAN_COLUMNS` palette
 * (visual/ui/handoff/project/a2-workspace.jsx) using the nearest Aurora
 * tokens — todo=violet, in-progress=pink, completed=cool/teal.
 *
 * Exported as a named constant so every consumer of `KanbanColumnShell`
 * (the live `KanbanColumns` and the `KanbanEstimatingSkeleton`) shares
 * a single source of truth for column accents.
 */
export const COLUMN_TOKENS = {
  todo: {
    color: 'var(--violet-500)',
    gradient: 'var(--gradient-violet-pink)',
  },
  inProgress: {
    color: 'var(--pink-500)',
    gradient: 'var(--gradient-pink-orange)',
  },
  completed: {
    color: 'var(--teal-500)',
    gradient: 'var(--gradient-cool)',
  },
} as const;

export interface KanbanColumnShellProps {
  accent: { color: string; gradient: string };
  label: string;
  /**
   * Counter pill content. `number` for live counts, `string` for the
   * "···" placeholder shown during decompose/estimating.
   */
  count: number | string;
  isHorizontalSplit: boolean;
  children: ReactNode;
}

/**
 * KanbanColumnShell — handoff column container.
 * Wraps a header row (color dot + label + counter pill, with a 2px gradient
 * bar at the very top) and a scrollable list body. Both layout modes
 * (horizontal split / vertical split) share the same chrome.
 */
export function KanbanColumnShell({
  accent,
  label,
  count,
  isHorizontalSplit,
  children,
}: KanbanColumnShellProps) {
  return (
    <div
      className={isHorizontalSplit ? 'flex flex-col' : 'flex flex-col min-h-0'}
      style={{
        // Outline-only frame: 12% surface 반투명 배경으로 aurora mesh가
        // 컬럼 영역에서도 은은하게 비치게 한다. backdrop blur는 유지하여
        // 카드 가독성을 확보한다.
        background: 'color-mix(in oklab, var(--bg-surface) 12%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderRadius: 'var(--r-xl)',
        // 컬럼별 액센트색 1.5px 외곽선 — 상단 2px 액센트 바와 함께
        // 컬럼 정체성을 이중 강화한다 (todo=violet / inProgress=pink /
        // completed=teal). color-mix로 55% 농도를 적용해 라이트/다크
        // 양쪽에서 자연스러운 톤을 유지한다.
        border: `1.5px solid color-mix(in oklab, ${accent.color} 55%, transparent)`,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Header */}
      <div
        className="relative flex items-center gap-2 px-3.5 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border-1)' }}
      >
        {/* Top 2px gradient bar */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: accent.color,
            opacity: 0.85,
          }}
        />
        {/* Color dot */}
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: accent.color,
            boxShadow: `0 0 14px ${accent.color}`,
            flexShrink: 0,
          }}
        />
        <h3
          className="font-semibold text-sm truncate"
          style={{ color: 'var(--text-1)' }}
        >
          {label}
        </h3>
        <span
          className="ml-auto px-2 py-[2px] rounded-full text-[10px] font-bold"
          style={{
            background: 'var(--bg-surface-3)',
            color: 'var(--text-2)',
          }}
        >
          {count}
        </span>
      </div>
      {/* Body */}
      <div
        className={
          isHorizontalSplit
            ? 'flex flex-col gap-2 p-2.5'
            : 'flex flex-col gap-2 p-2.5 overflow-y-auto scrollbar-hide'
        }
      >
        {children}
      </div>
    </div>
  );
}
