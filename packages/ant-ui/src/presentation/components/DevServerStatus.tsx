import { X, ExternalLink, Loader2, Package } from 'lucide-react';

interface DevServerStatusProps {
  status: 'installing' | 'starting' | 'running' | 'error';
  url?: string;
  errorMessage?: string;
  onClose: () => void;
}

/**
 * DevServerStatus
 * 
 * 개발서버 실행 결과 표시 UI
 * - 구동 시도 중: 로딩 표시
 * - 실행 성공: Open 버튼 표시 (Close 버튼 없음)
 * - 실행 실패: Close 버튼 표시
 */
export function DevServerStatus({ 
  status, 
  url,
  errorMessage,
  onClose
}: DevServerStatusProps) {
  // Installing dependencies status
  if (status === 'installing') {
    return (
      <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-md">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-purple-600 dark:text-purple-400 animate-pulse" />
          <span className="text-sm font-medium text-purple-900 dark:text-purple-100">
            Installing dependencies... 잠시만 기다려주세요.
          </span>
        </div>
      </div>
    );
  }
  
  // Starting status
  if (status === 'starting') {
    return (
      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
          <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
            Dev Server 구동을 시도하고 있습니다...
          </span>
        </div>
      </div>
    );
  }
  
  if (status === 'running') {
    return (
      <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-green-900 dark:text-green-100">
              Dev Server Running
            </span>
          </div>
          
          {url && (
            <button
              onClick={() => window.open(url, '_blank')}
              className="px-2 py-1 text-xs bg-green-600 dark:bg-green-700 text-white rounded 
                       hover:bg-green-700 dark:hover:bg-green-600 transition-colors 
                       flex items-center gap-1"
              title="Open in new tab"
            >
              <ExternalLink size={12} />
              Open
            </button>
          )}
        </div>
      </div>
    );
  }

  // Error status
  return (
    <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-red-600 dark:text-red-400 text-sm">⚠️</span>
          <span className="text-sm font-medium text-red-900 dark:text-red-100">
            Dev Server Failed to Start
          </span>
        </div>
        
        <button
          onClick={onClose}
          className="p-1 text-red-600 dark:text-red-400 
                   hover:text-red-800 dark:hover:text-red-300 
                   rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
      
      {errorMessage && (
        <div className="mt-2 text-xs text-red-700 dark:text-red-300">
          <span className="font-medium">Error:</span> {errorMessage}
        </div>
      )}
    </div>
  );
}

