import { useState, useEffect } from 'react';
import { Timer, Coins } from 'lucide-react';
import { StatusChip, ChipVariant } from '../StatusChip';
import { formatElapsedTime } from '@/shared/utils/timeUtils';
import { formatTokenCount, getTokenUsageMetrics, sumTokenUsages } from '@/shared/utils/tokenUtils';
import { JobTiming, TaskTokenUsage } from '@/domain/models/types';
import { Tooltip } from '../common/Tooltip';

interface DataSourceIndicatorProps {
  dataSource?: string;
  isStopping?: boolean;  // ✅ 즉각적인 피드백을 위한 상태
}

const DATA_SOURCE_VARIANTS: Record<string, { variant: ChipVariant; label: string }> = {
  live: { variant: 'live', label: 'Real-time' },
  session: { variant: 'session', label: 'Session File' },
  estimating: { variant: 'estimating', label: 'Estimating' }
};

/**
 * DataSourceIndicator - 타이틀 옆에 표시될 데이터 소스 인디케이터
 * 
 * ✅ 즉각적인 피드백: isStopping=true면 즉시 "Session File" 표시
 * ✅ 서버 SSOT: 실제 데이터는 변경하지 않음, 표시만 변경
 */
export function DataSourceIndicator({ dataSource, isStopping = false }: DataSourceIndicatorProps) {
  if (!dataSource) return null;

  // ✅ CRITICAL: Stopping 시 즉각적인 시각적 피드백
  // 서버가 확인할 때까지 기다리지 않고 사용자에게 즉시 피드백 제공
  const effectiveDataSource = isStopping ? 'session' : dataSource;
  
  const config = DATA_SOURCE_VARIANTS[effectiveDataSource];
  if (!config) return null;

  return <StatusChip variant={config.variant} label={config.label} />;
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
}

/**
 * ElapsedTimeBadge - Real-time 뱃지 우측에 위치할 경과 시간 뱃지 (with breakdown tooltip)
 */
export function ElapsedTimeBadge({
  totalElapsedTime,
  jobTiming,
  completedTasks
}: ElapsedTimeBadgeProps) {
  // ✨ Real-time elapsed time calculation
  const [realtimeElapsed, setRealtimeElapsed] = useState<number | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // ✅ Initialize: Use backend data OR calculate from jobTiming.startedAt
  useEffect(() => {
    // Priority 1: Job completed - use final totalElapsedTime
    if (jobTiming?.completedAt && totalElapsedTime !== undefined) {
      setRealtimeElapsed(totalElapsedTime);
      setIsInitialized(true);
      return;
    }
    
    // Priority 2: Use backend calculated value if available (and positive)
    if (totalElapsedTime !== undefined && totalElapsedTime > 0) {
      setRealtimeElapsed(totalElapsedTime);
      setIsInitialized(true);
      return;
    }
    
    // Priority 3: If job has started (jobTiming.startedAt exists), calculate elapsed time
    // This handles estimating phase where totalElapsedTime is 0
    if (jobTiming?.startedAt) {
      const startTime = new Date(jobTiming.startedAt).getTime();
      const currentTime = Date.now();
      const elapsed = currentTime - startTime - (jobTiming.totalPausedDuration || 0);
      setRealtimeElapsed(Math.max(0, elapsed));
      setIsInitialized(true);
      return;
    }
    
    // Priority 4: No timing info yet
    setRealtimeElapsed(null);
    setIsInitialized(false);
  }, [totalElapsedTime, jobTiming]);
  
  // ✅ Tick every second if job is running
  useEffect(() => {
    // Don't tick if not initialized yet
    if (!isInitialized || realtimeElapsed === null) {
      return;
    }
    
    // If job is paused or completed, don't tick
    const isPaused = !!jobTiming?.pausedAt;
    const isCompleted = !!jobTiming?.completedAt;
    
    if (isPaused || isCompleted) {
      return;
    }
    
    // Job is running: increment every second
    const intervalId = setInterval(() => {
      setRealtimeElapsed(prev => (prev !== null ? prev + 1000 : 0));
    }, 1000);
    
    return () => {
      clearInterval(intervalId);
    };
  }, [isInitialized, jobTiming?.pausedAt, jobTiming?.completedAt, jobTiming?.lastResumedAt]);
  // ✅ CRITICAL: Track pause/resume state changes
  // - pausedAt: becomes truthy when paused → stops interval
  // - completedAt: becomes truthy when completed → stops interval  
  // - lastResumedAt: changes when resumed → restarts interval
  // Do NOT include realtimeElapsed to avoid recreating interval every second
  
  // ✅ Show badge if job has timing data
  if (!jobTiming) {
    return null;
  }
  
  // ✅ Wait for data to be initialized before showing
  if (!isInitialized || realtimeElapsed === null) {
    return null;
  }
  
  // Format elapsed time (include seconds for real-time updates)
  const formattedTime = formatElapsedTime(realtimeElapsed, true);
  
  // Calculate breakdown
  const estimatingTime = jobTiming.estimatingDuration || 0;
  const tasksTotal = completedTasks?.reduce((sum, task) => {
    return sum + (task.timing?.elapsedTime || 0);
  }, 0) || 0;
  
  // Build tooltip content
  const tooltipContent = (
    <div className="space-y-2 min-w-[320px] max-h-[80vh] overflow-y-auto">
      <div className="font-semibold border-b pb-1.5 border-amber-300 dark:border-slate-600">
        Time Breakdown
      </div>
      
      {/* Total */}
      <div className="flex justify-between items-center">
        <span className="text-gray-800 dark:text-gray-100 font-semibold">Total:</span>
        <span className="font-mono font-semibold text-lg text-gray-900 dark:text-white">
          {formattedTime}
        </span>
      </div>
      
      {/* Estimating Phase */}
      <div className="pl-2 border-l-2 border-purple-400 dark:border-purple-500">
        <div className="flex justify-between items-center font-semibold">
          <span className="text-gray-800 dark:text-gray-100">Estimating Phase:</span>
          <span className="font-mono text-gray-800 dark:text-gray-100">
            {formatElapsedTime(estimatingTime, true)}
          </span>
        </div>
      </div>
      
      {/* Tasks */}
      {completedTasks && completedTasks.length > 0 && (
        <div className="pl-2 border-l-2 border-blue-400 dark:border-blue-500">
          <div className="flex justify-between items-center font-semibold">
            <span className="text-gray-800 dark:text-gray-100">Tasks ({completedTasks.length}):</span>
            <span className="font-mono text-gray-800 dark:text-gray-100">
              {formatElapsedTime(tasksTotal, true)}
            </span>
          </div>
          <div className="pl-2 space-y-1 mt-1">
            {completedTasks.map((task) => (
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
            <span className="text-gray-700 dark:text-gray-300">Paused:</span>
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
  completedTasks?: Array<{
    id: string;
    name: string;
    tokenUsage?: TaskTokenUsage;
  }>;
  inProgressTask?: {
    id: string;
    name: string;
    tokenUsage?: TaskTokenUsage;
  };
}

/**
 * TokenUsageBadge - Display total token usage for the job with breakdown tooltip
 * 
 * ✅ Shows badge whenever jobId exists (like ElapsedTimeBadge with jobTiming)
 * ✅ Handles stopped/interrupted jobs gracefully (shows accumulated usage)
 * ✅ Shows even with 0 tokens to indicate tracking is active
 */
export function TokenUsageBadge({ jobId, tokenUsage, completedTasks, inProgressTask }: TokenUsageBadgeProps) {
  // Aggregate task token usage (works even when job-level tokenUsage is missing)
  const tasksUsage = sumTokenUsages([
    ...(completedTasks?.map(t => t.tokenUsage) || []),
    inProgressTask?.tokenUsage,
  ]);

  // ✅ Render policy:
  // - If we have a jobId, always show (even if 0) to indicate tracking is active.
  // - If jobId is missing (e.g., some estimating/session states), still show if we have any token data.
  if (!jobId && !tokenUsage && !tasksUsage) {
    return null;
  }

  // Prefer job-level usage when available (may include estimating nodes),
  // otherwise fallback to summed task usage.
  const effectiveUsage: TaskTokenUsage = tokenUsage || tasksUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const effective = getTokenUsageMetrics(effectiveUsage);
  const tasks = getTokenUsageMetrics(tasksUsage);

  // ✅ Estimating nodes (non-cache total) = job rawTotal - tasks rawTotal
  const estimatingNodesTotal = tokenUsage ? Math.max(0, effective.rawTotalTokens - tasks.rawTotalTokens) : 0;
  const hasTokenData = effective.rawTotalTokens >= 0;
  
  const tooltipContent = (
    <div className="space-y-2 min-w-[320px] max-h-[80vh] overflow-y-auto">
      <div className="font-semibold border-b pb-1.5 border-amber-300 dark:border-slate-600">
        Token Usage Breakdown
      </div>
      
      {hasTokenData ? (
        <>
          {/* Total */}
          <div className="flex justify-between items-center">
            <span className="text-gray-800 dark:text-gray-100 font-semibold">Total:</span>
            <span className="font-mono font-semibold text-lg text-gray-900 dark:text-white">
              {formatTokenCount(effective.rawTotalTokens)}
            </span>
          </div>
          
          {/* Clarify meaning */}
          <div className="text-xs text-gray-600 dark:text-gray-400 -mt-1 mb-1 italic">
            Total = Input (new, non-cache) + Output. Cache read/creation are tracked separately.
          </div>
          
          {/* Estimating Phase (Job-level nodes) */}
          {tokenUsage && (
            <div className="pl-2 border-l-2 border-purple-400 dark:border-purple-500">
              <div className="flex justify-between items-center font-semibold">
                <span className="text-gray-800 dark:text-gray-100">Estimating Phase (non-cache):</span>
                <span className="font-mono text-gray-800 dark:text-gray-100">
                  {formatTokenCount(estimatingNodesTotal)}
                </span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-gray-600 dark:text-gray-400 text-sm italic">
          No token usage data yet
        </div>
      )}
      
      {/* Tasks - only show if we have token data */}
      {hasTokenData && ((completedTasks && completedTasks.length > 0) || inProgressTask) ? (
        <div className="pl-2 space-y-1 border-l-2 border-blue-400 dark:border-blue-500">
          <div className="flex justify-between items-center font-semibold">
            <span className="text-gray-800 dark:text-gray-100">
              Tasks ({(completedTasks?.length || 0) + (inProgressTask ? 1 : 0)}):
            </span>
            <span className="font-mono text-gray-800 dark:text-gray-100">
              {formatTokenCount(tasks.rawTotalTokens)}
            </span>
          </div>
          <div className="pl-2 space-y-1">
            {/* In-Progress Task (show first) */}
            {inProgressTask && inProgressTask.tokenUsage && getTokenUsageMetrics(inProgressTask.tokenUsage).rawTotalTokens > 0 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-700 dark:text-gray-300 truncate max-w-[200px]" title={inProgressTask.name}>
                  • {inProgressTask.name}
                </span>
                <span className="font-mono text-gray-700 dark:text-gray-300 flex items-center gap-1">
                  {formatTokenCount(getTokenUsageMetrics(inProgressTask.tokenUsage).rawTotalTokens)}
                  <span className="text-xs opacity-70 animate-pulse">↻</span>
                </span>
              </div>
            )}
            
            {/* Completed Tasks */}
            {completedTasks?.map((task) => (
              <div
                key={task.id}
                className="flex justify-between items-center text-sm"
              >
                <span className="text-gray-700 dark:text-gray-300 truncate max-w-[200px]" title={task.name}>
                  • {task.name}
                </span>
                <span className="font-mono text-gray-700 dark:text-gray-300">
                  {task.tokenUsage
                    ? formatTokenCount(getTokenUsageMetrics(task.tokenUsage).rawTotalTokens)
                    : '0'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      
      {/* Input/Output Split (non-cache) + Cache breakdown */}
      {hasTokenData && (
        <div className="pt-1.5 mt-1.5 border-t border-amber-300 dark:border-slate-600 text-xs space-y-0.5">
          <div className="flex justify-between">
            <span className="text-gray-700 dark:text-gray-300">Input (new, non-cache):</span>
            <span className="font-mono text-gray-700 dark:text-gray-300">
              {formatTokenCount(effective.rawInputTokens)}
            </span>
          </div>
        <div className="flex justify-between">
          <span className="text-gray-700 dark:text-gray-300">Output:</span>
          <span className="font-mono text-gray-700 dark:text-gray-300">{formatTokenCount(effective.rawOutputTokens)}</span>
        </div>

        {/* Cache (processed input tokens) */}
        {(effective.cacheCreationTokens || effective.cacheReadTokens) ? (
          <div className="pt-1.5 mt-1.5 border-t border-emerald-300 dark:border-emerald-700 space-y-0.5">
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold mb-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Prompt Cache</span>
            </div>

            <div className="flex justify-between pl-2 text-xs">
              <span className="text-gray-700 dark:text-gray-300">Processed input:</span>
              <span className="font-mono text-gray-700 dark:text-gray-300">
                {formatTokenCount(effective.processedInputTokens)}
              </span>
            </div>

            {effective.cacheCreationTokens > 0 && (
              <div className="flex justify-between pl-2 text-xs">
                <span className="text-gray-700 dark:text-gray-300">Total Created:</span>
                <span className="font-mono text-gray-700 dark:text-gray-300">
                  {formatTokenCount(effective.cacheCreationTokens)}
                </span>
              </div>
            )}

            {effective.cacheReadTokens > 0 && (
              <>
                <div className="flex justify-between pl-2 text-xs">
                  <span className="text-gray-700 dark:text-gray-300">Cache Hit:</span>
                  <span className="font-mono text-gray-700 dark:text-gray-300">
                    {formatTokenCount(effective.cacheReadTokens)}
                  </span>
                </div>
                <div className="flex justify-between pl-2">
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">💰 Saved (approx.):</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                    {formatTokenCount(effective.cacheSavedTokens)}
                  </span>
                </div>
              </>
            )}

            {/* Billable totals (cost-equivalent) */}
            <div className="pt-1.5 mt-1.5 border-t border-amber-300 dark:border-slate-600">
              <div className="flex justify-between">
                <span className="text-gray-700 dark:text-gray-300">Input (billable equiv.):</span>
                <span className="font-mono text-gray-700 dark:text-gray-300">
                  {formatTokenCount(effective.billableInputTokens)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-700 dark:text-gray-300">Total (billable equiv.):</span>
                <span className="font-mono text-gray-700 dark:text-gray-300">
                  {formatTokenCount(effective.billableTotalTokens)}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      )}
    </div>
  );
  
  return (
    <Tooltip content={tooltipContent} placement="bottom">
      <div className="h-7 min-h-7 max-h-7 px-2.5 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-300 dark:border-purple-800 cursor-pointer">
        <div className="flex items-center justify-center gap-1.5 h-7">
          <Coins className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
          <span className="text-xs text-purple-700 dark:text-purple-300 font-medium leading-none">
            {hasTokenData ? formatTokenCount(effective.rawTotalTokens) : '0'}
          </span>
        </div>
      </div>
    </Tooltip>
  );
}

interface GaugesGroupProps {
  recursionCount?: number;
  recursionLimit?: number;
}

/**
 * GaugesGroup - Recursion limit gauge only
 */
export function GaugesGroup({
  recursionCount = 0,
  recursionLimit = 50,
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
        <div className="relative z-10 flex items-center justify-center h-7">
          <span className="text-xs text-purple-700 dark:text-purple-300 font-medium leading-none">
            {recursionCount}/{recursionLimit} Recursion
          </span>
        </div>
      </div>
    </>
  );
}
