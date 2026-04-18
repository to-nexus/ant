import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, Github, Download, Plus, Upload, Download as DownloadIcon, RefreshCw, Globe } from 'lucide-react';
import { useStore } from '@/domain/store';
import {
  createProject,
  cloneGitHubRepo,
  initializeGitHubRepo,
  pushToGitHub,
  pullFromGitHub
} from '@/infrastructure/http/api';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useToastContext } from '@/presentation/providers/ToastProvider';
import { GitStatusButton } from './GitStatusButton';
import { Button } from '@/presentation/components/common/button';
import { Tooltip } from '@/presentation/components/common/Tooltip';
import { CreationWizardModal } from './CreationWizardModal';
import { deriveGitMenuState } from '@/domain/git/selectors';
import { useGitState, useGitActions } from '@/application/hooks/git';
import {
  selectProjectConfigMissing,
  selectProjectConfigExists,
} from '@/domain/store/selectors';

export function ProjectSection({ explorerWidth }: { explorerWidth: number }) {
  const { t } = useTranslation('explorer');
  const {
    projects,
    selectedProject,
    selectedFeature,
    setSelectedProject,
    fetchProjects,
    openMainPanelTab,
    backendMode,
    fetchProjectConfig,
    createProjectConfig,
  } = useStore();
  // Primitive selectors keep this component re-rendering only on the fields
  // it actually uses. See docs/architecture/ui-async-policy.md §Zustand.
  const projectConfigData = useStore((s) => s.projectConfig.data);
  const projectConfigMissing = useStore(selectProjectConfigMissing);
  const projectConfigReady = useStore(selectProjectConfigExists);
  const { gitStatus, gitChanges, gitStatusPhase } = useGitState();
  const { fetchGitAll, fetchFromRemote, setGitStatusPhase } = useGitActions();
  const [showGitMenu, setShowGitMenu] = useState(false);
  const [isGitProcessing, setIsGitProcessing] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [forceInlineCreate, setForceInlineCreate] = useState(false);
  const handleOpenWizard = useCallback(() => setShowWizard(true), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleCreateEmpty = useCallback(() => {
    setShowWizard(false);
    setForceInlineCreate(true);
  }, []);
  const handleForceInlineCreateHandled = useCallback(() => setForceInlineCreate(false), []);
  const gitMenuRef = useRef<HTMLDivElement>(null);
  const policy = useUIActionPolicy();
  const { showError, showWarning, showConfirm } = useAlertModalContext();
  const { toast } = useToastContext();

  // Click outside to close Git menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (gitMenuRef.current && !gitMenuRef.current.contains(event.target as Node)) {
        setShowGitMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initial project config fetch. Per-(project, feature) git fetches are owned
  // by `useGitRefresh` — this effect only pulls projectConfig because it's
  // project-scoped (feature-independent).
  useEffect(() => {
    if (selectedProject) {
      fetchProjectConfig(selectedProject);
    }
  }, [selectedProject, fetchProjectConfig]);

  const handleCreateProject = async (projectName: string) => {
    await createProject(projectName);
    setSelectedProject(projectName);
  };

  const handleConfigClick = async () => {
    if (!selectedProject) return;

    if (projectConfigMissing) {
      try {
        await createProjectConfig(selectedProject, backendMode);
      } catch (error) {
        console.error('Failed to create config:', error);
        showError(t('workspace.createFailed'));
        return;
      }
    }

    openMainPanelTab('projectConfig');
  };

  const isPATError = (msg: string) =>
    /pat/i.test(msg) && /(not configured|not set|missing|없|설정)/i.test(msg);

  const showPATError = () => {
    showError(t('git.patNotConfigured'), {
      confirmText: t('git.configurePat'),
      onConfirm: () => {
        openMainPanelTab('accountConfig');
      },
    });
  };

  const handleGitAction = async (
    action: () => Promise<any>,
    actionType: 'push' | 'pull' | 'clone' | 'init',
    shouldRefreshAll = true
  ) => {
    if (!selectedProject) return;

    setShowGitMenu(false);
    setIsGitProcessing(true);

    const phaseMap = {
      'push': 'pushing',
      'pull': 'pulling',
      'clone': 'cloning',
      'init': 'initializing'
    } as const;

    setGitStatusPhase(phaseMap[actionType]);

    try {
      const result = await action();
      if (result.success) {
        if (actionType === 'clone' || actionType === 'init') {
          const successMessages = {
            'clone': t('git.repoCloned'),
            'init': t('git.repoInitialized')
          } as const;
          if (result.warnings?.length) {
            showWarning(
              `${successMessages[actionType]}\n\n${t('git.partialWarnings')}:\n${result.warnings.join('\n')}`
            );
          } else {
            toast.success(successMessages[actionType]);
          }
          useStore.getState().reloadIdeFrame();
        } else if (actionType === 'push') {
          toast.success(t('git.pushSuccess'));
        } else if (actionType === 'pull') {
          toast.success(t('git.pullSuccess'));
        }
      } else {
        const errMsg = result.error || t('git.actionFailed', { action: actionType });
        if (isPATError(errMsg)) {
          showPATError();
        } else {
          showError(errMsg);
        }
      }
    } catch (error: any) {
      const errMsg = error.message || t('git.actionFailed', { action: actionType });
      if (isPATError(errMsg)) {
        showPATError();
      } else {
        showError(errMsg);
      }
    } finally {
      setIsGitProcessing(false);
      setGitStatusPhase(null);
      if (shouldRefreshAll && selectedProject) {
        // clone/init may have flipped disk-level flags (hasGit, remoteUrl) —
        // pull both endpoints back so CTAs update.
        fetchGitAll(selectedProject, selectedFeature || undefined);
      }
    }
  };

  const handleClone = () => {
    setShowGitMenu(false);
    showConfirm(t('config:git.confirmClone'), {
      title: t('config:git.clone'),
      type: 'info',
      confirmText: t('config:git.clone'),
      onConfirm: () => handleGitAction(
        () => cloneGitHubRepo(selectedProject!), 'clone', true
      ),
    });
  };

  const handleInitialize = () => {
    setShowGitMenu(false);
    showConfirm(t('config:git.confirmInit'), {
      title: t('config:git.initialize'),
      type: 'info',
      confirmText: t('config:git.initialize'),
      onConfirm: () => handleGitAction(
        () => initializeGitHubRepo(selectedProject!, selectedFeature || undefined), 'init', true
      ),
    });
  };

  const handlePublish = () => {
    setShowGitMenu(false);
    showConfirm(t('config:git.confirmPublish'), {
      title: t('config:git.publish'),
      type: 'info',
      confirmText: t('config:git.publish'),
      onConfirm: () => handleGitAction(
        () => initializeGitHubRepo(selectedProject!, selectedFeature || undefined), 'init', true
      ),
    });
  };

  // push/pull don't mutate disk-level flags, so skip the /status refetch and
  // only pull fresh /changes (the action itself triggers an SSE gitChange too).
  const handlePush = () => handleGitAction(
    () => pushToGitHub(selectedProject!, selectedFeature || undefined),
    'push',
    false
  );

  const handlePull = () => handleGitAction(
    () => pullFromGitHub(selectedProject!, selectedFeature || undefined),
    'pull',
    false
  );

  // Explicit user-initiated remote fetch. `fetchFromRemote` handles the
  // GIT_FETCH_INTERVAL throttle and always refreshes /changes afterwards.
  const handleFetch = () => {
    if (!selectedProject) return;
    setShowGitMenu(false);
    fetchFromRemote(selectedProject, selectedFeature || undefined);
  };

  const projectItems = projects.map((p: string) => ({ name: p }));

  return (
    <div>
      <ItemDropdown
        title={t('workspace.title')}
        icon={Folder}
        items={projectItems}
        selectedItem={selectedProject}
        onSelect={setSelectedProject}
        onCreate={handleCreateProject}
        onItemCreated={fetchProjects}
        placeholder={t('workspace.placeholder')}
        inputPlaceholder={t('workspace.inputPlaceholder')}
        onSettingsClick={handleConfigClick}
        disabled={!policy.canChangeProject}
        disabledReason={policy.disabledReason || undefined}
        onOpenWizard={handleOpenWizard}
        forceInlineCreate={forceInlineCreate}
        onForceInlineCreateHandled={handleForceInlineCreateHandled}
        isNarrow={explorerWidth < 260}
      />

      <CreationWizardModal
        isOpen={showWizard}
        onClose={handleCloseWizard}
        onCreateEmpty={handleCreateEmpty}
      />

      {/* Git Status Section */}
      {selectedProject && (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            <GitStatusButton />

            {/* Git Control Button */}
            <div className="relative" ref={gitMenuRef}>
              {!projectConfigData?.githubRepo ? (
                <Tooltip
                  content={
                    <div className="max-w-xs space-y-2">
                      <p className="font-semibold">{t('config:git.repoSetupRequired')}</p>
                      <ol className="list-decimal list-inside space-y-1.5 text-xs">
                        <li>
                          <strong>{t('config:git.setupStep1')}</strong>
                          <div className="ml-4 text-gray-400">{t('config:git.setupStep1Desc')}</div>
                        </li>
                        <li>
                          <strong>{t('config:git.setupStep2')}</strong>
                          <div className="ml-4 text-gray-400">{t('config:git.setupStep2Desc')}</div>
                        </li>
                      </ol>
                      <p className="text-xs text-gray-400 border-t border-gray-600 pt-1.5">{t('config:git.setupComplete')}</p>
                    </div>
                  }
                  placement="bottom"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-2 py-1.5 opacity-50 cursor-pointer"
                  >
                    <Github className="w-4 h-4" />
                  </Button>
                </Tooltip>
              ) : (
                <Button
                  onClick={() => setShowGitMenu(!showGitMenu)}
                  variant="outline"
                  size="sm"
                  className="px-2 py-1.5"
                  disabled={isGitProcessing || gitStatusPhase !== null}
                  title={t('config:git.management')}
                >
                  <Github className="w-4 h-4" />
                </Button>
              )}

              {/* Git Menu Dropdown */}
              {showGitMenu && (() => {
                const menu = deriveGitMenuState({
                  gitStatus,
                  gitChanges,
                  githubRepo: projectConfigData?.githubRepo ?? null,
                });
                const disabledClass = 'opacity-40 cursor-not-allowed';
                const enabledClass = 'hover:bg-gray-100 dark:hover:bg-gray-700';
                return (
                <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999]">
                  {menu.kind === 'loading' && (
                    <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                      {t('common:status.checking')}
                    </div>
                  )}
                  {menu.kind === 'disabled' && (
                    <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                      {t('config:git.repoSetupRequired')}
                    </div>
                  )}
                  {menu.kind === 'publishBranch' && (
                    <button
                      onClick={menu.source === 'noFeatures' ? handlePublish : handlePush}
                      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <Globe className="w-4 h-4" />
                      <div>
                        <div className="font-medium">{t('config:git.publish')}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {menu.source === 'noFeatures'
                            ? t('config:git.publishToGitHubDesc')
                            : t('config:git.publishDesc')}
                        </div>
                      </div>
                    </button>
                  )}
                  {menu.kind === 'setup' && (
                    <>
                      {menu.actions.includes('clone') && (
                        <button
                          onClick={handleClone}
                          className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Download className="w-4 h-4" />
                          <div>
                            <div className="font-medium">{t('config:git.clone')}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.cloneDesc')}</div>
                          </div>
                        </button>
                      )}
                      {menu.actions.includes('initialize') && (
                        <button
                          onClick={handleInitialize}
                          className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <Plus className="w-4 h-4" />
                          <div>
                            <div className="font-medium">{t('config:git.initialize')}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.initializeDesc')}</div>
                          </div>
                        </button>
                      )}
                    </>
                  )}
                  {menu.kind === 'synced' && (
                    <>
                      <button
                        onClick={menu.canPush ? handlePush : undefined}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 ${menu.canPush ? enabledClass : disabledClass}`}
                        disabled={!menu.canPush}
                      >
                        <Upload className="w-4 h-4" />
                        <div>
                          <div className="font-medium">{t('config:git.push')}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.pushDesc')}</div>
                        </div>
                      </button>
                      <button
                        onClick={menu.canPull ? handlePull : undefined}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 ${menu.canPull ? enabledClass : disabledClass}`}
                        disabled={!menu.canPull}
                        title={menu.pullBlockedByChanges ? t('git.commitFirstToPull') : undefined}
                      >
                        <DownloadIcon className="w-4 h-4" />
                        <div>
                          <div className="font-medium">{t('config:git.pull')}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {menu.pullBlockedByChanges ? t('git.commitFirstToPull') : t('config:git.pullDesc')}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={handleFetch}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 ${enabledClass}`}
                      >
                        <RefreshCw className="w-4 h-4" />
                        <div>
                          <div className="font-medium">{t('config:git.fetch')}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.fetchDesc')}</div>
                        </div>
                      </button>
                    </>
                  )}
                </div>
                );
              })()}
            </div>
          </div>

          {/* Current Branch Display.
              Branch name is derived from /git/status — no fallback to
              /git/changes needed, since /status responds first when /git is
              initialized. */}
          {gitStatus?.currentBranch && (
            <div className="px-2 text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {explorerWidth >= 260 && <>{t('config:git.currentBranch')}{' '}</>}
              <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{gitStatus.currentBranch}</span>
            </div>
          )}

          {/* Warning Messages */}
          {projectConfigMissing && (
            <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
              <div className="flex items-start gap-1.5">
                <span className="text-orange-600 dark:text-orange-400 text-xs flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    {t('config:git.configRequired')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {backendMode !== 'cloud' && projectConfigReady && !projectConfigData?.localPath && projectConfigData?.repoType !== 'cloud' && (
            <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
              <div className="flex items-start gap-1.5">
                <span className="text-orange-600 dark:text-orange-400 text-xs flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    {t('config:git.localPathRequired')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
