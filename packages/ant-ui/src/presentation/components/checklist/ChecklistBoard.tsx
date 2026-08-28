import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FileText, ListTodo, Pause } from 'lucide-react';
import { BoardContainer } from '../BoardContainer';
import { ElapsedTimeBadge, TokenUsageBadge, GaugesGroup } from '../kanban/KanbanHeader';
import { useStore } from '@/domain/store';
import { selectActivePipelineForSelectedProject } from '@/domain/store/selectors/pipelines';
import type { UniversalChecklistItem } from '@ant/shared';
import { KanbanData } from '@/infrastructure/http/api';
import { Spinner } from '@/presentation/components/common/async';
import { PipelineOriginChip } from '../Pipelines/PipelineOriginChip';
import {
  BOARD_BODY_PADDING,
  COLUMN_GAP,
  SINGLE_COLUMN_MAX_WIDTH,
  checklistColumnCount,
} from './checklistLayout';

interface ChecklistBoardProps {
  kanbanData: KanbanData;
}

/**
 * ChecklistBoard — the workspace (universal) project's board surface,
 * replacing the kanban board (universal jobs have no tasks; checklist items
 * are NOT tasks and must never be cast into BaseTask cards).
 *
 * Renders `kanbanData.checklist` as one ordered list (FIFO — declared order
 * preserved, at most one active item) with the same header chrome the other
 * boards share. Two layout contracts:
 *
 *   - The body SCROLLS (`scrollBody`). Before that opt-in existed the board
 *     inherited BoardContainer's `overflow-hidden` and a long checklist was
 *     hard-clipped at the bottom with no scrollbar.
 *   - Wide containers go MULTI-COLUMN via CSS columns, i.e. column-major, so
 *     the FIFO order still reads down-then-across. A row-major grid would
 *     scatter the sequence. `checklistLayout.ts` owns the count.
 *
 * `ChecklistItemRow` is a near-twin of QuickStart's `StepRow`; they are kept
 * apart deliberately — onboarding has its own status vocabulary (`complete`
 * vs `done`) and no interrupted state.
 */
export function ChecklistBoard({ kanbanData }: ChecklistBoardProps) {
  const { t } = useTranslation('nav');
  const systemRecursionLimit = useStore((state) => state.recursionLimit);
  // The work tab marks pipeline-driven work: while the project's active
  // pipeline is running, the current job IS a pipeline step.
  const activePipeline = useStore((state) => selectActivePipelineForSelectedProject(state));
  const pipelineRunning = activePipeline && (activePipeline.state === 'running' || activePipeline.state === 'awaiting_human');
  const checklist = kanbanData.checklist;
  const items = checklist?.items ?? [];
  const doneCount = items.filter((i) => i.state === 'done').length;
  // Per-frame liveness (same predicate as kanbanReducer): an `active` item on
  // a non-running board is by definition interrupted — the item state itself
  // is never rewritten, so sealed snapshots and history replays settle too.
  const running = kanbanData.dataSource === 'live' || kanbanData.dataSource === 'estimating';

  const [boardWidth, attachBoard] = useMeasuredWidth();
  const columns = checklistColumnCount(boardWidth, items.length);
  const percent = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  const activeRef = useRef<HTMLDivElement>(null);
  const activeId = items.find((i) => i.state === 'active')?.id;
  // Once the list scrolls, "where am I" is the first thing that goes missing.
  useEffect(() => {
    if (!activeId || !running) return;
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId, running]);

  return (
    <BoardContainer
      className="checklist-board"
      scrollBody
      titleActions={
        <>
          {pipelineRunning && <PipelineOriginChip pipelineId={activePipeline!.pipelineId} />}
          <ElapsedTimeBadge jobTiming={kanbanData.jobTiming} completedTasks={[]} inProgressTasks={[]} />
          <TokenUsageBadge
            jobId={kanbanData.jobId}
            tokenUsage={kanbanData.tokenUsage}
            tokenUsageByModel={kanbanData.tokenUsageByModel}
            estimatingTokenUsage={kanbanData.estimatingTokenUsage}
            phaseTokenUsages={kanbanData.phaseTokenUsages}
            completedTasks={[]}
            inProgressTasks={[]}
          />
        </>
      }
      headerActions={
        <GaugesGroup
          recursionCount={kanbanData.recursionCount}
          recursionLimit={kanbanData.recursionLimit || systemRecursionLimit}
          recursionTaskName={kanbanData.recursionTaskName}
        />
      }
    >
      <div ref={attachBoard} className="h-full">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: 'var(--text-3)' }}>
            <ListTodo className="w-8 h-8" style={{ color: 'var(--text-4)' }} />
            <span className="text-sm text-center px-6">
              {t('checklistBoard.empty', 'No checklist for this turn — the agent creates one for multi-deliverable work.')}
            </span>
          </div>
        ) : (
          <div
            className="mx-auto px-2 pb-8"
            style={{ maxWidth: columns === 1 ? SINGLE_COLUMN_MAX_WIDTH : undefined }}
          >
            <ProgressSummary
              done={doneCount}
              total={items.length}
              percent={percent}
              sourcePlanPath={checklist?.sourcePlanPath}
            />
            <div
              className="pt-4"
              style={{ columnCount: columns, columnGap: COLUMN_GAP }}
            >
              {items.map((item, index) => (
                <ChecklistItemRow
                  key={item.id}
                  ref={item.id === activeId ? activeRef : undefined}
                  item={item}
                  index={index + 1}
                  running={running}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </BoardContainer>
  );
}

/**
 * Column count needs the container's OWN width, not the viewport's — the board
 * shares the main panel with the chat and the terminal. Returns a ref callback
 * to attach to the box being measured.
 */
function useMeasuredWidth(): [number, (el: HTMLElement | null) => void] {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const attach = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    observerRef.current = ro;
    setWidth(el.clientWidth);
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return [width, attach];
}

/** Sticky progress bar — pinned inside the scroll body, above the items. */
function ProgressSummary({
  done,
  total,
  percent,
  sourcePlanPath,
}: {
  done: number;
  total: number;
  percent: number;
  sourcePlanPath?: string;
}) {
  const { t } = useTranslation('nav');
  return (
    <div
      className="sticky z-[1] flex flex-wrap items-center gap-x-4 gap-y-2 pb-3"
      style={{
        // Pin past the scroll body's own padding, then pad back, so no row is
        // ever visible in the gap above the bar.
        top: -BOARD_BODY_PADDING,
        paddingTop: BOARD_BODY_PADDING + 4,
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-1)',
      }}
    >
      <div
        className="h-1.5 rounded-full overflow-hidden shrink-0"
        style={{ width: 140, background: 'var(--bg-surface-3)' }}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${percent}%`,
            background: 'var(--status-done-bg, oklch(70% 0.16 160))',
          }}
        />
      </div>
      <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        {t('checklistBoard.progress', '{{done}} of {{total}} done', { done, total })}
      </span>
      <span className="flex-1" />
      {sourcePlanPath && (
        <span
          className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full max-w-full"
          style={{ background: 'var(--bg-surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-1)' }}
          title={sourcePlanPath}
        >
          <FileText className="w-3 h-3 shrink-0" />
          <span className="shrink-0">{t('checklistBoard.fromPlan', 'From plan')}:</span>
          <code className="font-mono truncate">{sourcePlanPath}</code>
        </span>
      )}
    </div>
  );
}

/** Single checklist row — pending ring / active spinner / interrupted pause / done check. */
export function ChecklistItemRow({
  item,
  index,
  running,
  ref,
}: {
  item: UniversalChecklistItem;
  /** 1-based ordinal — keeps the FIFO order readable once the list goes multi-column. */
  index?: number;
  running: boolean;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation('nav');
  const status = item.state;
  const interrupted = status === 'active' && !running;
  return (
    <div
      ref={ref}
      className={`flex items-start gap-3 py-2 transition-all duration-300 ${
        status === 'pending' ? 'opacity-60' : status === 'done' ? 'opacity-70' : 'opacity-100'
      }`}
      // A row must never be split across a column boundary.
      style={{ breakInside: 'avoid', WebkitColumnBreakInside: 'avoid' } as React.CSSProperties}
    >
      {index != null && (
        <span
          className="shrink-0 text-xs font-mono tabular-nums leading-5 text-right"
          style={{ color: 'var(--text-4)', minWidth: 18 }}
        >
          {index}
        </span>
      )}
      <div className="shrink-0 w-5 h-5 flex items-center justify-center">
        {status === 'done' ? (
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'var(--status-done-bg, oklch(70% 0.16 160))', color: 'var(--text-on-brand)' }}
          >
            <Check className="w-3 h-3" strokeWidth={3} style={{ color: 'var(--text-on-brand)' }} />
          </div>
        ) : interrupted ? (
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ border: '2px solid var(--border-2)' }}
          >
            <Pause className="w-3 h-3" style={{ color: 'var(--text-3)' }} />
          </div>
        ) : status === 'active' ? (
          <Spinner size="lg" style={{ color: 'var(--violet-500)' }} />
        ) : (
          <div className="w-5 h-5 rounded-full" style={{ border: '2px solid var(--border-2)' }} />
        )}
      </div>
      {/* The text is the deliverable statement, so it wraps freely rather than
          clamping. `anywhere` lets a long path or tool name break instead of
          being pushed whole to the next line. */}
      <span
        className={`flex-1 min-w-0 text-sm leading-5 transition-colors duration-300 ${
          status === 'active' && !interrupted ? 'font-medium' : ''
        } ${status === 'done' ? 'line-through' : ''}`}
        style={{
          overflowWrap: 'anywhere',
          color:
            status === 'active'
              ? interrupted
                ? 'var(--text-2)'
                : 'var(--violet-600)'
              : status === 'done'
                ? 'var(--text-2)'
                : 'var(--text-3)',
        }}
      >
        {item.text}
      </span>
      {interrupted && (
        <span
          className="inline-flex items-center text-xs px-2 py-0.5 rounded-full shrink-0"
          style={{ background: 'var(--bg-surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-1)' }}
        >
          {t('checklistBoard.interrupted', 'Interrupted')}
        </span>
      )}
    </div>
  );
}
