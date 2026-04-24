import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useGitPat, useGitPatDispatch } from '@/domain/git-world';
import { 
  fetchOrgConfig,
  fetchUserConfig,
  updateUserConfig,
  resetUserAccount,
} from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useStore } from '@/domain/store';
import { DEFAULT_LOCAL_BACKEND_PORT, STORAGE_KEYS, removeFromStorage } from '@/domain/store/storage';
import { ConfigSection, ConfigIcons, ConfigStyles } from './ConfigSection';
import { Spinner } from './common/async';
import { DangerZoneSection } from './common/DangerZoneSection';
import { DesktopConnectModal } from './DesktopConnectModal';
import { useDesktopBridge } from '@/application/hooks/ui/useDesktopBridge';
import { DESKTOP_DOWNLOAD_URL, FIGMA_DOWNLOAD_URL, FIGMA_DEEPLINK_URL } from '@/presentation/constants/desktop';
import { AntDesktopIcon } from './common/AntDesktopIcon';

interface AccountConfigEditorProps {
  onClose: () => void;
}

export function AccountConfigEditor({ onClose: _onClose }: AccountConfigEditorProps) {
  const { t } = useTranslation('config');
  const { showSuccess, showError, showConfirm } = useAlertModalContext();
  
  // Local backend port state from store
  const localBackendPort = useStore((state) => state.localBackendPort);
  const setLocalBackendPort = useStore((state) => state.setLocalBackendPort);
  const reset = useStore((state) => state.reset);
  
  // Local backend port input state
  const [portInput, setPortInput] = useState(String(localBackendPort));
  const [isPortChanged, setIsPortChanged] = useState(false);
  
  // GitHub PAT — SSOT is the git-world slice. Only the input buffer and
  // the in-flight save/delete guard live locally.
  const patState = useGitPat();
  const { fetchGitPat, savePat, deletePat } = useGitPatDispatch();
  const [githubPAT, setGithubPAT] = useState('');
  const [isSavingPAT, setIsSavingPAT] = useState(false);
  const githubPATConfigured = patState?.configured ?? false;
  const githubUsername = patState?.username;
  const isCheckingPAT = patState === null;
  
  // GitHub Owner state
  const [orgGithubOwner, setOrgGithubOwner] = useState('');       // org-level (read-only)
  const [userOwnerOverride, setUserOwnerOverride] = useState(''); // user override (editable)
  const [savedUserOverride, setSavedUserOverride] = useState(''); // saved user override
  const [isLoadingOwnerConfig, setIsLoadingOwnerConfig] = useState(true);
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  
  // Bridge state from global store (single source of truth)
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const bridgeDetected = useStore((s) => s.bridgeDetected);
  const figmaDesktopReachable = useStore((s) => s.figmaDesktopReachable);
  const accountConfigScrollTarget = useStore((s) => s.accountConfigScrollTarget);
  const setAccountConfigScrollTarget = useStore((s) => s.setAccountConfigScrollTarget);
  const figmaSectionRef = useRef<HTMLDivElement>(null);
  
  const {
    launchPhase,
    isRefreshing: isCheckingBridge,
    launchDesktop,
    retryLaunch,
    cancelLaunch,
    refreshStatus: loadBridgeStatus,
  } = useDesktopBridge({ enablePolling: false });
  
  // Account reset state
  const [isResettingAccount, setIsResettingAccount] = useState(false);
  const [resetPhase, setResetPhase] = useState<'idle' | 'deleting' | 'clearing' | 'done'>('idle');
  
  // Sync port input with store value
  useEffect(() => {
    setPortInput(String(localBackendPort));
    setIsPortChanged(false);
  }, [localBackendPort]);

  // Prime the PAT slice on mount. Subsequent reads come from `patState`.
  useEffect(() => {
    void fetchGitPat();
  }, [fetchGitPat]);
  
  // Load org config (read-only) + user config (editable override) on mount
  useEffect(() => {
    async function loadOwnerConfigs() {
      setIsLoadingOwnerConfig(true);
      try {
        const [orgConfig, userConfig] = await Promise.all([
          fetchOrgConfig(),
          fetchUserConfig(),
        ]);
        setOrgGithubOwner(orgConfig.github?.owner || '');
        const override = userConfig.github?.ownerOverride || '';
        setUserOwnerOverride(override);
        setSavedUserOverride(override);
      } catch (error) {
        console.error('Failed to load owner configs:', error);
      } finally {
        setIsLoadingOwnerConfig(false);
      }
    }
    loadOwnerConfigs();
  }, []);
  

  // Scroll to Figma section when requested (e.g. from GNB indicator)
  useEffect(() => {
    if (accountConfigScrollTarget === 'figma' && figmaSectionRef.current) {
      figmaSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setAccountConfigScrollTarget(null);
    }
  }, [accountConfigScrollTarget]);
  
  // ============================================
  // Handlers
  // ============================================

  const handleSaveGitHubPAT = async () => {
    if (!githubPAT.trim()) {
      showError(t('github.enterPat'));
      return;
    }

    setIsSavingPAT(true);
    try {
      const result = await savePat(githubPAT.trim());
      if (!result.success) {
        showError(result.error || t('github.saveFailed'));
        return;
      }
      setGithubPAT('');
      showSuccess(result.pat?.username
        ? t('account.patSavedWithUser', { username: result.pat.username })
        : t('account.patSaved'));
      // PAT changed — authoritative snapshot refresh for the current
      // (project, feature). Gated CTAs pick up the new auth from git-world.
      const { selectedProject, selectedFeature, fetchGitWorldState } = useStore.getState() as any;
      if (selectedProject) {
        void fetchGitWorldState(selectedProject, { feature: selectedFeature || undefined, fresh: true });
      }
    } catch (error: any) {
      console.error('Failed to save GitHub PAT:', error);
      showError(error.message || t('github.saveFailed'));
    } finally {
      setIsSavingPAT(false);
    }
  };

  const handleSaveOwnerOverride = async () => {
    const trimmed = userOwnerOverride.trim();
    setIsSavingOverride(true);
    try {
      await updateUserConfig({ github: { ownerOverride: trimmed || null } });
      setSavedUserOverride(trimmed);
      if (trimmed) {
        showSuccess(t('account.ownerOverrideSet', { owner: trimmed }));
      } else {
        showSuccess(t('account.ownerOverrideCleared', { suffix: orgGithubOwner ? ` (${orgGithubOwner})` : '' }));
      }
    } catch (error: any) {
      console.error('Failed to save owner override:', error);
      showError(error.message || t('github.ownerSaveFailed'));
    } finally {
      setIsSavingOverride(false);
    }
  };

  const handleDeleteGitHubPAT = async () => {
    showConfirm(t('github.deleteConfirmMsg'), {
      type: 'warning',
      title: t('github.deleteConfirm'),
      confirmText: t('common:button.delete'),
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        setIsSavingPAT(true);
        try {
          const result = await deletePat();
          if (!result.success) {
            showError(result.error || t('github.deleteFailed'));
            return;
          }
          setGithubPAT('');
          showSuccess(t('github.deleteSuccess'));
          const { selectedProject, selectedFeature, fetchGitWorldState } = useStore.getState() as any;
          if (selectedProject) {
            void fetchGitWorldState(selectedProject, { feature: selectedFeature || undefined, fresh: true });
          }
        } catch (error: any) {
          console.error('Failed to delete GitHub PAT:', error);
          showError(error.message || t('github.deleteFailed'));
        } finally {
          setIsSavingPAT(false);
        }
      }
    });
  };

  const handleConnectDesktop = async () => {
    await launchDesktop();
  };

  const handlePortInputChange = (value: string) => {
    setPortInput(value);
    const numValue = parseInt(value, 10);
    setIsPortChanged(!isNaN(numValue) && numValue !== localBackendPort);
  };

  const handleSavePort = () => {
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      showError(t('localBackend.invalidPort'));
      return;
    }
    setLocalBackendPort(port);
    setIsPortChanged(false);
    showSuccess(t('localBackend.portSaved', { port }));
  };

  const handleResetPort = () => {
    setPortInput(String(DEFAULT_LOCAL_BACKEND_PORT));
    setLocalBackendPort(DEFAULT_LOCAL_BACKEND_PORT);
    setIsPortChanged(false);
    showSuccess(t('localBackend.portReset'));
  };

  const handleResetAccount = async () => {
    showConfirm(t('account.resetAccountConfirmMsg'), {
      type: 'error',
      title: t('account.resetAccountConfirm'),
      confirmText: t('common:button.confirm'),
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        setIsResettingAccount(true);
        setResetPhase('deleting');
        try {
          console.log('[AccountConfigEditor] Resetting account...');
          const result = await resetUserAccount();
          
          if (!result.success) {
            setResetPhase('idle');
            showError(result.error || t('account.resetAccountFailed'));
            return;
          }
          
          console.log('[AccountConfigEditor] Account reset successful');
          
          // Phase 2: Clearing local state
          setResetPhase('clearing');
          
          // Clear persisted project/feature state from storage
          removeFromStorage(STORAGE_KEYS.SELECTED_PROJECT);
          removeFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES);
          
          // Reset zustand store state
          reset();
          
          await new Promise((r) => setTimeout(r, 600));
          
          // Phase 3: Done — fade out and reload
          setResetPhase('done');
          
          document.body.style.transition = 'opacity 0.5s ease';
          document.body.style.opacity = '0';
          
          setTimeout(() => {
            window.location.reload();
          }, 500);
        } catch (error: any) {
          console.error('[AccountConfigEditor] Failed to reset account:', error);
          setResetPhase('idle');
          showError(error.message || t('account.resetAccountFailed'));
          setIsResettingAccount(false);
        }
      }
    });
  };

  // ============================================
  // Render Sections
  // ============================================

  const renderLocalBackendSection = () => (
    <ConfigSection
      icon={<ConfigIcons.LocalBackend />}
      title={t('localBackend.title')}
      description={t('localBackend.description')}
      hint={t('localBackend.hint', { port: DEFAULT_LOCAL_BACKEND_PORT })}
    >
      <div>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
          {t('localBackend.portLabel')}
        </label>
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <span className="px-3 py-2 border border-r-0 border-gray-300 dark:border-gray-600 rounded-l-md bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-sm">
              localhost:
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={portInput}
              onChange={(e) => {
                const value = e.target.value.replace(/[^0-9]/g, '');
                handlePortInputChange(value);
              }}
              onFocus={(e) => e.target.select()}
              className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-r-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-sm text-center"
            />
          </div>
          <button
            onClick={handleSavePort}
            disabled={!isPortChanged}
            className={ConfigStyles.buttonPrimary}
          >
            {t('common:button.save')}
          </button>
          <button
            onClick={handleResetPort}
            disabled={localBackendPort === DEFAULT_LOCAL_BACKEND_PORT}
            className={ConfigStyles.buttonSecondary}
          >
            {t('common:button.reset')}
          </button>
        </div>
      </div>
    </ConfigSection>
  );

  const isOverrideChanged = userOwnerOverride.trim() !== savedUserOverride;

  const renderGitHubSection = () => (
    <ConfigSection
      icon={<ConfigIcons.GitHub />}
      title={t('github.title')}
      description={t('github.description')}
      status={{
        state: isCheckingPAT ? 'checking' : (githubPATConfigured ? 'configured' : 'not-configured'),
        label: githubPATConfigured && githubUsername ? `@${githubUsername}` : undefined,
      }}
      hint={undefined}
    >
      {/* ---- Personal Access Token ---- */}
      <div>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
          {t('account.patLabel')}
        </label>
        {githubPATConfigured ? (
          <div className="flex items-center gap-3">
            <div className={`flex-1 ${ConfigStyles.inputDisabled}`}>
              {githubUsername ? (
                <span>
                  <span className="text-gray-900 dark:text-gray-200 font-medium">@{githubUsername}</span>
                  <span className="text-gray-400 dark:text-gray-500 ml-2">••••••••</span>
                </span>
              ) : (
                <span className="text-gray-400">••••••••••••••••••••</span>
              )}
            </div>
            <button
              onClick={handleDeleteGitHubPAT}
              disabled={isSavingPAT}
              className={ConfigStyles.buttonDanger}
            >
              {t('account.deleteButton')}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="password"
              value={githubPAT}
              onChange={(e) => setGithubPAT(e.target.value)}
              placeholder="ghp_••••••••••••••••••••"
              className={ConfigStyles.input}
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveGitHubPAT}
                disabled={isSavingPAT || !githubPAT.trim()}
                className={ConfigStyles.buttonPrimary}
              >
                {isSavingPAT ? t('github.saving') : t('github.savePat')}
              </button>
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=ANT%20CLI%20Access"
                target="_blank"
                rel="noopener noreferrer"
                className={ConfigStyles.buttonSecondary}
              >
                {t('account.generateToken')}
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ---- Divider ---- */}
      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* ---- Default Repository Owner ---- */}
      <div>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-3">
          {t('account.defaultRepoOwner')}
        </label>

        {/* Organization (editable override) */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
            {t('account.organizationBadge')}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {savedUserOverride ? t('account.customOverrideActive') : orgGithubOwner ? t('account.usingOrgDefault') : t('account.notConfigured')}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center flex-1">
            <span className="px-3 py-2 border border-r-0 border-gray-300 dark:border-gray-600 rounded-l-md bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-sm whitespace-nowrap">
              github.com/
            </span>
            <input
              type="text"
              value={userOwnerOverride}
              onChange={(e) => setUserOwnerOverride(e.target.value.replace(/\s/g, ''))}
              placeholder={orgGithubOwner || githubUsername || 'owner'}
              disabled={isLoadingOwnerConfig}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-r-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-sm disabled:opacity-50"
            />
          </div>
          <button
            onClick={handleSaveOwnerOverride}
            disabled={isSavingOverride || !isOverrideChanged}
            className={ConfigStyles.buttonPrimary}
          >
            {isSavingOverride ? t('github.saving') : t('common:button.save')}
          </button>
          {savedUserOverride && (
            <button
              onClick={() => {
                setUserOwnerOverride('');
                setIsSavingOverride(true);
                updateUserConfig({ github: { ownerOverride: null } })
                  .then(() => {
                    setSavedUserOverride('');
                    showSuccess(t('account.revertedToOrgDefault', { suffix: orgGithubOwner ? ` (${orgGithubOwner})` : '' }));
                  })
                  .catch((err: any) => showError(err.message || t('github.clearFailed')))
                  .finally(() => setIsSavingOverride(false));
              }}
              disabled={isSavingOverride}
              className={ConfigStyles.buttonSecondary}
              title={t('github.revertToDefault')}
            >
              {t('common:button.reset')}
            </button>
          )}
        </div>

        {/* Personal Owner (auto-detected from PAT) */}
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              {t('account.personalBadge')}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('github.autoDetected')}</span>
          </div>
          <div className="flex items-center">
            <span className="px-3 py-2 border border-r-0 border-gray-300 dark:border-gray-600 rounded-l-md bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-sm whitespace-nowrap">
              github.com/
            </span>
            <div className={`flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-r-md text-sm ${
              githubUsername 
                ? 'bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white' 
                : 'bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-500 italic'
            }`}>
              {githubUsername || (githubPATConfigured ? t('github.reSavePat') : t('github.savePATToDetect'))}
            </div>
          </div>
        </div>
      </div>
    </ConfigSection>
  );

  const renderFigmaSection = () => {
    const statusState = isCheckingBridge
      ? 'checking' as const
      : (bridgeConnected === true && figmaDesktopReachable)
        ? 'configured' as const
        : 'not-configured' as const;
    const statusLabel = (bridgeConnected === true && figmaDesktopReachable)
      ? t('figma.ready')
      : t('figma.setupNeeded');

    const antDesktopBadge = (() => {
      if (bridgeConnected) return { text: t('figma.statusConnected'), cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' };
      if (bridgeDetected) return { text: t('figma.statusDetected'), cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' };
      return { text: t('figma.statusNotDetected'), cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' };
    })();

    const figmaDesktopBadge = (() => {
      if (!bridgeConnected) return { text: t('figma.statusRequiresAntDesktop'), cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-500' };
      if (figmaDesktopReachable) return { text: t('figma.statusReachable'), cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' };
      return { text: t('figma.statusNotReachable'), cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' };
    })();

    return (
    <ConfigSection
      icon={<ConfigIcons.Figma />}
      title={t('figma.title')}
      description={t('figma.description')}
      status={{ state: statusState, label: statusLabel }}
      extraBadge={
        <button onClick={loadBridgeStatus} disabled={isCheckingBridge}
          className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-50">
          {isCheckingBridge ? (
            <Spinner size="sm" tone="inherit" />
          ) : (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {t('figma.refresh')}
        </button>
      }
    >
      <div className="space-y-2.5">
        {/* Ant Desktop row */}
        <div className="flex items-center gap-2 flex-wrap">
          <AntDesktopIcon className="w-4 h-4 flex-shrink-0" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('figma.antDesktop')}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${antDesktopBadge.cls}`}>
            {antDesktopBadge.text}
          </span>
          {!bridgeConnected && (
            <button onClick={handleConnectDesktop}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              {bridgeDetected ? t('figma.connectAntDesktop') : t('figma.launchAntDesktop')}
            </button>
          )}
          {!bridgeConnected && !bridgeDetected && (
            <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer"
               className="text-xs text-gray-400 dark:text-gray-500 hover:underline">
              {t('figma.downloadAntDesktop')} ↗
            </a>
          )}
        </div>

        {/* Figma Desktop row (always visible) */}
        <div className="flex items-center gap-2 flex-wrap">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 38 57" fill="none">
            <path d="M19 28.5a9.5 9.5 0 1119 0 9.5 9.5 0 01-19 0z" fill="#1ABCFE"/>
            <path d="M0 47.5A9.5 9.5 0 019.5 38H19v9.5a9.5 9.5 0 01-19 0z" fill="#0ACF83"/>
            <path d="M19 0v19h9.5a9.5 9.5 0 000-19H19z" fill="#FF7262"/>
            <path d="M0 9.5A9.5 9.5 0 009.5 19H19V0H9.5A9.5 9.5 0 000 9.5z" fill="#F24E1E"/>
            <path d="M0 28.5A9.5 9.5 0 009.5 38H19V19H9.5A9.5 9.5 0 000 28.5z" fill="#A259FF"/>
          </svg>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {t('figma.figmaDesktop')}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${figmaDesktopBadge.cls}`}>
            {figmaDesktopBadge.text}
          </span>
          {!figmaDesktopReachable && (
            <button
              onClick={() => window.open(FIGMA_DEEPLINK_URL, '_self')}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              {t('figma.launchFigmaDesktop')}
            </button>
          )}
          {!figmaDesktopReachable && (
            <a href={FIGMA_DOWNLOAD_URL} target="_blank"
               rel="noopener noreferrer"
               className="text-xs text-gray-400 dark:text-gray-500 hover:underline">
              {t('figma.downloadFigmaDesktop')} ↗
            </a>
          )}
        </div>

      </div>
    </ConfigSection>
  );
  };

  const renderResetAccountSection = () => (
    <DangerZoneSection
      title={t('account.resetAccount')}
      description={t('account.resetAccountDesc')}
      buttonText={t('account.resetAccount')}
      loadingText={t('account.resetting')}
      isLoading={isResettingAccount}
      onAction={handleResetAccount}
    />
  );

  const resetSteps = [
    { key: 'deleting' as const, label: t('account.resetStepDeleting') },
    { key: 'clearing' as const, label: t('account.resetStepClearing') },
    { key: 'done' as const, label: t('account.resetStepDone') },
  ];

  return (
    <div className="h-full overflow-hidden flex flex-col bg-white dark:bg-gray-800 relative">
      {/* Fullscreen dim overlay during reset */}
      {isResettingAccount && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 mx-4 max-w-sm w-full text-center">
            {/* Spinner */}
            {resetPhase !== 'done' && (
              <div className="mx-auto mb-5 w-10 h-10 flex items-center justify-center">
                <Spinner size="lg" className="text-red-500" />
              </div>
            )}
            {resetPhase === 'done' && (
              <div className="mx-auto mb-5 w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}

            <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
              {t('account.resetting')}
            </h4>

            {/* Step indicators */}
            <div className="space-y-2.5 text-left">
              {resetSteps.map((step) => {
                const stepOrder = resetSteps.findIndex((s) => s.key === step.key);
                const currentOrder = resetSteps.findIndex((s) => s.key === resetPhase);
                const isDone = currentOrder > stepOrder;
                const isCurrent = resetPhase === step.key;

                return (
                  <div key={step.key} className="flex items-center gap-2.5">
                    {isDone ? (
                      <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : isCurrent ? (
                      <div className="w-5 h-5 rounded-full border-2 border-red-400 dark:border-red-500 flex items-center justify-center flex-shrink-0">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-status-pulse" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-gray-200 dark:border-gray-600 flex-shrink-0" />
                    )}
                    <span className={`text-sm ${
                      isCurrent 
                        ? 'text-gray-900 dark:text-white font-medium' 
                        : isDone 
                          ? 'text-gray-500 dark:text-gray-400' 
                          : 'text-gray-300 dark:text-gray-600'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
            <span>👤</span>
            <span>{t('accountConfig.title')}</span>
          </h3>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-8">
          {/* GitHub Integration Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 first:border-t-0 first:pt-0">
            {renderGitHubSection()}
          </div>
          
          {/* Local Backend Section - Hidden: planned feature, not yet supported */}
          {/* <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            {renderLocalBackendSection()}
          </div> */}
          
          <div ref={figmaSectionRef} className="border-t border-gray-200 dark:border-gray-700 pt-6">
            {renderFigmaSection()}
          </div>

          {/* Reset Account Section (Danger Zone) */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            {renderResetAccountSection()}
          </div>
        </div>
      </div>

      <DesktopConnectModal
        launchPhase={launchPhase}
        onRetry={retryLaunch}
        onCancel={cancelLaunch}
      />
    </div>
  );
}
