import { KeyRound } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';
import { normalizeRepoUrl } from '@/shared/utils/git-utils';
import type { GitSnapshot } from '@ant/shared';

interface StepGitIntegrationProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
  gitEnabled: boolean;
  onGitEnabledChange: (v: boolean) => void;
  readOnly?: boolean;
  gitSnapshot?: GitSnapshot | null;
  patStatus: { configured: boolean; username?: string } | null;
  showPatInput: boolean;
  onShowPatInput: () => void;
  patInput: string;
  onPatInputChange: (v: string) => void;
  patSaving: boolean;
  patError: string | null;
  onSavePat: () => void;
  repositoryName: string;
  onRepositoryNameChange: (v: string) => void;
  onRepoManualEdit: () => void;
  gitUrl: string;
  onGitUrlChange: (v: string) => void;
  gitUrlFromConfig: boolean;
  ownerInfo: { orgOwner?: string; personalOwner?: string };
  activeOwner: 'org' | 'personal' | null;
  onApplyOwner: (owner: string) => void;
  gitAction: 'none' | 'clone' | 'init';
  onGitActionChange: (action: 'clone' | 'init') => void;
}

export function StepGitIntegration({
  t, gitEnabled, onGitEnabledChange, readOnly, gitSnapshot,
  patStatus, showPatInput, onShowPatInput,
  patInput, onPatInputChange, patSaving, patError, onSavePat,
  repositoryName, onRepositoryNameChange, onRepoManualEdit,
  gitUrl, onGitUrlChange, gitUrlFromConfig,
  ownerInfo, activeOwner, onApplyOwner,
  gitAction, onGitActionChange,
}: StepGitIntegrationProps) {
  const fieldDisabled = readOnly || !patStatus?.configured;

  // Only derive badge from the snapshot in readOnly (existing project with
  // config URL). For a new project in the wizard, the snapshot in the slice
  // belongs to the previously selected project — suppress the badge.
  const badgeState: 'none' | 'not-connected' | 'connected' | 'error' = (() => {
    if (!gitEnabled || !gitUrl) return 'none';
    if (!readOnly) return 'none';
    if (!gitSnapshot) return 'none';
    if (!gitSnapshot.hasGit) return 'not-connected';
    const hasRemote = !!gitSnapshot.remoteUrl;
    if (hasRemote) {
      const match = normalizeRepoUrl(gitUrl) === normalizeRepoUrl(gitSnapshot.remoteUrl!);
      return match ? 'connected' : 'error';
    }
    return 'error';
  })();

  return (
    <>
      {/* Git toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('quickstart.projectWizard.gitEnable')}
          </label>
          {badgeState === 'not-connected' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 font-medium">
              {t('quickstart.projectWizard.gitNotConnected')}
            </span>
          )}
          {badgeState === 'connected' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 font-medium">
              {t('quickstart.projectWizard.gitConnected')}
            </span>
          )}
          {badgeState === 'error' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 font-medium">
              {t('quickstart.projectWizard.gitError')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => !readOnly && onGitEnabledChange(!gitEnabled)}
          disabled={readOnly}
          className={cn(
            'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200',
            readOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            gitEnabled ? 'bg-indigo-500 dark:bg-indigo-400' : 'bg-gray-200 dark:bg-gray-600',
          )}
        >
          <span className={cn(
            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200',
            gitEnabled ? 'translate-x-4' : 'translate-x-0',
          )} />
        </button>
      </div>

      {!gitEnabled ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
          {t('quickstart.projectWizard.gitSkipHint')}
        </p>
      ) : (
        <>
          {/* PAT section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">GitHub PAT</span>
              {patStatus?.configured && patStatus.username && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  {t('quickstart.projectWizard.patConnected', { username: patStatus.username })}
                </span>
              )}
            </div>

            {!readOnly && !patStatus?.configured && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                  {t('quickstart.projectWizard.patRequired')}
                </p>
                {showPatInput ? (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="password"
                        value={patInput}
                        onChange={(e) => onPatInputChange(e.target.value)}
                        placeholder={t('quickstart.projectWizard.patPlaceholder')}
                        className="w-full px-3 py-1.5 text-sm border-2 border-amber-300 dark:border-amber-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-amber-500"
                        onKeyDown={(e) => e.key === 'Enter' && onSavePat()}
                      />
                    </div>
                    <button
                      onClick={onSavePat}
                      disabled={patSaving || !patInput.trim()}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {patSaving ? t('quickstart.projectWizard.patSaving') : t('quickstart.projectWizard.patSave')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={onShowPatInput}
                    className="text-xs text-amber-600 dark:text-amber-400 underline hover:text-amber-700 dark:hover:text-amber-300"
                  >
                    {t('quickstart.projectWizard.patRequiredHint')}
                  </button>
                )}
                {patError && (
                  <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                    {t('quickstart.projectWizard.patError', { error: patError })}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Repository name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t('quickstart.projectWizard.repositoryName')}
            </label>
            <input
              type="text"
              value={repositoryName}
              onChange={(e) => { onRepositoryNameChange(e.target.value); onRepoManualEdit(); }}
              disabled={fieldDisabled}
              readOnly={readOnly}
              className={cn(
                'w-full px-3 py-2 text-sm border-2 rounded-lg outline-none transition-colors',
                fieldDisabled
                  ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:border-indigo-500',
              )}
              placeholder="my-project"
            />
            {!readOnly && (
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                {t('quickstart.projectWizard.repositoryNameHint')}
              </p>
            )}
          </div>

          {/* Git URL + owner quick-fill */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t('quickstart.projectWizard.gitUrl')}
              {gitUrlFromConfig && (
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-normal">
                  {t('quickstart.projectWizard.gitUrlFromConfig')}
                </span>
              )}
            </label>
            {!readOnly && patStatus?.configured && (ownerInfo.orgOwner || ownerInfo.personalOwner) && (
              <div className="flex items-center gap-2 mb-2">
                {ownerInfo.orgOwner && (
                  <button
                    type="button"
                    onClick={() => onApplyOwner(ownerInfo.orgOwner!)}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-md border transition-colors',
                      activeOwner === 'org'
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 font-medium'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
                    )}
                  >
                    Organization: {ownerInfo.orgOwner}
                  </button>
                )}
                {ownerInfo.personalOwner && (
                  <button
                    type="button"
                    onClick={() => onApplyOwner(ownerInfo.personalOwner!)}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-md border transition-colors',
                      activeOwner === 'personal'
                        ? 'bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 font-medium'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
                    )}
                  >
                    Personal: {ownerInfo.personalOwner}
                  </button>
                )}
              </div>
            )}
            <input
              type="text"
              value={gitUrl}
              onChange={(e) => onGitUrlChange(e.target.value)}
              disabled={fieldDisabled}
              readOnly={readOnly}
              className={cn(
                'w-full px-3 py-2 text-sm border-2 rounded-lg outline-none transition-colors',
                fieldDisabled
                  ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:border-indigo-500',
              )}
              placeholder="https://github.com/owner/repo"
            />
          </div>

          {/* Clone / Init radio — hidden when readOnly */}
          {!readOnly && gitUrl.trim() && patStatus?.configured && (
            <div className="space-y-2">
              <label
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  gitAction === 'clone'
                    ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50',
                )}
              >
                <input type="radio" name="gitAction" checked={gitAction === 'clone'} onChange={() => onGitActionChange('clone')} className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('quickstart.projectWizard.gitActionClone')}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">{t('quickstart.projectWizard.gitActionCloneHint')}</div>
                </div>
              </label>
              <label
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  gitAction === 'init'
                    ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50',
                )}
              >
                <input type="radio" name="gitAction" checked={gitAction === 'init'} onChange={() => onGitActionChange('init')} className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('quickstart.projectWizard.gitActionInit')}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">{t('quickstart.projectWizard.gitActionInitHint')}</div>
                </div>
              </label>
            </div>
          )}

          {/* Read-only hint */}
          {readOnly && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">
              {t('quickstart.projectWizard.gitReadOnlyHint')}
            </p>
          )}
        </>
      )}
    </>
  );
}
