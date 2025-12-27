import { Loader2, Package, ExternalLink, AlertCircle, CheckCircle, Wrench, X } from 'lucide-react';
import { DEV_SERVER_MESSAGES } from '../constants/devServer';
import { getProgressMessage } from '../utils/devServer';
import type { DevServerState, DevServerError, DevServerProgress, SetupFailureReasoning } from '../types/devServer';

/**
 * Get user-friendly title for setup failure reasoning
 */
function getSetupFailureTitle(reasoning?: SetupFailureReasoning): string {
  switch (reasoning) {
    case 'basename-missing':
      return 'React Router basename 설정 누락 - 프록시 환경에서 라우팅이 동작하지 않습니다';
    case 'port-conflict':
      return '포트 충돌 - 다른 프로세스가 이미 사용 중입니다';
    case 'dependency-error':
      return '의존성 설치 실패';
    case 'config-invalid':
      return '설정 파일 오류';
    case 'framework-unsupported':
      return '지원되지 않는 프레임워크';
    default:
      return '개발서버 설정 미완료';
  }
}

interface DevServerStatusPanelProps {
  state: DevServerState;
  ready?: boolean;  // Is dev server ready to accept requests?
  setupReasoning?: SetupFailureReasoning;  // Categorized failure code
  url?: string;
  error?: DevServerError;
  progress?: DevServerProgress;
  onOpen?: () => void;
  onFix?: () => void;  // Fix setup handler
  onDismiss?: () => void;  // ✅ NEW: Dismiss panel
  fixButtonClicked?: boolean;  // ✅ NEW: Track if fix button was clicked
}

/**
 * DevServerStatusPanel
 * 
 * Shows dev server status with appropriate UI
 * - idle: nothing shown
 * - installing: progress message (multi-package aware)
 * - starting: progress message (multi-package aware)
 * - running: success message + Open button
 * - error: error message
 */
export function DevServerStatusPanel({ 
  state, 
  ready = false,  // Default to false
  setupReasoning,  // Categorized failure code
  url,
  error,
  progress,
  onOpen,
  onFix,
  onDismiss,  // ✅ NEW: Dismiss handler
  fixButtonClicked = false  // ✅ NEW: Track fix button state
}: DevServerStatusPanelProps) {
  // Idle state - show nothing
  if (state === 'idle') {
    return null;
  }
  
  // Installing dependencies
  if (state === 'installing') {
    const progressMsg = progress ? getProgressMessage(progress) : DEV_SERVER_MESSAGES.STATUS_INSTALLING;
    
    return (
      <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-md">
        <div className="flex items-start gap-2">
          <Package className="w-4 h-4 text-purple-600 dark:text-purple-400 animate-pulse mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-purple-900 dark:text-purple-100">
              {progressMsg}
            </div>
            {progress && (
              <div className="mt-1">
                <div className="flex gap-1">
                  {progress.packages.map((pkg, idx) => (
                    <div
                      key={idx}
                      className={`h-1.5 flex-1 rounded-full ${
                        pkg.state === 'installing' ? 'bg-purple-400 dark:bg-purple-600 animate-pulse' :
                        pkg.state === 'starting' || pkg.state === 'running' ? 'bg-purple-600 dark:bg-purple-400' :
                        'bg-purple-200 dark:bg-purple-800'
                      }`}
                      title={pkg.name}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  
  // Starting dev server
  if (state === 'starting') {
    const progressMsg = progress ? getProgressMessage(progress) : DEV_SERVER_MESSAGES.STATUS_STARTING;
    
    return (
      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md">
        <div className="flex items-start gap-2">
          <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
              {progressMsg}
            </div>
            {progress && (
              <div className="mt-1">
                <div className="flex gap-1">
                  {progress.packages.map((pkg, idx) => (
                    <div
                      key={idx}
                      className={`h-1.5 flex-1 rounded-full ${
                        pkg.state === 'starting' ? 'bg-blue-400 dark:bg-blue-600 animate-pulse' :
                        pkg.state === 'running' ? 'bg-blue-600 dark:bg-blue-400' :
                        'bg-blue-200 dark:bg-blue-800'
                      }`}
                      title={pkg.name}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  
  // Running successfully
  if (state === 'running') {
    const progressMsg = progress ? getProgressMessage(progress) : DEV_SERVER_MESSAGES.STATUS_RUNNING;
    
    return (
      <div className="space-y-2">
        {/* Setup validation warning */}
        {setupReasoning && onFix && !fixButtonClicked && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-md">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                    {getSetupFailureTitle(setupReasoning)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={onFix}
                  className="px-3 py-1.5 text-xs font-medium bg-yellow-600 dark:bg-yellow-700 text-white rounded 
                           hover:bg-yellow-700 dark:hover:bg-yellow-600 transition-colors 
                           flex items-center gap-1.5"
                  title="Fix dev server setup"
                >
                  <Wrench size={12} />
                  Fix
                </button>
                {onDismiss && (
                  <button
                    onClick={onDismiss}
                    className="p-1.5 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/50 rounded transition-colors"
                    title="Close warning"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Dev server status */}
        <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {ready ? (
                <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
              ) : (
                <Loader2 className="w-4 h-4 text-green-600 dark:text-green-400 animate-spin" />
              )}
              <span className="text-sm font-medium text-green-900 dark:text-green-100">
                {ready ? progressMsg : 'Starting dev server...'}
              </span>
            </div>
            
            {/* ✅ Only show Open button when ready */}
            {ready && url && onOpen && (
              <button
                onClick={onOpen}
                className="px-3 py-1.5 text-xs font-medium bg-green-600 dark:bg-green-700 text-white rounded 
                         hover:bg-green-700 dark:hover:bg-green-600 transition-colors 
                         flex items-center gap-1.5"
                title="Open dev server in new tab"
              >
                <ExternalLink size={12} />
                {DEV_SERVER_MESSAGES.BUTTON_OPEN}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (state === 'error') {
    // If setupReasoning exists, this is a validation failure (not a general error)
    if (setupReasoning && onFix && !fixButtonClicked) {
      return (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-md">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                  {getSetupFailureTitle(setupReasoning)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={onFix}
                className="px-3 py-1.5 text-xs font-medium bg-yellow-600 dark:bg-yellow-700 text-white rounded 
                         hover:bg-yellow-700 dark:hover:bg-yellow-600 transition-colors 
                         flex items-center gap-1.5"
                title="Fix dev server setup"
              >
                <Wrench size={12} />
                Fix
              </button>
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="p-1.5 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/50 rounded transition-colors"
                  title="Close warning"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    
    // General error (not validation related) - ✅ Show only main error, no package details
    return (
      <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-900 dark:text-red-100">
                {error?.message || DEV_SERVER_MESSAGES.STATUS_FAILED}
              </div>
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 rounded transition-colors flex-shrink-0"
              title="Close error"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }
  
  return null;
}
