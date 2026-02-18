import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Timer, Coins } from 'lucide-react';
import { formatElapsedTime } from '@/shared/utils/timeUtils';
import { formatTokenCount, formatPercent, getTokenUsageMetrics, sumTokenUsages } from '@/shared/utils/tokenUtils';
import { JobTiming, TaskTokenUsage } from '@/domain/models/types';
import { Tooltip } from '../common/Tooltip';
import { useStore } from '@/domain/store';

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
 * Calculate elapsed time from JobTiming using Date.now().
 * Pure function — call on every render for real-time display.
 */
function calculateJobElapsed(jobTiming: JobTiming, totalElapsedTime?: number): number {
  // Completed: use final value
  if (jobTiming.completedAt) {
    return totalElapsedTime ?? jobTiming.totalElapsedTime ?? 0;
  }

  // Paused: calculate elapsed up to pause point
  if (jobTiming.pausedAt) {
    const start = new Date(jobTiming.startedAt).getTime();
    const paused = new Date(jobTiming.pausedAt).getTime();
    return Math.max(0, paused - start - (jobTiming.totalPausedDuration || 0));
  }

  // Running: calculate from Date.now()
  const start = new Date(jobTiming.startedAt).getTime();
  return Math.max(0, Date.now() - start - (jobTiming.totalPausedDuration || 0));
}

interface ElapsedTimeBadgeProps {
  totalElapsedTime?: number;
  jobTiming?: JobTiming;
  completedTasks?: Array<{
    id: string;
    name: string;
    timing?: {
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
  /** Current estimating node activity (e.g., { label: "환경 분석 중", startedAt: "..." }) */
  estimatingActivity?: {
    label: string;
    startedAt: string;
  } | null;
}

/**
 * ElapsedTimeBadge - Real-time 뱃지 우측에 위치할 경과 시간 뱃지 (with breakdown tooltip)
 *
 * ✅ FIX: Tick-driven re-render + pure Date.now() calculation on every render.
 * No state for elapsed time — avoids stale-value reset from SSE object reference changes.
 * Same proven pattern as LiveElapsedTime.
 */
export function ElapsedTimeBadge({
  totalElapsedTime,
  jobTiming,
  completedTasks,
  inProgressTasks,
  estimatingActivity,
}: ElapsedTimeBadgeProps) {
  const { t } = useTranslation('kanban');
  // ✅ FIX: Also check store.isRunning as a safety net.
  // If the backend fails to set completedAt/pausedAt on jobTiming (e.g., plan jobs before this fix),
  // the workflow end event still sets store.isRunning=false, which stops the timer.
  const storeIsRunning = useStore((s) => s.isRunning);
  const timingIsRunning = !!jobTiming?.startedAt && !jobTiming?.completedAt && !jobTiming?.pausedAt;
  const isRunning = storeIsRunning && timingIsRunning;
  useRealtimeTick(isRunning);
  
  // ✅ Show badge if job has timing data
  if (!jobTiming) {
    return null;
  }

  // ✅ Pure calculation on every render — always uses Date.now() for running jobs
  const realtimeElapsed = calculateJobElapsed(jobTiming, totalElapsedTime);
  
  // Format elapsed time (include seconds for real-time updates)
  const formattedTime = formatElapsedTime(realtimeElapsed, true);
  
  // Calculate breakdown
  const estimatingTime = jobTiming.estimatingDuration || 0;
  const isEstimatingFinalized = !!jobTiming.estimatingDuration;
  const tasksTotal = completedTasks?.reduce((sum, task) => {
    return sum + (task.timing?.elapsedTime || 0);
  }, 0) || 0;
  const taskCount = (completedTasks?.length || 0) + (inProgressTasks?.length || 0);
  
  // Build tooltip content
  const tooltipContent = (
    <div className="space-y-2 min-w-[320px] max-h-[80vh] overflow-y-auto">
      <div className="font-semibold border-b pb-1.5 border-amber-300 dark:border-slate-600">
        {t('header.timeBreakdown')}
      </div>
      
      {/* Total */}
      <div className="flex justify-between items-center">
        <span className="text-gray-800 dark:text-gray-100 font-semibold">{t('header.total')}</span>
        <span className="font-mono font-semibold text-lg text-gray-900 dark:text-white">
          {formattedTime}
        </span>
      </div>
      
      {/* Estimating Phase */}
      <div className="pl-2 border-l-2 border-purple-400 dark:border-purple-500">
        <div className="flex justify-between items-center font-semibold">
          <span className="text-gray-800 dark:text-gray-100">{t('header.estimatingPhase')}</span>
          <span className="font-mono text-gray-800 dark:text-gray-100">
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
                <span className="text-gray-600 dark:text-gray-400 capitalize">• {phase}</span>
                <span className="font-mono text-gray-600 dark:text-gray-400">
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
              <span className="text-purple-600 dark:text-purple-400">
                • {estimatingActivity.label}
              </span>
              <span className="font-mono text-purple-600 dark:text-purple-400">
                <LiveElapsedTime startedAt={estimatingActivity.startedAt} />
              </span>
            </div>
          </div>
        )}
      </div>
      
      {/* Tasks */}
      {taskCount > 0 && (
        <div className="pl-2 border-l-2 border-blue-400 dark:border-blue-500">
          <div className="flex justify-between items-center font-semibold">
            <span className="text-gray-800 dark:text-gray-100">{t('header.tasksCount', { count: taskCount })}</span>
            <span className="font-mono text-gray-800 dark:text-gray-100">
              {formatElapsedTime(tasksTotal, true)}
            </span>
          </div>
          <div className="pl-2 space-y-1 mt-1">
            {/* In-progress tasks (real-time) */}
            {inProgressTasks?.map(task => (
              <div key={task.id} className="flex justify-between items-center text-sm">
                <span className="text-blue-600 dark:text-blue-400 truncate max-w-[200px]" title={task.name}>
                  • {task.name}
                </span>
                <span className="font-mono text-blue-600 dark:text-blue-400">
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
                <span className="text-gray-700 dark:text-gray-300 truncate max-w-[200px]" title={task.name}>
                  • {task.name}
                </span>
                <span className="font-mono text-gray-700 dark:text-gray-300">
                  {task.timing?.elapsedTime
                    ? formatElapsedTime(task.timing.elapsedTime, true)
                    : '0s'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Paused Duration */}
      {jobTiming.totalPausedDuration > 0 && (
        <div className="pt-1.5 mt-1.5 border-t border-amber-300 dark:border-slate-600 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-700 dark:text-gray-300">{t('header.paused')}</span>
            <span className="font-mono text-gray-700 dark:text-gray-300">{formatElapsedTime(jobTiming.totalPausedDuration, true)}</span>
          </div>
        </div>
      )}
    </div>
  );
  
  return (
    <Tooltip content={tooltipContent} placement="bottom">
      <div className="h-7 min-h-7 max-h-7 px-2.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-300 dark:border-blue-800 cursor-pointer">
        <div className="flex items-center justify-center gap-1.5 h-7">
          <Timer className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span className="text-xs text-blue-700 dark:text-blue-300 font-medium leading-none">
            {formattedTime}
          </span>
        </div>
      </div>
    </Tooltip>
  );
}

interface TokenUsageBadgeProps {
  jobId?: string;  // ✅ Job identity to determine if badge should be shown
  tokenUsage?: TaskTokenUsage;
  estimatingTokenUsage?: TaskTokenUsage;  // ✅ Direct estimating phase snapshot (no subtraction)
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
export function TokenUsageBadge({ jobId, tokenUsage, estimatingTokenUsage, completedTasks, inProgressTasks }: TokenUsageBadgeProps) {
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
    <div className="space-y-2 min-w-[340px] max-h-[80vh] overflow-y-auto">
      <div className="font-semibold border-b pb-1.5 border-amber-300 dark:border-slate-600">
        {t('header.tokenUsage')}
      </div>

      {hasTokenData ? (
        <>
          {/* ━━ Section 1: Billing (input + output) ━━ */}
          <div>
            <div className="flex justify-between items-center">
              <span className="text-gray-800 dark:text-gray-100 font-semibold">
                {t('tokenStats.input')} <span className="text-xs text-gray-500 dark:text-gray-500 font-normal italic">{t('tokenStats.inputDescription')}</span>
              </span>
              <span className="font-mono font-semibold text-gray-900 dark:text-white">
                {formatTokenCount(effective.billableInputTokens)}
              </span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-gray-800 dark:text-gray-100 font-semibold">
                {t('tokenStats.output')} <span className="text-xs text-gray-500 dark:text-gray-500 font-normal italic">{t('tokenStats.outputDescription')}</span>
              </span>
              <span className="font-mono font-semibold text-gray-900 dark:text-white">
                {formatTokenCount(effective.outputTokens)}
              </span>
            </div>
          </div>

          {/* ━━ Section 2: Cache Efficiency (only when cache active) ━━ */}
          {effective.hasCache && (
            <div className="pt-1.5 mt-1 border-t border-gray-200 dark:border-slate-700">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-100 mb-1">{t('tokenStats.cacheEfficiency')}</div>
              <div className="pl-2 text-xs space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{t('tokenStats.totalProcessed')}</span>
                  <span className="font-mono text-gray-600 dark:text-gray-400">
                    {formatTokenCount(effective.totalInputProcessed)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{t('tokenStats.newCacheMiss')}</span>
                  <span className="font-mono text-gray-600 dark:text-gray-400">
                    {formatTokenCount(effective.newInputTokens)}
                  </span>
                </div>
                {effective.cacheReadTokens > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('tokenStats.cacheHit')}</span>
                    <span className="font-mono text-gray-600 dark:text-gray-400">
                      {formatTokenCount(effective.cacheReadTokens)}
                    </span>
                  </div>
                )}
                {effective.cacheCreationTokens > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{t('tokenStats.cacheCreated')}</span>
                    <span className="font-mono text-gray-600 dark:text-gray-400">
                      {formatTokenCount(effective.cacheCreationTokens)}
                    </span>
                  </div>
                )}
                {effective.cacheHitRate > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 pt-0.5">
                    <span className="font-semibold">{t('tokenStats.cacheHitRate')}</span>
                    <span className="font-mono font-semibold">
                      {formatPercent(effective.cacheHitRate)}
                    </span>
                  </div>
                )}
                {effective.inputSavingsPercent > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
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
          {(tokenUsage || taskCount > 0) && (
            <div className="pt-1.5 mt-1 border-t border-gray-200 dark:border-slate-700">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-100 mb-1">{t('tokenStats.byPhase')}</div>

              {/* Planning Phase */}
              {tokenUsage && (
                <div className="pl-2 border-l-2 border-purple-400 dark:border-purple-500 mb-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-700 dark:text-gray-200 font-semibold">{t('tokenStats.estimating')}</span>
                    <span className="font-mono text-gray-700 dark:text-gray-200">
                      {formatTokenCount(estimatingInput)} in · {formatTokenCount(estimatingOutput)} out
                    </span>
                  </div>
                </div>
              )}

              {/* Tasks */}
              {taskCount > 0 && (
                <div className="pl-2 space-y-0.5 border-l-2 border-blue-400 dark:border-blue-500">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-700 dark:text-gray-200 font-semibold">
                      {t('header.tasksCount', { count: taskCount })}
                    </span>
                    <span className="font-mono text-gray-700 dark:text-gray-200">
                      {formatTokenCount(tasks.billableInputTokens)} in · {formatTokenCount(tasks.outputTokens)} out
                    </span>
                  </div>
                  <div className="pl-2 space-y-0.5">
                    {inProgressTasks?.filter(t => t.tokenUsage).map(task => {
                      const m = getTokenUsageMetrics(task.tokenUsage!);
                      return (m.billableInputTokens > 0 || m.outputTokens > 0) ? (
                        <div key={task.id} className="flex justify-between items-center text-xs">
                          <span className="text-gray-600 dark:text-gray-400 truncate max-w-[180px]" title={task.name}>
                            • {task.name}
                          </span>
                          <span className="font-mono text-gray-600 dark:text-gray-400">
                            {formatTokenCount(m.billableInputTokens)} / {formatTokenCount(m.outputTokens)}
                          </span>
                        </div>
                      ) : null;
                    })}
                    {completedTasks?.map((task) => {
                      const m = task.tokenUsage ? getTokenUsageMetrics(task.tokenUsage) : null;
                      return (
                        <div key={task.id} className="flex justify-between items-center text-xs">
                          <span className="text-gray-600 dark:text-gray-400 truncate max-w-[180px]" title={task.name}>
                            • {task.name}
                          </span>
                          <span className="font-mono text-gray-600 dark:text-gray-400">
                            {m ? `${formatTokenCount(m.billableInputTokens)} / ${formatTokenCount(m.outputTokens)}` : '0'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-gray-600 dark:text-gray-400 text-sm italic">
          {t('tokenStats.noTokenData')}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip content={tooltipContent} placement="bottom">
      <div className="h-7 min-h-7 max-h-7 px-2.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 cursor-pointer">
        <div className="flex items-center justify-center gap-1.5 h-7">
          <Coins className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs text-amber-700 dark:text-amber-300 font-medium leading-none whitespace-nowrap">
            {hasTokenData
              ? `${formatTokenCount(effective.billableInputTokens)} in · ${formatTokenCount(effective.outputTokens)} out`
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
      <div className="relative h-7 min-h-7 max-h-7 px-3 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-300 dark:border-purple-800 min-w-[120px] overflow-hidden">
        <div className="absolute inset-0 rounded-md">
          <div 
            className="h-full bg-purple-300 dark:bg-purple-800/50 transition-all duration-500 ease-out"
            style={{ 
              width: `${recursionLimit 
                ? Math.min(((recursionCount || 0) / recursionLimit) * 100, 100) 
                : 0}%` 
            }}
          />
        </div>
        <div className="relative z-10 flex items-center justify-center h-7 gap-1.5">
          {recursionTaskName && (
            <span
              className="text-[10px] text-purple-500 dark:text-purple-400 font-medium leading-none truncate max-w-[90px] opacity-80"
              title={recursionTaskName}
            >
              {truncateText(recursionTaskName, 13)}
            </span>
          )}
          <span className="text-xs text-purple-700 dark:text-purple-300 font-medium leading-none whitespace-nowrap">
            {recursionCount}/{recursionLimit}
          </span>
        </div>
      </div>
    </>
  );
}
