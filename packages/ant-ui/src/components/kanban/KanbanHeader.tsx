import { Badge } from '@/ui/badge';

interface DataSourceIndicatorProps {
  dataSource?: string;
}

/**
 * DataSourceIndicator - 타이틀 옆에 표시될 데이터 소스 인디케이터
 */
export function DataSourceIndicator({ dataSource }: DataSourceIndicatorProps) {
  if (!dataSource) return null;

  return (
    <div className="flex items-center gap-2 px-2 h-7 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-1.5">
        {dataSource === 'live' && (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <span className="text-xs font-medium text-green-600 dark:text-green-400 leading-none">Real-time</span>
          </>
        )}
        {dataSource === 'session' && (
          <>
            <span className="inline-flex h-2 w-2 rounded-full bg-gray-400 dark:bg-gray-500"></span>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 leading-none">Session File</span>
          </>
        )}
        {dataSource === 'estimating' && (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400 leading-none">Estimating</span>
          </>
        )}
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
