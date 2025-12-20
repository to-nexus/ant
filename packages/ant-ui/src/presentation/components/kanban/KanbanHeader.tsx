import { useState, useEffect } from 'react';
import { Timer, Coins } from 'lucide-react';
import { StatusChip, ChipVariant } from '../StatusChip';
import { formatElapsedTime } from '@/shared/utils/timeUtils';
import { formatTokenUsageCompact } from '@/shared/utils/tokenUtils';
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
  tokenUsage?: TaskTokenUsage;
  completedTasks?: Array<{
    id: string;
    name: string;
    tokenUsage?: TaskTokenUsage;
  }>;
}

/**
 * TokenUsageBadge - Display total token usage for the job with breakdown tooltip
 */
export function TokenUsageBadge({ tokenUsage, completedTasks }: TokenUsageBadgeProps) {
  // ✅ Show badge if token usage data is available
  if (!tokenUsage || tokenUsage.totalTokens === 0) {
    return null;
  }

  // Calculate breakdown
  const tasksTotal = completedTasks?.reduce((sum, task) => {
    return sum + (task.tokenUsage?.totalTokens || 0);
  }, 0) || 0;

  // Estimating nodes (detectEnv + decompose) = total - tasks
  const estimatingNodesTotal = tokenUsage.totalTokens - tasksTotal;
  
  const tooltipContent = (
    <div className="space-y-2 min-w-[320px] max-h-[80vh] overflow-y-auto">
      <div className="font-semibold border-b pb-1.5 border-amber-300 dark:border-slate-600">
        Token Usage Breakdown
      </div>
      
      {/* Total */}
      <div className="flex justify-between items-center">
        <span className="text-gray-800 dark:text-gray-100 font-semibold">Total:</span>
        <span className="font-mono font-semibold text-lg text-gray-900 dark:text-white">
          {formatTokenUsageCompact(tokenUsage)}
        </span>
      </div>
      
      {/* Breakdown = Estimating + Tasks */}
      <div className="text-xs text-gray-600 dark:text-gray-400 -mt-1 mb-1 italic">
        = Estimating Phase ({(estimatingNodesTotal / 1000).toFixed(1)}K) + Tasks ({(tasksTotal / 1000).toFixed(1)}K)
      </div>
      
      {/* Estimating Phase (Job-level nodes) */}
      <div className="pl-2 border-l-2 border-purple-400 dark:border-purple-500">
        <div className="flex justify-between items-center font-semibold">
          <span className="text-gray-800 dark:text-gray-100">Estimating Phase:</span>
          <span className="font-mono text-gray-800 dark:text-gray-100">
            {(estimatingNodesTotal / 1000).toFixed(1)}K
          </span>
        </div>
      </div>
      
      {/* Tasks */}
      {completedTasks && completedTasks.length > 0 && (
        <div className="pl-2 space-y-1 border-l-2 border-blue-400 dark:border-blue-500">
          <div className="flex justify-between items-center font-semibold">
            <span className="text-gray-800 dark:text-gray-100">Tasks ({completedTasks.length}):</span>
            <span className="font-mono text-gray-800 dark:text-gray-100">
              {(tasksTotal / 1000).toFixed(1)}K
            </span>
          </div>
          <div className="pl-2 space-y-1">
            {completedTasks.map((task) => (
              <div
                key={task.id}
                className="flex justify-between items-center text-sm"
              >
                <span className="text-gray-700 dark:text-gray-300 truncate max-w-[200px]" title={task.name}>
                  • {task.name}
                </span>
                <span className="font-mono text-gray-700 dark:text-gray-300">
                  {task.tokenUsage
                    ? `${(task.tokenUsage.totalTokens / 1000).toFixed(1)}K`
                    : '0K'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Input/Output Split */}
      <div className="pt-1.5 mt-1.5 border-t border-amber-300 dark:border-slate-600 text-xs space-y-0.5">
        <div className="flex justify-between">
          <span className="text-gray-700 dark:text-gray-300">Input:</span>
          <span className="font-mono text-gray-700 dark:text-gray-300">{(tokenUsage.inputTokens / 1000).toFixed(1)}K</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-700 dark:text-gray-300">Output:</span>
          <span className="font-mono text-gray-700 dark:text-gray-300">{(tokenUsage.outputTokens / 1000).toFixed(1)}K</span>
        </div>
      </div>
    </div>
  );
  
  return (
    <Tooltip content={tooltipContent} placement="bottom">
      <div className="h-7 min-h-7 max-h-7 px-2.5 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-300 dark:border-purple-800 cursor-pointer">
        <div className="flex items-center justify-center gap-1.5 h-7">
          <Coins className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
          <span className="text-xs text-purple-700 dark:text-purple-300 font-medium leading-none">
            {formatTokenUsageCompact(tokenUsage)}
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
