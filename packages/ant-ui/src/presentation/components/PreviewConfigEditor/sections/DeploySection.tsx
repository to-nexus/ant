import { useTranslation } from 'react-i18next';
import {
  Rocket,
  Globe,
  Loader2,
  AlertCircle,
  Square,
  ExternalLink,
} from 'lucide-react';
import type { DeployStatus, DeployLogEntry } from '@/infrastructure/http/api';
import { ansiConverter } from '../utils';

export function DeploySection({
  deployStatus,
  deployLogs,
  isDeployLoading,
  isJobRunning,
  onDeploy,
  onStopDeploy,
  onOpenDeployUrl,
}: {
  deployStatus: DeployStatus | undefined;
  deployLogs: DeployLogEntry[];
  isDeployLoading: boolean;
  isJobRunning: boolean;
  onDeploy: () => void;
  onStopDeploy: () => void;
  onOpenDeployUrl: () => void;
}) {
  const { t } = useTranslation('explorer');

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

      {/* Deploy status */}
      <div className="flex items-center gap-2 mb-3">
        {deployStatus?.phase === 'running' ? (
          <div className="flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-green-700 dark:text-green-300">
              {t('preview.deploy.running', 'Deployed')}
            </span>
          </div>
        ) : deployStatus?.phase === 'building' ? (
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              {t('preview.deploy.building', 'Building...')}
            </span>
          </div>
        ) : deployStatus?.phase === 'deploying' ? (
          <div className="flex items-center gap-1.5">
            <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              {t('preview.deploy.deploying', 'Deploying...')}
            </span>
          </div>
        ) : deployStatus?.phase === 'error' ? (
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-medium text-red-700 dark:text-red-300">
              {t('preview.deploy.error', 'Deploy Failed')}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-gray-400" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t('preview.deploy.idle', 'Not deployed')}
            </span>
          </div>
        )}
      </div>

      {/* Deploy controls */}
      <div className="flex items-center gap-2">
        {deployStatus?.phase !== 'running' ? (
          <button
            onClick={onDeploy}
            disabled={isDeployLoading || isJobRunning}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                     bg-indigo-600 text-white hover:bg-indigo-700
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          >
            {isDeployLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Rocket className="w-3.5 h-3.5" />
            )}
            {t('preview.deploy.deploy', 'Deploy')}
          </button>
        ) : (
          <button
            onClick={onStopDeploy}
            disabled={isDeployLoading}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                     bg-red-600 text-white hover:bg-red-700
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            {t('preview.deploy.stop', 'Stop')}
          </button>
        )}
        {deployStatus?.phase === 'running' && deployStatus?.url && (
          <button
            onClick={onOpenDeployUrl}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                     bg-blue-600 text-white hover:bg-blue-700
                     transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t('preview.deploy.open', 'Open')}
          </button>
        )}
      </div>

      {/* Deploy error */}
      {deployStatus?.phase === 'error' && deployStatus?.error && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-700 dark:text-red-300">{deployStatus.error}</p>
        </div>
      )}

      {/* Deploy logs */}
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
