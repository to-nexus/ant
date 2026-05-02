import { useTranslation } from 'react-i18next';
import { Package, ExternalLink, AlertCircle, CheckCircle, Wrench, X } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import { getProgressMessage } from '../utils/preview';
import type { PreviewState, PreviewError, PreviewProgress, SetupFailureReasoning } from '../types/preview';

/**
 * Get user-friendly title for setup failure reasoning
 */
function getSetupFailureTitle(reasoning: SetupFailureReasoning | undefined, t: (key: string) => string): string {
  switch (reasoning) {
    case 'basename-missing':
      return t('preview.basenameMissing');
    case 'basepath-missing':
      return t('preview.basepathMissing');
    case 'port-conflict':
      return t('preview.portConflict');
    case 'dependency-error':
      return t('preview.dependencyError');
    case 'config-invalid':
      return t('preview.configInvalid');
    case 'framework-unsupported':
      return t('preview.frameworkUnsupported');
    default:
      return t('preview.setupIncomplete');
  }
}

interface PreviewStatusPanelProps {
  state: PreviewState;
  ready?: boolean;
  setupReasoning?: SetupFailureReasoning;
  /**
   * Top-level "representative" URL.
   *   - 1 frontend  → `/{4partUrlKey}` (single Open button rendered).
   *   - 2+ frontends→ should be `null` — UI renders one Open button per
   *                  package via `packages[].url` instead.
   */
  url?: string | null;
  error?: PreviewError;
  progress?: PreviewProgress;
  issues?: Array<{ reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string }>;
  /**
   * Per-package details. Frontend packages with a non-null `url` are
   * "openable" — each gets its own inline Open button when there are
   * 2+ frontends.
   */
  packages?: Array<{
    name: string;
    slug?: string;
    type: 'frontend' | 'backend' | 'other';
    port: number;
    urlKey?: string;
    url?: string | null;
  }>;
  /**
   * Open a preview URL in a new tab.
   *
   * Pass an explicit `url` from `packages[i].url` for multi-frontend
   * Open buttons. Calling without arguments uses the top-level `url`
   * (single-frontend back-compat).
   */
  onOpen?: (url?: string) => void;
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
  // Frontends the user can actually open (BE only sets `url` for frontends
  // whose dev server is reachable). When there are 2+ openable frontends,
  // we replace the single representative Open button with one button per
  // package in the package list.
  const openableFrontends = (packages || []).filter(
    (p) => p.type === 'frontend' && !!p.url,
  );
  const showSingleOpen = openableFrontends.length <= 1;
  const singleOpenUrl = url ?? openableFrontends[0]?.url ?? undefined;
  
  const startingWithCounts = isMultiPackage
    ? `${t('preview.starting')} (${progress.completedCount}/${progress.totalCount})`
    : t('preview.starting');
  
  const installingWithCounts = isMultiPackage
    ? `${t('preview.installing')} (${progress.completedCount}/${progress.totalCount})`
    : t('preview.installing');

  // Idle state - show nothing
  if (state === 'idle') {
    return null;
  }
  
  // Installing dependencies
  if (state === 'installing') {
    const progressMsg = progress ? installingWithCounts : t('preview.installing');
    
    return (
      <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-md">
        <div className="flex items-start gap-2">
          <Package className="w-4 h-4 text-purple-600 dark:text-purple-400 animate-status-pulse mt-0.5 flex-shrink-0" />
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
                        pkg.state === 'installing' ? 'bg-purple-400 dark:bg-purple-600 animate-status-pulse' :
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
  
  // Stopping — show spinner while backend cleans up processes/Docker/ports
  if (state === 'stopping') {
    return (
      <div className="p-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
        <div className="flex items-center gap-2">
          <Spinner size="md" tone="inherit" className="text-orange-600 dark:text-orange-400 flex-shrink-0" />
          <span className="text-sm font-medium text-orange-900 dark:text-orange-100">
            {t('preview.stopping')}
          </span>
        </div>
      </div>
    );
  }

  if (state === 'starting') {
    const progressMsg = startingWithCounts;
    
    return (
      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md">
        <div className="flex items-start gap-2">
          <Spinner size="md" tone="inherit" className="text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
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
                        pkg.state === 'starting' ? 'bg-blue-400 dark:bg-blue-600 animate-status-pulse' :
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
    const progressMsg = ready ? t('preview.running') : (progress ? getProgressMessage(progress) : t('preview.running'));
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
                    {getSetupFailureTitle(setupReasoning, t)}
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
                {t('preview.fix')}
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
                    ? t('preview.apiBaseMissing')
                    : t('preview.additionalSetupNeeded')}
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
                  {t('preview.fix')}
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
                <Spinner size="md" tone="inherit" className="text-green-600 dark:text-green-400" />
              )}
              <span className="text-sm font-medium text-green-900 dark:text-green-100">
                {ready ? progressMsg : startingWithCounts}
              </span>
            </div>
            
            {ready && showSingleOpen && singleOpenUrl && onOpen && (
              <button
                onClick={() => onOpen(singleOpenUrl)}
                className="px-3 py-1.5 text-xs font-medium bg-green-600 dark:bg-green-700 text-white rounded 
                         hover:bg-green-700 dark:hover:bg-green-600 transition-colors 
                         flex items-center gap-1.5"
                title={t('preview.openNewTab')}
              >
                <ExternalLink size={12} />
                {t('preview.open')}
              </button>
            )}
          </div>

          {ready && hasMultiplePackages && (
            <div className="mt-3 space-y-1.5">
              {packages!.map((pkg, idx) => {
                const pkgUrl = pkg.url || undefined;
                const isOpenable = pkg.type === 'frontend' && !!pkgUrl;
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs px-2 py-1.5 bg-green-100/50 dark:bg-green-900/20 rounded"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-600 dark:bg-green-400 flex-shrink-0" />
                      <span className="font-medium text-green-800 dark:text-green-200 truncate">
                        {pkg.name}
                      </span>
                      <span className="text-green-600 dark:text-green-400 flex-shrink-0">
                        ({pkg.type})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-green-600 dark:text-green-400 font-mono">
                        :{pkg.port}
                      </span>
                      {/* Per-frontend Open button — only shown when there
                          are 2+ openable frontends, replacing the single
                          representative button above. */}
                      {!showSingleOpen && isOpenable && onOpen && (
                        <button
                          onClick={() => onOpen(pkgUrl)}
                          className="p-1 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800/40 rounded transition-colors"
                          title={t('preview.openPackage', { name: pkg.name })}
                          aria-label={t('preview.openPackage', { name: pkg.name })}
                        >
                          <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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
                  {getSetupFailureTitle(setupReasoning, t)}
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
                {fixableIssues.length > 1 ? t('preview.fixAll', { count: fixableIssues.length }) : t('preview.fix')}
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
                {error?.message || t('preview.notRunning')}
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
