
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/presentation/components/aurora';
import { TaskTimer } from './TaskTimer';
import { ChevronRight, AlertCircle, Timer, Check } from 'lucide-react';
import { UnifiedTask } from '@/domain/models/task';
import { useStore } from '@/domain/store';
import { cn } from '@/shared/utils/design-system';
import { formatTokenUsageCompact } from '@/shared/utils/tokenUtils';
import {
  TaskGlowPulseLayer,
  ShimmerSweepOverlay,
  SparkleOrbits,
  NewChip,
  GlowHalo,
} from './kanban/TaskCardEffects';

/**
 * TaskCard — Aurora kanban task card.
 *
 * Layout follows the handoff TaskCardExpandable
 * (visual/ui/handoff/project/a2-workspace.jsx, KANBAN_COLUMNS + TaskCardExpandable):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [TYPE]  [band?]                              p{priority}  │  ← badge row
 *   │ Task name                                                 │
 *   │ Description (clamp 1 line collapsed / wrap when expanded) │
 *   │ [pkg1] [pkg2]   ⏱ 4m 12s        12.4k↑·3.4k↓  [˅/˄ pill] │  ← meta row
 *   └──────────────────────────────────────────────────────────┘
 *
 * Column color / gradient is supplied by the parent (KanbanColumns) so the
 * card's type-chip background, expanded border/glow stripe, and chevron pill
 * all reflect the column the card lives in (todo=violet, in-progress=pink,
 * completed=teal/cool). Falls back to a safe per-status default when omitted.
 */

interface TaskCardProps {
  task: UnifiedTask;
  status: 'todo' | 'in-progress' | 'completed';
  index?: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  /** When true and status==='todo', show NEW chip + sparkle/glow halo. */
  newlyAdded?: boolean;
  /** When true and status==='completed', the just-completed treatment is
   *  applied. The outer wrapper in KanbanColumns owns the halo + check chip;
   *  this flag remains as a contract marker so the column color/gradient
   *  context routes correctly here. */
  justCompleted?: boolean;
  /** Column-level accent color (e.g. `var(--violet-500)`). Defaults per status. */
  columnColor?: string;
  /** Column-level accent gradient (e.g. `var(--gradient-violet-pink)`). Defaults per status. */
  columnGradient?: string;
}

/** Default column color/gradient when the parent omits the explicit context. */
const STATUS_DEFAULTS: Record<
  TaskCardProps['status'],
  { color: string; gradient: string }
> = {
  todo: { color: 'var(--violet-500)', gradient: 'var(--gradient-violet-pink)' },
  'in-progress': { color: 'var(--pink-500)', gradient: 'var(--gradient-pink-orange)' },
  completed: { color: 'var(--teal-500)', gradient: 'var(--gradient-cool)' },
};

/**
 * Maximum height (px) of the expanded description area. Content longer than
 * this scrolls vertically within the area rather than growing the card.
 * Sized to comfortably show ~10–12 lines of description text at the current
 * font-size / line-height (11.5px / 1.55).
 */
const DESCRIPTION_EXPANDED_MAX_HEIGHT = 240;
/** Collapsed-state height (px) — one line clamp. Mirrors the previous inline value. */
const DESCRIPTION_COLLAPSED_MAX_HEIGHT = 24;

export function TaskCard({
  task,
  status,
  isExpanded = false,
  onToggleExpand,
  newlyAdded = false,
  justCompleted = false,
  columnColor,
  columnGradient,
}: TaskCardProps) {
  const { t } = useTranslation('kanban');
  // Get actual running state from store (preserved from previous wiring).
  const isTaskRunning = useStore((state) => state.isRunning);

  const defaultExpanded = isExpanded;
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);

  const expanded = onToggleExpand !== undefined ? isExpanded : localExpanded;
  const toggleExpand = onToggleExpand || (() => setLocalExpanded(!localExpanded));

  const hasDescription = !!task.description && task.description.trim() !== '';

  // Resolve column accent (parent-provided ▸ status default).
  const accent = {
    color: columnColor ?? STATUS_DEFAULTS[status].color,
    gradient: columnGradient ?? STATUS_DEFAULTS[status].gradient,
  };

  // `band` is defined on backend FeatureTask but not on UnifiedTask — read defensively.
  const taskBand = (task as unknown as { band?: string }).band;

  // Type label: uppercase verbatim of the task.type (FEATURE / DOC / TASK / …).
  const safeType = (task.type || 'task').toString();
  const typeLabel = safeType.toUpperCase();

  const showTodoNewState = status === 'todo' && newlyAdded;
  const showCompletedNewState = status === 'completed' && justCompleted;

  // Compose card-root style. Expanded state thickens the border to the column
  // accent and adds a soft glow matching the column. In-progress (non-expanded)
  // gets a column-accent pulse via task-glow-pulse.
  const baseShadow = 'var(--shadow-xs)';
  const expandedShadow = `0 0 22px oklch(from ${accent.color} l c h / 0.4), var(--shadow-md)`;

  // task-glow-pulse keyframe consumes `--task-glow` via the in-progress overlay.
  // For non-expanded in-progress we let TaskGlowPulseLayer drive the pulse; for
  // the card root itself we keep a quiet shadow so the pulse remains the focus.

  const rootStyle: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: `1px solid ${expanded ? accent.color : 'var(--border-1)'}`,
    borderRadius: 'var(--r-md)',
    color: 'var(--text-1)',
    boxShadow: expanded ? expandedShadow : baseShadow,
    transition:
      'transform var(--dur-base) var(--ease-spring), border-color var(--dur-base) var(--ease-smooth), box-shadow var(--dur-base) var(--ease-smooth)',
  };

  // Reserve right padding when NEW/completed chips occupy the top-right corner.
  const badgeRowRightPad =
    showTodoNewState || showCompletedNewState ? 56 : 0;

  return (
    <div
      className={cn(
        'p-3 relative min-w-0 w-full overflow-hidden',
        hasDescription ? 'cursor-pointer' : '',
      )}
      style={rootStyle}
      onClick={hasDescription ? toggleExpand : undefined}
    >
      {/* Top gradient stripe — expanded only, column accent. */}
      {expanded && (
        <div
          aria-hidden
          className="gradient-flow"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: accent.gradient,
            backgroundSize: '200% 200%',
            opacity: 0.9,
            zIndex: 4,
          }}
        />
      )}

      {/* In-progress aurora effects — column-accent driven. */}
      {status === 'in-progress' && !expanded && (
        <>
          <TaskGlowPulseLayer accent={accent} />
          <ShimmerSweepOverlay variant="in-progress" accent={accent} />
        </>
      )}

      {/* Newly-added todo: NEW state overlays (column-accent driven). */}
      {showTodoNewState && (
        <>
          <GlowHalo accent={accent} />
          <SparkleOrbits accent={accent} />
        </>
      )}

      {/* NEW chip — absolute top-right, sparkle-pop entry. */}
      {showTodoNewState && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }}>
          <NewChip accent={accent} />
        </div>
      )}

      {/* Newly-completed: completion overlays (column-accent driven).
          Mirrors the showTodoNewState pattern so the effect stack lives
          inside the card and does NOT alter outer width. */}
      {showCompletedNewState && (
        <>
          <GlowHalo accent={accent} />
          <ShimmerSweepOverlay variant="completed-slow" accent={accent} />
          <SparkleOrbits />
        </>
      )}

      {/* Completed check pill — absolute top-right, sparkle-pop entry.
          22×22 gradient-cool circle per handoff SSOT
          (visual/ui/handoff/project/a2-workspace.jsx L621–L647). */}
      {showCompletedNewState && (
        <div
          aria-hidden
          className="gradient-flow"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 5,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: accent.gradient,
            backgroundSize: '200% 200%',
            color: 'var(--text-on-brand)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 0 16px oklch(from ${accent.color} l c h / 0.7)`,
            animation: 'sparkle-pop 520ms var(--ease-spring) both',
          }}
        >
          <Check style={{ width: 12, height: 12 }} strokeWidth={3.5} />
        </div>
      )}

      {/* Card body */}
      <div className="relative" style={{ zIndex: 1 }}>
        {/* Badge row — type chip, optional band chip, priority on the right. */}
        <div
          className="flex items-center flex-wrap gap-1.5 mb-2 min-w-0"
          style={{ paddingRight: badgeRowRightPad }}
        >
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 'var(--r-pill)',
              background: `oklch(from ${accent.color} l c h / 0.18)`,
              color: accent.color,
              textTransform: 'uppercase',
              letterSpacing: '0.7px',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {typeLabel}
          </span>

          {taskBand && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: 'var(--r-pill)',
                background: 'var(--bg-surface-2)',
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              {taskBand}
            </span>
          )}

          {/* Failed badge — resumable failure, precedence over Paused. */}
          {status === 'todo' && task._failed && (
            <Badge
              tone="error"
              title={task._failureReason}
              className="flex items-center gap-1 flex-shrink-0"
              style={{
                background: 'var(--status-error-bg)',
                color: 'var(--status-error-fg)',
                borderColor: 'var(--border-1)',
              }}
            >
              <AlertCircle className="w-3 h-3" />
              <span className="font-semibold text-xs">{t('task.failed')}</span>
            </Badge>
          )}

          {/* Paused badge — interrupted but not failed. */}
          {status === 'todo' && task.interrupted && !task._failed && (
            <Badge
              tone="warning"
              className="flex items-center gap-1 flex-shrink-0"
              style={{
                background: 'var(--status-progress-bg)',
                color: 'var(--status-progress-fg)',
                borderColor: 'var(--border-1)',
              }}
            >
              <Timer className="w-3 h-3" />
              <span className="font-semibold text-xs">{t('task.paused')}</span>
            </Badge>
          )}

          {/* Spacer pushes priority to the right (handoff layout). */}
          <span style={{ flex: 1 }} />

          {task.priority !== undefined && (
            <span
              className="font-mono"
              style={{
                fontSize: 10,
                color: 'var(--text-4)',
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              p{task.priority}
            </span>
          )}
        </div>

        {/* Task name */}
        <div
          className="mb-2 min-w-0"
          style={{
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.4,
            color: 'var(--text-1)',
            overflowWrap: 'anywhere',
          }}
        >
          {task.name}
        </div>

        {/* Description — always rendered when present. Clamp to 1 line when
            collapsed; wrap fully when expanded. Expanded state caps the area
            height and scrolls overflowing content vertically inside the area,
            so the card itself never grows beyond the cap. */}
        {hasDescription && (
          <div
            className="mb-2 min-w-0"
            style={{
              fontSize: 11.5,
              lineHeight: 1.55,
              color: 'var(--text-3)',
              // Collapsed: hide overflow for one-line clamp.
              // Expanded: vertical scroll inside the capped area.
              overflowY: expanded ? 'auto' : 'hidden',
              overflowX: 'hidden',
              // Line clamp applies only when collapsed; expanded wraps freely.
              display: expanded ? 'block' : '-webkit-box',
              WebkitBoxOrient: expanded ? undefined : 'vertical',
              WebkitLineClamp: expanded ? 'unset' : 1,
              textOverflow: expanded ? 'clip' : 'ellipsis',
              maxHeight: expanded
                ? DESCRIPTION_EXPANDED_MAX_HEIGHT
                : DESCRIPTION_COLLAPSED_MAX_HEIGHT,
              whiteSpace: expanded ? 'pre-wrap' : 'normal',
              overflowWrap: 'anywhere',
              transition: 'max-height 300ms var(--ease-smooth)',
              // Prevent the browser from chaining the scroll up to the kanban
              // board when the description reaches its own scroll boundary.
              overscrollBehavior: 'contain',
            }}
            onClick={(e) => {
              // Allow text selection within the expanded description.
              if (expanded) e.stopPropagation();
            }}
            onWheel={(e) => {
              // Block wheel propagation to the kanban board / card root only
              // when the expanded area is actually scrollable. This keeps the
              // wheel gesture local to the description and avoids scrolling
              // the parent board behind it.
              if (!expanded) return;
              const el = e.currentTarget;
              if (el.scrollHeight > el.clientHeight) {
                e.stopPropagation();
              }
            }}
          >
            {task.description}
          </div>
        )}

        {/* Meta row — packages / elapsed / token usage / expand chevron. */}
        <div
          className="flex items-center flex-wrap gap-1.5 min-w-0"
          style={{ fontSize: 10, color: 'var(--text-4)' }}
        >
          {task.packages && task.packages.length > 0 ? (
            task.packages.map((p) => (
              <span
                key={p}
                className="font-mono"
                style={{
                  padding: '1px 6px',
                  borderRadius: '4px',
                  background: 'var(--bg-surface-2)',
                  color: 'var(--text-3)',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {p}
              </span>
            ))
          ) : task.sourceFiles && task.sourceFiles.length > 0 ? (
            task.sourceFiles.map((f) => (
              <span
                key={f}
                className="font-mono"
                style={{
                  padding: '1px 6px',
                  borderRadius: '4px',
                  background: 'var(--bg-surface-2)',
                  color: 'var(--text-3)',
                  fontWeight: 600,
                  maxWidth: '100%',
                  overflowWrap: 'anywhere',
                }}
              >
                {f}
              </span>
            ))
          ) : null}

          {/* Elapsed time — in-progress (live) and completed (final). */}
          {status === 'in-progress' && (
            <span
              className="font-mono"
              style={{ color: 'var(--text-3)', flexShrink: 0 }}
            >
              ⏱ <TaskTimer timing={task.timing} isRunning={isTaskRunning} />
            </span>
          )}
          {status === 'completed' &&
            task.timing &&
            task.timing.elapsedTime !== undefined && (
              <span
                className="font-mono"
                style={{ color: 'var(--text-3)', flexShrink: 0 }}
              >
                ⏱ <TaskTimer timing={task.timing} />
              </span>
            )}

          {/* Spacer */}
          <span style={{ flex: 1 }} />

          {/* Token usage — compact one-liner. */}
          {(status === 'in-progress' || status === 'completed') &&
            task.tokenUsage && (
              <span
                className="font-mono"
                style={{ color: 'var(--text-3)', flexShrink: 0 }}
              >
                {formatTokenUsageCompact(task.tokenUsage)}
              </span>
            )}

          {/* Expand chevron pill — single entry point besides full-card click. */}
          {hasDescription && (
            <span
              role="button"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              className={expanded ? 'gradient-flow' : ''}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: expanded ? accent.gradient : 'var(--bg-surface-2)',
                backgroundSize: '200% 200%',
                color: expanded ? 'var(--text-on-brand)' : 'var(--text-3)',
                transition:
                  'transform var(--dur-base) var(--ease-spring), background var(--dur-base) var(--ease-smooth), color var(--dur-base) var(--ease-smooth)',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                flexShrink: 0,
                cursor: 'pointer',
              }}
            >
              <ChevronRight
                className="w-2.5 h-2.5"
                style={{ transform: 'rotate(90deg)' }}
                strokeWidth={3}
              />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
