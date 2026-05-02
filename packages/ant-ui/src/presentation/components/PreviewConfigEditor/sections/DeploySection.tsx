import { useTranslation } from 'react-i18next';
import {
  Rocket,
  Globe,
  AlertCircle,
  Square,
  ExternalLink,
  Moon,
  AlertTriangle,
} from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type { DeployStatus, DeployLogEntry } from '@/infrastructure/http/api';
import type { DeployDisabledReason } from '../../FeatureSection/hooks/useDeployManager';
import { ansiConverter } from '../utils';

export function DeploySection({
  deployStatus,
  deployLogs,
  isDeployLoading,
  canDeploy,
  disabledReason,
  onDeploy,
  onStopDeploy,
  onOpenDeployUrl,
}: {
  deployStatus: DeployStatus | undefined;
  deployLogs: DeployLogEntry[];
  isDeployLoading: boolean;
  /**
   * False when the backend would reject a deploy request (no feature
   * selected, or a `code` job is actively writing the source tree).
   * Derived by `useDeployManager`; button stays disabled with a tooltip.
   */
  canDeploy: boolean;
  disabledReason: DeployDisabledReason | undefined;
  onDeploy: () => void;
  onStopDeploy: () => void;
  /**
   * Open a deploy URL in a new tab.
   *
   * Pass an explicit `url` for multi-package per-package buttons. No-arg
   * call uses the top-level representative URL (single-package back-compat).
   */
  onOpenDeployUrl: (url?: string) => void;
}) {
  const { t } = useTranslation('explorer');

  const phase = deployStatus?.phase;

  // Active = a static server process owns a port on some pod
  const isRunning = phase === 'running';
  const isWorking = phase === 'building' || phase === 'deploying' || phase === 'starting';
  const isHibernated = phase === 'hibernated';
  const isUnavailable = phase === 'unavailable';
  const isError = phase === 'error';
  const isDeployActive = isRunning || isWorking;

  const statusBadge = (() => {
    if (isRunning) {
      return (
        <div className="flex items-center gap-1.5">
          <Globe className="w-4 h-4 text-green-500" />
          <span className="text-sm font-medium text-green-700 dark:text-green-300">
            {t('preview.deploy.running', 'Deployed')}
          </span>
        </div>
      );
    }
    if (phase === 'building') {
      return (
        <div className="flex items-center gap-1.5">
          <Spinner size="md" className="text-blue-500" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            {t('preview.deploy.building', 'Building...')}
          </span>
        </div>
      );
    }
    if (phase === 'deploying') {
      return (
        <div className="flex items-center gap-1.5">
          <Spinner size="md" className="text-blue-500" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            {t('preview.deploy.deploying', 'Deploying...')}
          </span>
        </div>
      );
    }
    if (phase === 'starting') {
      return (
        <div className="flex items-center gap-1.5">
          <Spinner size="md" className="text-indigo-500" />
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {t('preview.deploy.starting', 'Waking up...')}
          </span>
        </div>
      );
    }
    if (isHibernated) {
      return (
        <div className="flex items-center gap-1.5">
          <Moon className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {t('preview.deploy.hibernated', 'Hibernated')}
          </span>
        </div>
      );
    }
    if (isUnavailable) {
      return (
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {t('preview.deploy.unavailable', 'Artifact missing')}
          </span>
        </div>
      );
    }
    if (isError) {
      return (
        <div className="flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <span className="text-sm font-medium text-red-700 dark:text-red-300">
            {t('preview.deploy.error', 'Deploy Failed')}
          </span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-gray-400" />
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {t('preview.deploy.idle', 'Not deployed')}
        </span>
      </div>
    );
  })();

  const primaryButtonLabel = isUnavailable
    ? t('preview.deploy.redeploy', 'Re-deploy')
    : t('preview.deploy.deploy', 'Deploy');

  const disabledTooltip = (() => {
    if (canDeploy) return undefined;
    if (disabledReason === 'no-feature-selected') {
      return t('preview.deploy.disabled.noFeatureSelected', 'Select a feature branch to deploy');
    }
    if (disabledReason === 'code-job-active') {
      return t(
        'preview.deploy.disabled.codeJobActive',
        'A code job is running on this feature. Deploy is available once it completes.'
      );
    }
    return undefined;
  })();

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Rocket className="w-4 h-4 text-gray-600 dark:text-gray-300" />
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('preview.deploy.title', 'Deploy')}
        </h3>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        {t('preview.deploy.description', 'Build and serve a production-optimized static version of your project.')}
      </p>

      <div className="flex items-center gap-2 mb-3">{statusBadge}</div>

      <div className="flex items-center gap-2 flex-wrap">
        {!isDeployActive ? (
          <button
            onClick={onDeploy}
            disabled={isDeployLoading || !canDeploy}
            title={disabledTooltip}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                     bg-indigo-600 text-white hover:bg-indigo-700
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          >
            {isDeployLoading ? (
              <Spinner size="sm" tone="inherit" />
            ) : (
              <Rocket className="w-3.5 h-3.5" />
            )}
            {primaryButtonLabel}
          </button>
        ) : (
          <button
            onClick={onStopDeploy}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                     bg-red-600 text-white hover:bg-red-700
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            {t('preview.deploy.stop', 'Stop')}
          </button>
        )}
        {/* Open button(s): available while running OR hibernated (click
            triggers auto-wake on the proxy). Multi-package deploys
            replace the single representative button with one button per
            package — there is no "primary" deploy. */}
        {(isRunning || isHibernated) && (() => {
          const openable = (deployStatus?.packages || []).filter(p => !!p.url);
          // Single-package back-compat: prefer top-level url. If null but
          // packages has exactly one entry, fall back to that one URL.
          if (openable.length <= 1) {
            const singleUrl = deployStatus?.url ?? openable[0]?.url ?? null;
            if (!singleUrl) return null;
            return (
              <button
                onClick={() => onOpenDeployUrl(singleUrl)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                         bg-blue-600 text-white hover:bg-blue-700
                         transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {isHibernated
                  ? t('preview.deploy.wake', 'Wake up')
                  : t('preview.deploy.open', 'Open')}
              </button>
            );
          }
          // Multi-package: render one button per deployed frontend.
          return openable.map((pkg) => (
            <button
              key={pkg.slug || pkg.name}
              onClick={() => onOpenDeployUrl(pkg.url || undefined)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                       bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              title={t('preview.openPackage', { name: pkg.name })}
            >
              <ExternalLink className="w-3 h-3" />
              <span className="truncate max-w-[16ch]">{pkg.name}</span>
              {isHibernated && (
                <Moon className="w-3 h-3 opacity-70" />
              )}
            </button>
          ));
        })()}
      </div>

      {isError && deployStatus?.error && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-700 dark:text-red-300">{deployStatus.error}</p>
        </div>
      )}

      {isUnavailable && (
        <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {deployStatus?.error || t('preview.deploy.unavailable', 'Artifact missing')}
          </p>
        </div>
      )}

      {deployLogs.length > 0 && (
        <div className="mt-3 max-h-48 overflow-y-auto bg-gray-900 dark:bg-gray-950 rounded-md p-3">
          {deployLogs.slice(-50).map((log, idx) => (
            <div
              key={`${log.timestamp}-${idx}`}
              className={`text-xs font-mono leading-relaxed ${
                log.type === 'stderr' ? 'text-red-400' : 'text-gray-300'
              }`}
              dangerouslySetInnerHTML={{ __html: ansiConverter.toHtml(log.message) }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
