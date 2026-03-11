import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  checkGitHubPATStatus, 
  saveGitHubPAT, 
  deleteGitHubPAT,
  checkFigmaConfigStatus,
  startFigmaOAuth,
  disconnectFigma,
  fetchOrgConfig,
  fetchUserConfig,
  updateUserConfig,
  resetUserAccount,
} from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useStore } from '@/domain/store';
import { DEFAULT_LOCAL_BACKEND_PORT, STORAGE_KEYS, removeFromStorage } from '@/domain/store/storage';
import { ConfigSection, ConfigIcons, ConfigStyles } from './ConfigSection';
import { DangerZoneSection } from './common/DangerZoneSection';

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
  
  // GitHub PAT state
  const [githubPAT, setGithubPAT] = useState('');
  const [githubPATConfigured, setGithubPATConfigured] = useState(false);
  const [githubUsername, setGithubUsername] = useState<string | undefined>();
  const [isCheckingPAT, setIsCheckingPAT] = useState(true);
  const [isSavingPAT, setIsSavingPAT] = useState(false);
  
  // GitHub Owner state
  const [orgGithubOwner, setOrgGithubOwner] = useState('');       // org-level (read-only)
  const [userOwnerOverride, setUserOwnerOverride] = useState(''); // user override (editable)
  const [savedUserOverride, setSavedUserOverride] = useState(''); // saved user override
  const [isLoadingOwnerConfig, setIsLoadingOwnerConfig] = useState(true);
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  
  // Figma OAuth state
  const [figmaConfigured, setFigmaConfigured] = useState(false);
  const [figmaUserEmail, setFigmaUserEmail] = useState<string | undefined>();
  const [figmaUserId, setFigmaUserId] = useState<string | undefined>();
  const [figmaConnectedAt, setFigmaConnectedAt] = useState<string | undefined>();
  const [isCheckingFigma, setIsCheckingFigma] = useState(true);
  const [isDisconnectingFigma, setIsDisconnectingFigma] = useState(false);
  
  // Account reset state
  const [isResettingAccount, setIsResettingAccount] = useState(false);
  const [resetPhase, setResetPhase] = useState<'idle' | 'deleting' | 'clearing' | 'done'>('idle');
  
  // Sync port input with store value
  useEffect(() => {
    setPortInput(String(localBackendPort));
    setIsPortChanged(false);
  }, [localBackendPort]);

  // Load GitHub PAT status on mount
  useEffect(() => {
    async function loadGitHubPATStatus() {
      setIsCheckingPAT(true);
      try {
        const status = await checkGitHubPATStatus();
        setGithubPATConfigured(status.configured);
        setGithubUsername(status.username);
      } catch (error) {
        console.error('Failed to check GitHub PAT status:', error);
      } finally {
        setIsCheckingPAT(false);
      }
    }
    loadGitHubPATStatus();
  }, []);
  
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
  
  // Load Figma config status on mount
  useEffect(() => {
    async function loadFigmaConfigStatus() {
      console.log('[AccountConfigEditor] Loading initial Figma config status...');
      setIsCheckingFigma(true);
      try {
        const status = await checkFigmaConfigStatus();
        console.log('[AccountConfigEditor] Initial Figma status:', status);
        
        setFigmaConfigured(status.configured);
        setFigmaUserEmail(status.email);
        setFigmaUserId(status.userId);
        setFigmaConnectedAt(status.updatedAt);
        
        if (status.configured) {
          console.log('[AccountConfigEditor] Figma is already connected:', status.email);
        } else {
          console.log('[AccountConfigEditor] Figma is not connected');
        }
      } catch (error) {
        console.error('[AccountConfigEditor] Failed to check Figma config status:', error);
      } finally {
        setIsCheckingFigma(false);
      }
    }
    loadFigmaConfigStatus();
  }, []);
  
  // Listen for OAuth completion via postMessage
  useEffect(() => {
    const reloadFigmaStatus = async () => {
      try {
        console.log('[AccountConfigEditor] Reloading Figma status...');
        const status = await checkFigmaConfigStatus();
        console.log('[AccountConfigEditor] Figma status:', status);
        
        setFigmaConfigured(status.configured);
        setFigmaUserEmail(status.email);
        setFigmaUserId(status.userId);
        setFigmaConnectedAt(status.updatedAt);
        
        if (status.configured) {
          showSuccess(t('account.figmaConnectedAs', { email: status.email }));
        }
      } catch (error) {
        console.error('[AccountConfigEditor] Failed to reload Figma status:', error);
      }
    };
    
    // Handle postMessage from OAuth popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'figma-oauth-success') {
        console.log('[AccountConfigEditor] ✅ Received OAuth success message:', event.data);
        // Wait a bit for backend to save, then reload once
        setTimeout(() => reloadFigmaStatus(), 500);
      }
    };
    
    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

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
      const result = await saveGitHubPAT(githubPAT.trim());
      setGithubPATConfigured(true);
      setGithubUsername(result.username);
      setGithubPAT('');
      showSuccess(result.username 
        ? t('account.patSavedWithUser', { username: result.username }) 
        : t('account.patSaved'));
      useStore.getState().refreshGitStatus();
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
          await deleteGitHubPAT();
          setGithubPATConfigured(false);
          setGithubUsername(undefined);
          setGithubPAT('');
          showSuccess(t('github.deleteSuccess'));
          useStore.getState().refreshGitStatus();
        } catch (error: any) {
          console.error('Failed to delete GitHub PAT:', error);
          showError(error.message || t('github.deleteFailed'));
        } finally {
          setIsSavingPAT(false);
        }
      }
    });
  };

  const handleConnectFigma = async () => {
    try {
      console.log('[AccountConfigEditor] Starting Figma OAuth...');
      await startFigmaOAuth();
      // OAuth flow will trigger postMessage when complete
    } catch (error: any) {
      console.error('[AccountConfigEditor] Failed to start Figma OAuth:', error);
      showError(error.message || t('figma.oauthFailed'));
    }
  };

  const handleDisconnectFigma = async () => {
    showConfirm(t('figma.disconnectConfirm'), {
      type: 'warning',
      title: t('figma.disconnectConfirm'),
      confirmText: t('common:button.delete'),
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        setIsDisconnectingFigma(true);
        try {
          console.log('[AccountConfigEditor] Disconnecting Figma...');
          await disconnectFigma();
          setFigmaConfigured(false);
          setFigmaUserEmail(undefined);
          setFigmaUserId(undefined);
          setFigmaConnectedAt(undefined);
          showSuccess(t('figma.disconnected'));
        } catch (error: any) {
          console.error('[AccountConfigEditor] Failed to disconnect Figma:', error);
          showError(error.message || t('figma.disconnectFailed'));
        } finally {
          setIsDisconnectingFigma(false);
        }
      }
    });
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

  const renderFigmaSection = () => (
    <ConfigSection
      icon={<ConfigIcons.Figma />}
      title={t('figma.title')}
      description={t('figma.description')}
      status={{
        state: isCheckingFigma ? 'checking' : (figmaConfigured ? 'configured' : 'not-configured'),
        label: figmaConfigured ? t('account.figmaConnected') : t('account.figmaNotConnected'),
      }}
      extraBadge={figmaConfigured ? (
        <span className="text-xs px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
          {t('figma.comingSoon')}
        </span>
      ) : undefined}
      hint={t('account.figmaOauthHint')}
    >
      {figmaConfigured ? (
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
            {t('account.connectedAccount')}
          </label>
          <div className="flex items-center gap-3">
            <div className={`flex-1 ${ConfigStyles.inputDisabled}`}>
              {figmaUserEmail || figmaUserId || t('account.connectedFallback')}
              {figmaConnectedAt && (
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                  {t('account.connectedDate', { date: new Date(figmaConnectedAt).toLocaleDateString() })}
                </span>
              )}
            </div>
            <button
              onClick={handleDisconnectFigma}
              disabled={isDisconnectingFigma}
              className={ConfigStyles.buttonDanger}
            >
              {isDisconnectingFigma ? t('account.disconnecting') : t('account.disconnect')}
            </button>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
            {t('figma.connected')}
          </p>
        </div>
      ) : (
        <div>
          <button
            onClick={handleConnectFigma}
            className={ConfigStyles.buttonPurple}
          >
            {t('account.connectFigma')}
          </button>
        </div>
      )}
    </ConfigSection>
  );

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
              <div className="mx-auto mb-5 w-10 h-10 border-3 border-gray-200 dark:border-gray-600 border-t-red-500 rounded-full animate-spin" />
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
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
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
          
          {/* Figma Integration Section - Hidden: planned feature, not yet supported */}
          {/* <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            {renderFigmaSection()}
          </div> */}

          {/* Reset Account Section (Danger Zone) */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            {renderResetAccountSection()}
          </div>
        </div>
      </div>
    </div>
  );
}
