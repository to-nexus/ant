import { useTranslation } from 'react-i18next';
import { Loader2, Package, ExternalLink, AlertCircle, CheckCircle, Wrench, X } from 'lucide-react';
import { PREVIEW_MESSAGES } from '../constants/preview';
import { getProgressMessage } from '../utils/preview';
import type { PreviewState, PreviewError, PreviewProgress, SetupFailureReasoning } from '../types/preview';

/**
 * Get user-friendly title for setup failure reasoning
 */
function getSetupFailureTitle(reasoning?: SetupFailureReasoning): string {
  switch (reasoning) {
    case 'basename-missing':
      return 'React Router basename 설정 누락 - 프록시 환경에서 라우팅이 동작하지 않습니다';
    case 'basepath-missing':
      return 'Next.js basePath 설정 누락 - SSR 환경에서 에셋 경로 불일치가 발생합니다';
    case 'port-conflict':
      return '포트 충돌 - 다른 프로세스가 이미 사용 중입니다';
    case 'dependency-error':
      return '의존성 설치 실패';
    case 'config-invalid':
      return '설정 파일 오류';
    case 'framework-unsupported':
      return '지원되지 않는 프레임워크';
    default:
      return '프리뷰 서버 설정 미완료';
  }
}

interface PreviewStatusPanelProps {
  state: PreviewState;
  ready?: boolean;
  setupReasoning?: SetupFailureReasoning;
  url?: string;
  error?: PreviewError;
  progress?: PreviewProgress;
  issues?: Array<{ reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string }>;
  packages?: Array<{ name: string; type: 'frontend' | 'backend' | 'other'; port: number }>;
  onOpen?: () => void;
  onFix?: () => void;
  onDismiss?: () => void;
  fixButtonClicked?: boolean;
}

/**
 * PreviewStatusPanel
 * 
 * Shows preview server status with appropriate UI
 * - idle: nothing shown
 * - installing: progress message (multi-package aware)
 * - starting: progress message (multi-package aware)
 * - running: success message + Open button
 * - error: error message
 */
export function PreviewStatusPanel({ 
  state, 
  ready = false,
  setupReasoning,
  url,
  error,
  progress,
  issues,
  packages,
  onOpen,
  onFix,
  onDismiss,
  fixButtonClicked = false
}: PreviewStatusPanelProps) {
  const { t } = useTranslation('explorer');
  const isMultiPackage = progress && progress.totalCount > 1;
  const hasMultiplePackages = packages && packages.length > 1;
  
  const startingWithCounts = isMultiPackage
    ? `${PREVIEW_MESSAGES.STATUS_STARTING} (${progress.completedCount}/${progress.totalCount})`
    : PREVIEW_MESSAGES.STATUS_STARTING;
  
  const installingWithCounts = isMultiPackage
    ? `${PREVIEW_MESSAGES.STATUS_INSTALLING} (${progress.completedCount}/${progress.totalCount})`
    : PREVIEW_MESSAGES.STATUS_INSTALLING;

  // Idle state - show nothing
  if (state === 'idle') {
    return null;
  }
  
  // Installing dependencies
  if (state === 'installing') {
    const progressMsg = progress ? installingWithCounts : PREVIEW_MESSAGES.STATUS_INSTALLING;
    
    return (
      <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-md">
        <div className="flex items-start gap-2">
          <Package className="w-4 h-4 text-purple-600 dark:text-purple-400 animate-pulse mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-purple-900 dark:text-purple-100">
              {progressMsg}
            </div>
            {isMultiPackage && (
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
  
  if (state === 'starting') {
    const progressMsg = startingWithCounts;
    
    return (
      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md">
        <div className="flex items-start gap-2">
          <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
              {progressMsg}
            </div>
            {isMultiPackage && (
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
    const progressMsg = ready ? PREVIEW_MESSAGES.STATUS_RUNNING : (progress ? getProgressMessage(progress) : PREVIEW_MESSAGES.STATUS_RUNNING);
    const warning = issues?.find(i => i.severity === 'warning');
    
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
                  title={t('preview.fixSetup')}
                >
                  <Wrench size={12} />
                  Fix
                </button>
                {onDismiss && (
                  <button
                    onClick={onDismiss}
                    className="p-1.5 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/50 rounded transition-colors"
                    title={t('preview.closeWarning')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Non-fatal warning (e.g. API base not configured for dynamic backend port) */}
        {!setupReasoning && warning?.suggestedFix && onFix && !fixButtonClicked && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-md">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                    {warning.reasoning === 'api-base-missing'
                      ? 'API 호출 설정이 동적 백엔드 포트(풀스택 dev server)에 맞지 않을 수 있습니다'
                      : '프리뷰 서버 실행 환경에서 추가 설정이 필요할 수 있습니다'}
                  </div>
                  {warning.reason && (
                    <div className="mt-1 text-xs text-yellow-800/80 dark:text-yellow-200/80">
                      {warning.reason}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={onFix}
                  className="px-3 py-1.5 text-xs font-medium bg-yellow-600 dark:bg-yellow-700 text-white rounded 
                           hover:bg-yellow-700 dark:hover:bg-yellow-600 transition-colors 
                           flex items-center gap-1.5"
                  title={t('preview.fixSetup')}
                >
                  <Wrench size={12} />
                  Fix
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Preview server status */}
        <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {ready ? (
                <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
              ) : (
                <Loader2 className="w-4 h-4 text-green-600 dark:text-green-400 animate-spin" />
              )}
              <span className="text-sm font-medium text-green-900 dark:text-green-100">
                {ready ? progressMsg : startingWithCounts}
              </span>
            </div>
            
            {ready && url && onOpen && (
              <button
                onClick={onOpen}
                className="px-3 py-1.5 text-xs font-medium bg-green-600 dark:bg-green-700 text-white rounded 
                         hover:bg-green-700 dark:hover:bg-green-600 transition-colors 
                         flex items-center gap-1.5"
                title={t('preview.openNewTab')}
              >
                <ExternalLink size={12} />
                {PREVIEW_MESSAGES.BUTTON_OPEN}
              </button>
            )}
          </div>

          {ready && hasMultiplePackages && (
            <div className="mt-3 space-y-1.5">
              {packages!.map((pkg, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs px-2 py-1.5 bg-green-100/50 dark:bg-green-900/20 rounded"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-600 dark:bg-green-400" />
                    <span className="font-medium text-green-800 dark:text-green-200">
                      {pkg.name}
                    </span>
                    <span className="text-green-600 dark:text-green-400">
                      ({pkg.type})
                    </span>
                  </div>
                  <span className="text-green-600 dark:text-green-400 font-mono">
                    :{pkg.port}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Error state
  if (state === 'error') {
    const fixableIssues = (issues || []).filter(i => i.suggestedFix && i.suggestedFix.trim().length > 0);
    const issueCount = (issues || []).length;
    
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
                {issueCount > 1 && (
                  <div className="mt-1 space-y-1">
                    {(issues || [])
                      .filter(i => i.severity === 'warning')
                      .slice(0, 3)
                      .map((i, idx) => (
                        <div key={idx} className="text-xs text-yellow-800/80 dark:text-yellow-200/80">
                          - {i.reason}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={onFix}
                className="px-3 py-1.5 text-xs font-medium bg-yellow-600 dark:bg-yellow-700 text-white rounded 
                         hover:bg-yellow-700 dark:hover:bg-yellow-600 transition-colors 
                         flex items-center gap-1.5"
                title={t('preview.fixSetup')}
              >
                <Wrench size={12} />
                {fixableIssues.length > 1 ? `Fix all (${fixableIssues.length})` : 'Fix'}
              </button>
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="p-1.5 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/50 rounded transition-colors"
                  title={t('preview.closeWarning')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    
    // General error
    return (
      <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-900 dark:text-red-100">
                {error?.message || PREVIEW_MESSAGES.STATUS_FAILED}
              </div>
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 rounded transition-colors flex-shrink-0"
              title={t('preview.closeError')}
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
