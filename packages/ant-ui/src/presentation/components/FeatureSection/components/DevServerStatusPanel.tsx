import { Loader2, Package, ExternalLink, AlertCircle, CheckCircle } from 'lucide-react';
import { DEV_SERVER_MESSAGES } from '../constants/devServer';
import { getProgressMessage } from '../utils/devServer';
import type { DevServerState, DevServerError, DevServerProgress } from '../types/devServer';

interface DevServerStatusPanelProps {
  state: DevServerState;
  ready?: boolean;  // ✅ NEW: Is dev server ready to accept requests?
  url?: string;
  error?: DevServerError;
  progress?: DevServerProgress;
  onOpen?: () => void;
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
  ready = false,  // ✅ Default to false
  url,
  error,
  progress,
  onOpen
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
    );
  }

  // Error state
  if (state === 'error') {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-red-900 dark:text-red-100">
              {DEV_SERVER_MESSAGES.STATUS_FAILED}
            </div>
            {error?.message && (
              <div className="mt-1 text-xs text-red-700 dark:text-red-300 break-words">
                {error.message}
              </div>
            )}
            {progress && progress.packages.some(p => p.state === 'error') && (
              <div className="mt-2 space-y-1">
                {progress.packages
                  .filter(p => p.state === 'error')
                  .map((pkg, idx) => (
                    <div key={idx} className="text-xs text-red-600 dark:text-red-400">
                      ❌ {pkg.name}: {pkg.error}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  
  return null;
}
