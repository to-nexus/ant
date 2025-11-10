import { useState, useEffect } from 'react';
import { Timer } from 'lucide-react';
import { StatusChip, ChipVariant } from '../StatusChip';
import { formatElapsedTime } from '@/lib/timeUtils';

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
  jobTiming?: {
    startedAt: string;
    lastResumedAt?: string;
    pausedAt?: string;
    completedAt?: string;
    totalPausedDuration: number;
    estimatingDuration?: number;
  };
  activeJobId?: string;
}

/**
 * ElapsedTimeBadge - Real-time 뱃지 우측에 위치할 경과 시간 뱃지
 */
export function ElapsedTimeBadge({
  totalElapsedTime,
  jobTiming,
  activeJobId
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
    if (jobTiming?.pausedAt || jobTiming?.completedAt) {
      return;
    }
    
    // Job is running: increment every second
    const intervalId = setInterval(() => {
      setRealtimeElapsed(prev => (prev !== null ? prev + 1000 : 0));
    }, 1000);
    
    return () => clearInterval(intervalId);
  }, [isInitialized, realtimeElapsed, jobTiming]);
  
  // ✅ Show badge if job is active or has session data
  // - activeJobId: job is running
  // - jobTiming: job was run before (paused/completed)
  if (!activeJobId && !jobTiming) {
    return null;
  }
  
  // ✅ Wait for data to be initialized before showing
  if (!isInitialized || realtimeElapsed === null) {
    return null;
  }
  
  // Format elapsed time (include seconds for real-time updates)
  const formattedTime = formatElapsedTime(realtimeElapsed, true);
  
  return (
    <div className="h-7 min-h-7 max-h-7 px-2.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-300 dark:border-blue-800">
      <div className="flex items-center justify-center gap-1.5 h-7">
        <Timer className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-xs text-blue-700 dark:text-blue-300 font-medium leading-none">
          {formattedTime}
        </span>
      </div>
    </div>
  );
}

interface GaugesGroupProps {
  recursionCount?: number;
  recursionLimit?: number;
  completedCount: number;
  totalTasks: number;
}

/**
 * GaugesGroup - 우측 정렬될 리커전/태스크 게이지
 */
export function GaugesGroup({
  recursionCount = 0,
  recursionLimit = 50,
  completedCount,
  totalTasks
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

      {/* Tasks Gauge */}
      <div className="relative h-7 min-h-7 max-h-7 px-3 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-300 dark:border-green-800 min-w-[120px] overflow-hidden">
        <div className="absolute inset-0 rounded-md">
          <div 
            className="h-full bg-green-300 dark:bg-green-800/50 transition-all duration-500 ease-out"
            style={{ width: `${totalTasks > 0 ? Math.min((completedCount / totalTasks) * 100, 100) : 0}%` }}
          />
        </div>
        <div className="relative z-10 flex items-center justify-center h-7">
          <span className="text-xs text-green-700 dark:text-green-300 font-medium leading-none">
            {completedCount}/{totalTasks} Tasks
          </span>
        </div>
      </div>
    </>
  );
}
