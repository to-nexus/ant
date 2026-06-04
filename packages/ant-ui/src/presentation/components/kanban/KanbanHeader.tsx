import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDot, Zap } from 'lucide-react';
import { formatElapsedTime } from '@/shared/utils/timeUtils';
import { formatTokenCount, formatPercent, getTokenUsageMetrics, sumTokenUsages } from '@/shared/utils/tokenUtils';
import { JobTiming, TaskTokenUsage, PhaseTokenUsage } from '@/domain/models/types';
import { Tooltip } from '../common/Tooltip';
import { useStore } from '@/domain/store';
import { cn } from '@/shared/utils/design-system';

/**
 * useRealtimeTick - Forces a re-render every second while `enabled` is true.
 * Used to drive Date.now()-based calculations without stale closures.
 */
function useRealtimeTick(enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [enabled]);
}

/**
 * LiveElapsedTime - Real-time elapsed time from a startedAt timestamp.
 * Used inside tooltips for in-progress items.
 */
function LiveElapsedTime({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - new Date(startedAt).getTime()));

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const update = () => setElapsed(Math.max(0, Date.now() - start));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <>{formatElapsedTime(elapsed, true)}</>;
}

/**
 * Wall-clock elapsed time from JobTiming.
 * Pure function — call on every render for real-time display.
 * Uses the same formula for all states (completed/paused/running).
 */
function calculateJobElapsed(jobTiming: JobTiming): number {
  const start = new Date(jobTiming.startedAt).getTime();
  const paused = jobTiming.totalPausedDuration || 0;

  if (jobTiming.completedAt) {
    return Math.max(0, new Date(jobTiming.completedAt).getTime() - start - paused);
  }
  if (jobTiming.pausedAt) {
    return Math.max(0, new Date(jobTiming.pausedAt).getTime() - start - paused);
  }
  return Math.max(0, Date.now() - start - paused);
}

/**
 * Calculate wall-clock duration for the tasks phase using interval merging.
 * Overlapping intervals (parallel tasks) are merged so their time is not double-counted.
 */
function calculateTasksWallClock(
  completedTasks?: Array<{ timing?: { startedAt?: string; completedAt?: string } }>,
  inProgressTasks?: Array<{ timing?: { startedAt?: string } }>
): number {
  const intervals: [number, number][] = [];

  for (const task of completedTasks || []) {
    if (task.timing?.startedAt && task.timing?.completedAt) {
      intervals.push([
        new Date(task.timing.startedAt).getTime(),
        new Date(task.timing.completedAt).getTime(),
      ]);
    }
  }
  for (const task of inProgressTasks || []) {
    if (task.timing?.startedAt) {
      intervals.push([new Date(task.timing.startedAt).getTime(), Date.now()]);
    }
  }
  if (intervals.length === 0) return 0;

  intervals.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i][0] <= last[1]) {
      last[1] = Math.max(last[1], intervals[i][1]);
    } else {
      merged.push(intervals[i]);
    }
  }
  return merged.reduce((sum, [s, e]) => sum + (e - s), 0);
}

interface ElapsedTimeBadgeProps {
  jobTiming?: JobTiming;
  completedTasks?: Array<{
    id: string;
    name: string;
    timing?: {
      startedAt?: string;
      completedAt?: string;
      elapsedTime?: number;
    };
  }>;
  inProgressTasks?: Array<{
    id: string;
    name: string;
    timing?: {
      startedAt?: string;
      elapsedTime?: number;
    };
  }>;
  estimatingActivity?: {
    label: string;
    startedAt: string;
  } | null;
  /**
   * Compact mode (h-5, text-[10px]) for dense inline contexts such as the
   * Job-tab dropdown rows. Tooltip content is unchanged.
   */
  compact?: boolean;
  /**
   * When true, tracks real-time only when this specific job is the one the
   * store considers running. Defaults to `true` to preserve the original
   * header behaviour; the dropdown passes `false` for non-current rows so
   * historical snapshots render as static.
   */
  tickFromStore?: boolean;
}

/**
 * ElapsedTimeBadge - Real-time 뱃지 우측에 위치할 경과 시간 뱃지 (with breakdown tooltip)
 *
 * ✅ FIX: Tick-driven re-render + pure Date.now() calculation on every render.
 * No state for elapsed time — avoids stale-value reset from SSE object reference changes.
 * Same proven pattern as LiveElapsedTime.
 */
export function ElapsedTimeBadge({
  jobTiming,
  completedTasks,
  inProgressTasks,
  estimatingActivity,
  compact = false,
  tickFromStore = true,
}: ElapsedTimeBadgeProps) {
  const { t } = useTranslation('kanban');
  // ✅ FIX: Also check store.isRunning as a safety net.
  // If the backend fails to set completedAt/pausedAt on jobTiming (e.g., plan jobs before this fix),
  // the workflow end event still sets store.isRunning=false, which stops the timer.
  const storeIsRunning = useStore((s) => s.isRunning);
  const timingIsRunning = !!jobTiming?.startedAt && !jobTiming?.completedAt && !jobTiming?.pausedAt;
  const isRunning = (tickFromStore ? storeIsRunning : true) && timingIsRunning;
  useRealtimeTick(isRunning);
  
  // ✅ Show badge if job has timing data
  if (!jobTiming) {
    return null;
  }

  const realtimeElapsed = calculateJobElapsed(jobTiming);
  
  // Format elapsed time (include seconds for real-time updates)
  const formattedTime = formatElapsedTime(realtimeElapsed, true);
  
  // Calculate breakdown
  const estimatingTime = jobTiming.estimatingDuration || 0;
  const isEstimatingFinalized = !!jobTiming.estimatingDuration;
  const tasksTotal = calculateTasksWallClock(completedTasks, inProgressTasks);
  const taskCount = (completedTasks?.length || 0) + (inProgressTasks?.length || 0);
  const tasksSequentialSum = (completedTasks?.reduce((s, t) => s + (t.timing?.elapsedTime || 0), 0) || 0)
    + (inProgressTasks?.reduce((s, t) => s + (t.timing?.startedAt ? Date.now() - new Date(t.timing.startedAt).getTime() : 0), 0) || 0);
  const parallelSaved = tasksSequentialSum - tasksTotal;
  
  // Build tooltip content
  const tooltipContent = (
    <div className="space-y-2 min-w-[320px] max-h-[80vh] overflow-y-auto">
      <div className="font-semibold pb-1.5" style={{ borderBottom: '1px solid var(--border-1)', color: 'var(--text-1)' }}>
        {t('header.timeBreakdown')}
      </div>

      {/* Total */}
      <div className="flex justify-between items-center">
        <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{t('header.total')}</span>
        <span className="font-mono font-semibold text-lg" style={{ color: 'var(--text-1)' }}>
          {formattedTime}
        </span>
      </div>

      {/* Estimating Phase */}
      <div className="pl-2" style={{ borderLeft: '2px solid var(--violet-500)' }}>
        <div className="flex justify-between items-center font-semibold">
          <span style={{ color: 'var(--text-1)' }}>{t('header.estimatingPhase')}</span>
          <span className="font-mono" style={{ color: 'var(--text-1)' }}>
            {isEstimatingFinalized
              ? formatElapsedTime(estimatingTime, true)
              : estimatingActivity?.startedAt
                ? <LiveElapsedTime startedAt={jobTiming.startedAt} />
                : formatElapsedTime(estimatingTime, true)
            }
          </span>
        </div>
        {/* Phase breakdown detail */}
        {jobTiming.phaseBreakdown && Object.keys(jobTiming.phaseBreakdown).length > 0 && (
          <div className="pl-2 space-y-0.5 mt-1">
            {Object.entries(jobTiming.phaseBreakdown).map(([phase, ms]) => (
              <div key={phase} className="flex justify-between items-center text-xs">
                <span className="capitalize" style={{ color: 'var(--text-3)' }}>• {phase}</span>
                <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                  {formatElapsedTime(ms, true)}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Live estimating node activity (when phase breakdown not yet available) */}
        {!isEstimatingFinalized && estimatingActivity && (
          <div className="pl-2 mt-1">
            <div className="flex justify-between items-center text-xs">
              <span style={{ color: 'var(--violet-500)' }}>
                • {estimatingActivity.label}
              </span>
              <span className="font-mono" style={{ color: 'var(--violet-500)' }}>
                <LiveElapsedTime startedAt={estimatingActivity.startedAt} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Tasks */}
      {taskCount > 0 && (
        <div className="pl-2" style={{ borderLeft: '2px solid var(--violet-500)' }}>
          <div className="flex justify-between items-center font-semibold">
            <span style={{ color: 'var(--text-1)' }}>{t('header.tasksCount', { count: taskCount })}</span>
            <span className="font-mono" style={{ color: 'var(--text-1)' }}>
              {formatElapsedTime(tasksTotal, true)}
            </span>
          </div>
          <div className="pl-2 space-y-1 mt-1">
            {/* In-progress tasks (real-time) */}
            {inProgressTasks?.map(task => (
              <div key={task.id} className="flex justify-between items-center text-sm">
                <span className="truncate max-w-[200px]" title={task.name} style={{ color: 'var(--violet-500)' }}>
                  • {task.name}
                </span>
                <span className="font-mono" style={{ color: 'var(--violet-500)' }}>
                  {task.timing?.startedAt
                    ? <LiveElapsedTime startedAt={task.timing.startedAt} />
                    : '0s'}
                </span>
              </div>
            ))}
            {/* Completed tasks */}
            {completedTasks?.map((task) => (
              <div
                key={task.id}
                className="flex justify-between items-center text-sm"
              >
                <span className="truncate max-w-[200px]" title={task.name} style={{ color: 'var(--text-2)' }}>
                  • {task.name}
                </span>
                <span className="font-mono" style={{ color: 'var(--text-2)' }}>
                  {task.timing?.elapsedTime
                    ? formatElapsedTime(task.timing.elapsedTime, true)
                    : '0s'}
                </span>
              </div>
            ))}
            {/* Parallel execution breakdown */}
            {parallelSaved > 1000 && (
              <div className="space-y-0.5 pt-1 mt-1" style={{ borderTop: '1px solid var(--border-1)' }}>
                <div className="flex justify-between items-center text-xs">
                  <span style={{ color: 'var(--text-3)' }}>
                    {t('header.parallelTotal')}
                  </span>
                  <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                    {formatElapsedTime(tasksSequentialSum, true)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold" style={{ color: 'var(--status-done-fg)' }}>
                    {t('header.parallelSaved')}
                  </span>
                  <span className="font-mono font-semibold" style={{ color: 'var(--status-done-fg)' }}>
                    -{formatElapsedTime(parallelSaved, true)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Paused Duration */}
      {jobTiming.totalPausedDuration > 0 && (
        <div className="pt-1.5 mt-1.5 text-xs" style={{ borderTop: '1px solid var(--border-1)' }}>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-2)' }}>{t('header.paused')}</span>
            <span className="font-mono" style={{ color: 'var(--text-2)' }}>{formatElapsedTime(jobTiming.totalPausedDuration, true)}</span>
          </div>
        </div>
      )}
    </div>
  );
  
  const sizeClass = compact
    ? 'h-5 min-h-5 max-h-5 px-1.5 gap-1'
    : 'h-7 min-h-7 max-h-7 px-2.5';
  const innerSize = compact ? 'h-5 gap-1' : 'h-7 gap-1.5';
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const textSize = compact ? 'text-[10px]' : 'text-xs';

  return (
    <Tooltip content={tooltipContent} placement="bottom">
      <div
        className={cn(sizeClass, 'rounded-full cursor-pointer')}
        style={{
          background: 'var(--status-todo-bg)',
          border: '1px solid var(--border-1)',
          boxShadow: 'var(--shadow-xs)',
          color: 'var(--status-todo-fg)',
        }}
      >
        <div className={cn('flex items-center justify-center', innerSize)}>
          <CircleDot className={iconSize} style={{ color: 'var(--status-todo-fg)' }} />
          <span
            className={cn(textSize, 'font-medium leading-none')}
            style={{ color: 'var(--status-todo-fg)' }}
          >
            {formattedTime}
          </span>
        </div>
      </div>
    </Tooltip>
  );
}

interface TokenUsageBadgeProps {
  jobId?: string;
  tokenUsage?: TaskTokenUsage;
  estimatingTokenUsage?: TaskTokenUsage;
  phaseTokenUsages?: PhaseTokenUsage[];
  completedTasks?: Array<{
    id: string;
    name: string;
    tokenUsage?: TaskTokenUsage;
  }>;
  inProgressTasks?: Array<{
    id: string;
    name: string;
    tokenUsage?: TaskTokenUsage;
  }>;
  /**
   * Compact mode (h-5, text-[10px]) for dense inline contexts such as the
   * Job-tab dropdown rows. Tooltip content is unchanged.
   */
  compact?: boolean;
}

/**
 * TokenUsageBadge - Display token usage with billing-centric display
 *
 * Architecture: docs/architecture/13-token-usage-tracking.md
 *
 * DESIGN PRINCIPLE: Show billable (cost-weighted) input tokens, not raw volume.
 *   - billableInput = new×1.0 + creation×1.25 + read×0.1
 *   - Output is always 1:1 (not cacheable)
 *
 * Badge: "132K in · 4.9K out" — billable input, actual cost
 * Tooltip sections:
 *   1. Billing — billable input + output (what you pay)
 *   2. Cache Efficiency — volume, hit rate, savings (when cache active)
 *   3. Phase Breakdown — planning + individual tasks
 */
export function TokenUsageBadge({ jobId, tokenUsage, estimatingTokenUsage, phaseTokenUsages, completedTasks, inProgressTasks, compact = false }: TokenUsageBadgeProps) {
  const { t } = useTranslation('kanban');
  const tasksUsage = sumTokenUsages([
    ...(completedTasks?.map(t => t.tokenUsage) || []),
    ...(inProgressTasks?.map(t => t.tokenUsage) || []),
  ]);

  if (!jobId && !tokenUsage && !tasksUsage) {
    return null;
  }

  const tasks = getTokenUsageMetrics(tasksUsage);
  const estimatingMetrics = estimatingTokenUsage ? getTokenUsageMetrics(estimatingTokenUsage) : null;

  // Effective total: use the LARGER of job-level snapshot vs (estimating + tasks).
  // Job-level tokenUsage can be stale (broadcast snapshot) while task-level is more current.
  const partsSum = sumTokenUsages([estimatingTokenUsage, tasksUsage]);
  const partsMetrics = getTokenUsageMetrics(partsSum);
  const jobMetrics = getTokenUsageMetrics(tokenUsage);
  const effective = (partsSum && partsMetrics.billableInputTokens >= jobMetrics.billableInputTokens)
    ? partsMetrics
    : jobMetrics;

  // Planning phase billable input (prefer direct tracking, fallback to subtraction)
  const estimatingInput = estimatingMetrics
    ? estimatingMetrics.billableInputTokens
    : (tokenUsage ? Math.max(0, effective.billableInputTokens - tasks.billableInputTokens) : 0);
  const estimatingOutput = estimatingMetrics
    ? estimatingMetrics.outputTokens
    : (tokenUsage ? Math.max(0, effective.outputTokens - tasks.outputTokens) : 0);

  const hasTokenData = effective.billableInputTokens > 0 || effective.outputTokens > 0;
  const taskCount = (completedTasks?.length || 0) + (inProgressTasks?.length || 0);

  const tooltipContent = (
    <div className="space-y-2 w-[480px] max-h-[80vh] overflow-y-auto">
      <div className="font-semibold pb-1.5" style={{ borderBottom: '1px solid var(--border-1)', color: 'var(--text-1)' }}>
        {t('header.tokenUsage')}
      </div>

      {hasTokenData ? (
        <>
          {/* ━━ Section 1: Billing (input + output) ━━ */}
          <div>
            <div className="flex justify-between items-center">
              <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                {t('tokenStats.input')} <span className="text-xs font-normal italic" style={{ color: 'var(--text-3)' }}>{t('tokenStats.inputDescription')}</span>
              </span>
              <span className="font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
                {formatTokenCount(effective.billableInputTokens)}
              </span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                {t('tokenStats.output')} <span className="text-xs font-normal italic" style={{ color: 'var(--text-3)' }}>{t('tokenStats.outputDescription')}</span>
              </span>
              <span className="font-mono font-semibold" style={{ color: 'var(--text-1)' }}>
                {formatTokenCount(effective.outputTokens)}
              </span>
            </div>
          </div>

          {/* ━━ Section 2: Cache Efficiency (only when cache active) ━━ */}
          {effective.hasCache && (
            <div className="pt-1.5 mt-1" style={{ borderTop: '1px solid var(--border-1)' }}>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{t('tokenStats.cacheEfficiency')}</div>
              <div className="pl-2 text-xs space-y-0.5">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-3)' }}>{t('tokenStats.totalProcessed')}</span>
                  <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                    {formatTokenCount(effective.totalInputProcessed)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-3)' }}>{t('tokenStats.newCacheMiss')}</span>
                  <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                    {formatTokenCount(effective.newInputTokens)}
                  </span>
                </div>
                {effective.cacheReadTokens > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-3)' }}>{t('tokenStats.cacheHit')}</span>
                    <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                      {formatTokenCount(effective.cacheReadTokens)}
                    </span>
                  </div>
                )}
                {effective.cacheCreationTokens > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-3)' }}>{t('tokenStats.cacheCreated')}</span>
                    <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                      {formatTokenCount(effective.cacheCreationTokens)}
                    </span>
                  </div>
                )}
                {effective.cacheHitRate > 0 && (
                  <div className="flex justify-between pt-0.5" style={{ color: 'var(--status-done-fg)' }}>
                    <span className="font-semibold">{t('tokenStats.cacheHitRate')}</span>
                    <span className="font-mono font-semibold">
                      {formatPercent(effective.cacheHitRate)}
                    </span>
                  </div>
                )}
                {effective.inputSavingsPercent > 0 && (
                  <div className="flex justify-between" style={{ color: 'var(--status-done-fg)' }}>
                    <span className="font-semibold">{t('tokenStats.savings')}</span>
                    <span className="font-mono font-semibold">
                      ~{formatPercent(effective.inputSavingsPercent)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ━━ Section 3: Phase Breakdown ━━ */}
          {(tokenUsage || taskCount > 0 || (phaseTokenUsages && phaseTokenUsages.length > 0)) && (
            <div className="pt-1.5 mt-1" style={{ borderTop: '1px solid var(--border-1)' }}>
              <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-1)' }}>{t('tokenStats.byPhase')}</div>

              {/* Phase-based breakdown (visual/plan jobs) */}
              {phaseTokenUsages && phaseTokenUsages.length > 0 ? (
                <div className="pl-2 space-y-0.5" style={{ borderLeft: '2px solid var(--violet-500)' }}>
                  {phaseTokenUsages.map((p) => {
                    const m = getTokenUsageMetrics(p.tokenUsage);
                    return (m.billableInputTokens > 0 || m.outputTokens > 0) ? (
                      <div key={p.phase} className="flex justify-between items-center text-xs">
                        <span className="capitalize truncate max-w-[260px]" title={p.label || p.phase} style={{ color: 'var(--text-2)' }}>
                          {p.label || p.phase}
                        </span>
                        <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                          {formatTokenCount(m.billableInputTokens)} in · {formatTokenCount(m.outputTokens)} out
                        </span>
                      </div>
                    ) : null;
                  })}
                  {/* Overhead row: difference between job total and sum of phases */}
                  {(() => {
                    const phaseSum = sumTokenUsages(phaseTokenUsages.map(p => p.tokenUsage));
                    const phaseSumMetrics = getTokenUsageMetrics(phaseSum);
                    const overheadIn = Math.max(0, effective.billableInputTokens - phaseSumMetrics.billableInputTokens);
                    const overheadOut = Math.max(0, effective.outputTokens - phaseSumMetrics.outputTokens);
                    return (overheadIn > 100 || overheadOut > 100) ? (
                      <div className="flex justify-between items-center text-xs opacity-60">
                        <span className="italic" style={{ color: 'var(--text-3)' }}>{t('tokenStats.overhead', 'Overhead')}</span>
                        <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                          {formatTokenCount(overheadIn)} in · {formatTokenCount(overheadOut)} out
                        </span>
                      </div>
                    ) : null;
                  })()}
                </div>
              ) : (
                <>
                  {/* Planning Phase (task-queue jobs) */}
                  {tokenUsage && (
                    <div className="pl-2 mb-1" style={{ borderLeft: '2px solid var(--violet-500)' }}>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold" style={{ color: 'var(--text-2)' }}>{t('tokenStats.estimating')}</span>
                        <span className="font-mono" style={{ color: 'var(--text-2)' }}>
                          {formatTokenCount(estimatingInput)} in · {formatTokenCount(estimatingOutput)} out
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Tasks (task-queue jobs) */}
                  {taskCount > 0 && (
                    <div className="pl-2 space-y-0.5" style={{ borderLeft: '2px solid var(--violet-500)' }}>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
                          {t('header.tasksCount', { count: taskCount })}
                        </span>
                        <span className="font-mono" style={{ color: 'var(--text-2)' }}>
                          {formatTokenCount(tasks.billableInputTokens)} in · {formatTokenCount(tasks.outputTokens)} out
                        </span>
                      </div>
                      <div className="pl-2 space-y-0.5">
                        {inProgressTasks?.filter(t => t.tokenUsage).map(task => {
                          const m = getTokenUsageMetrics(task.tokenUsage!);
                          return (m.billableInputTokens > 0 || m.outputTokens > 0) ? (
                            <div key={task.id} className="flex justify-between items-center text-xs">
                              <span className="truncate max-w-[300px]" title={task.name} style={{ color: 'var(--text-3)' }}>
                                • {task.name}
                              </span>
                              <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                                {formatTokenCount(m.billableInputTokens)} / {formatTokenCount(m.outputTokens)}
                              </span>
                            </div>
                          ) : null;
                        })}
                        {completedTasks?.map((task) => {
                          const m = task.tokenUsage ? getTokenUsageMetrics(task.tokenUsage) : null;
                          return (
                            <div key={task.id} className="flex justify-between items-center text-xs">
                              <span className="truncate max-w-[300px]" title={task.name} style={{ color: 'var(--text-3)' }}>
                                • {task.name}
                              </span>
                              <span className="font-mono" style={{ color: 'var(--text-3)' }}>
                                {m ? `${formatTokenCount(m.billableInputTokens)} / ${formatTokenCount(m.outputTokens)}` : '0'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-sm italic" style={{ color: 'var(--text-3)' }}>
          {t('tokenStats.noTokenData')}
        </div>
      )}
    </div>
  );

  const sizeClass = compact
    ? 'h-5 min-h-5 max-h-5 px-1.5 gap-1'
    : 'h-7 min-h-7 max-h-7 px-2.5';
  const innerSize = compact ? 'h-5 gap-1' : 'h-7 gap-1.5';
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const textSize = compact ? 'text-[10px]' : 'text-xs';

  return (
    <Tooltip content={tooltipContent} placement="bottom">
      <div
        className={cn(sizeClass, 'rounded-full cursor-pointer')}
        style={{
          background: 'var(--status-progress-bg)',
          border: '1px solid var(--border-1)',
          boxShadow: 'var(--shadow-xs)',
          color: 'var(--status-progress-fg)',
        }}
      >
        <div className={cn('flex items-center justify-center', innerSize)}>
          <Zap className={iconSize} style={{ color: 'var(--status-progress-fg)' }} />
          <span
            className={cn(textSize, 'font-mono font-medium leading-none whitespace-nowrap')}
            style={{ color: 'var(--status-progress-fg)' }}
          >
            {hasTokenData
              ? `${formatTokenCount(effective.billableInputTokens)}↑·${formatTokenCount(effective.outputTokens)}↓`
              : '0'}
          </span>
        </div>
      </div>
    </Tooltip>
  );
}

interface GaugesGroupProps {
  recursionCount?: number;
  recursionLimit?: number;
  /** Active worker's task name (truncated, for parallel mode identification) */
  recursionTaskName?: string;
}

/**
 * Truncate text to maxLen characters with ellipsis
 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

/**
 * GaugesGroup - Recursion limit gauge with optional worker task name
 */
export function GaugesGroup({
  recursionCount = 0,
  recursionLimit = 50,
  recursionTaskName,
}: GaugesGroupProps) {
  return (
    <>
      {/* Recursion Limit Gauge */}
      <div
        className="relative h-7 min-h-7 max-h-7 px-3 min-w-[120px] overflow-hidden"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-1)',
          borderRadius: 'var(--r-sm)',
        }}
      >
        <div className="absolute inset-0" style={{ borderRadius: 'var(--r-sm)' }}>
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{
              background: 'var(--violet-500)',
              opacity: 0.35,
              width: `${recursionLimit
                ? Math.min(((recursionCount || 0) / recursionLimit) * 100, 100)
                : 0}%`,
            }}
          />
        </div>
        <div className="relative z-10 flex items-center justify-center h-7 gap-1.5">
          {recursionTaskName && (
            <span
              className="text-[10px] font-medium leading-none truncate max-w-[90px] opacity-80"
              style={{ color: 'var(--violet-500)' }}
              title={recursionTaskName}
            >
              {truncateText(recursionTaskName, 13)}
            </span>
          )}
          <span
            className="text-xs font-medium leading-none whitespace-nowrap"
            style={{ color: 'var(--violet-500)' }}
          >
            {recursionCount}/{recursionLimit}
          </span>
        </div>
      </div>
    </>
  );
}
