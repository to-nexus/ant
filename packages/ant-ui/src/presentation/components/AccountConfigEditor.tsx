import { useState, useEffect } from 'react';
import { 
  checkGitHubPATStatus, 
  saveGitHubPAT, 
  deleteGitHubPAT,
  checkFigmaConfigStatus,
  startFigmaOAuth,
  disconnectFigma
} from '@/infrastructure/http/api';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useStore } from '@/domain/store';
import { DEFAULT_LOCAL_BACKEND_PORT } from '@/domain/store/storage';
import { ConfigSection, ConfigIcons, ConfigStyles } from './ConfigSection';

interface AccountConfigEditorProps {
  onClose: () => void;
}

export function AccountConfigEditor({ onClose: _onClose }: AccountConfigEditorProps) {
  const { showSuccess, showError, showConfirm } = useAlertModalContext();
  
  // Local backend port state from store
  const localBackendPort = useStore((state) => state.localBackendPort);
  const setLocalBackendPort = useStore((state) => state.setLocalBackendPort);
  
  // Local backend port input state
  const [portInput, setPortInput] = useState(String(localBackendPort));
  const [isPortChanged, setIsPortChanged] = useState(false);
  
  // GitHub PAT state
  const [githubPAT, setGithubPAT] = useState('');
  const [githubPATConfigured, setGithubPATConfigured] = useState(false);
  const [isCheckingPAT, setIsCheckingPAT] = useState(true);
  const [isSavingPAT, setIsSavingPAT] = useState(false);
  
  // Figma OAuth state
  const [figmaConfigured, setFigmaConfigured] = useState(false);
  const [figmaUserEmail, setFigmaUserEmail] = useState<string | undefined>();
  const [figmaUserId, setFigmaUserId] = useState<string | undefined>();
  const [figmaConnectedAt, setFigmaConnectedAt] = useState<string | undefined>();
  const [isCheckingFigma, setIsCheckingFigma] = useState(true);
  const [isDisconnectingFigma, setIsDisconnectingFigma] = useState(false);
  
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
      } catch (error) {
        console.error('Failed to check GitHub PAT status:', error);
      } finally {
        setIsCheckingPAT(false);
      }
    }
    loadGitHubPATStatus();
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
          showSuccess(`Figma connected as ${status.email}!`);
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
      showError('Please enter a GitHub Personal Access Token');
      return;
    }
    
    setIsSavingPAT(true);
    try {
      await saveGitHubPAT(githubPAT.trim());
      setGithubPATConfigured(true);
      setGithubPAT(''); // Clear input after successful save
      showSuccess('GitHub PAT saved successfully!');
    } catch (error: any) {
      console.error('Failed to save GitHub PAT:', error);
      showError(error.message || 'Failed to save GitHub PAT. Please try again.');
    } finally {
      setIsSavingPAT(false);
    }
  };

  const handleDeleteGitHubPAT = async () => {
    showConfirm('GitHub PAT을 삭제할까요? 모든 프로젝트에 영향이 있습니다.', {
      type: 'warning',
      title: 'Delete GitHub PAT?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: async () => {
        setIsSavingPAT(true);
        try {
          await deleteGitHubPAT();
          setGithubPATConfigured(false);
          setGithubPAT('');
          showSuccess('GitHub PAT deleted successfully');
        } catch (error: any) {
          console.error('Failed to delete GitHub PAT:', error);
          showError(error.message || 'Failed to delete GitHub PAT. Please try again.');
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
      showError(error.message || 'Failed to start Figma OAuth. Please try again.');
    }
  };

  const handleDisconnectFigma = async () => {
    showConfirm('Figma 연결을 해제할까요? Figma 연동을 사용하는 모든 프로젝트에 영향이 있습니다.', {
      type: 'warning',
      title: 'Disconnect Figma?',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      onConfirm: async () => {
        setIsDisconnectingFigma(true);
        try {
          console.log('[AccountConfigEditor] Disconnecting Figma...');
          await disconnectFigma();
          setFigmaConfigured(false);
          setFigmaUserEmail(undefined);
          setFigmaUserId(undefined);
          setFigmaConnectedAt(undefined);
          showSuccess('Figma disconnected successfully');
        } catch (error: any) {
          console.error('[AccountConfigEditor] Failed to disconnect Figma:', error);
          showError(error.message || 'Failed to disconnect Figma. Please try again.');
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
      showError('Please enter a valid port number (1-65535)');
      return;
    }
    setLocalBackendPort(port);
    setIsPortChanged(false);
    showSuccess(`Local backend port set to ${port}`);
  };

  const handleResetPort = () => {
    setPortInput(String(DEFAULT_LOCAL_BACKEND_PORT));
    setLocalBackendPort(DEFAULT_LOCAL_BACKEND_PORT);
    setIsPortChanged(false);
    showSuccess(`Local backend port reset to default (${DEFAULT_LOCAL_BACKEND_PORT})`);
  };

  // ============================================
  // Render Sections
  // ============================================

  const renderLocalBackendSection = () => (
    <ConfigSection
      icon={<ConfigIcons.LocalBackend />}
      title="Local Backend"
      description="Configure the port for your on-premise ANT backend server"
      hint={<>Default: <code className={ConfigStyles.code}>{DEFAULT_LOCAL_BACKEND_PORT}</code> • Used when "Local" mode is selected</>}
    >
      <div>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
          Backend Port
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
            Save
          </button>
          <button
            onClick={handleResetPort}
            disabled={localBackendPort === DEFAULT_LOCAL_BACKEND_PORT}
            className={ConfigStyles.buttonSecondary}
          >
            Reset
          </button>
        </div>
      </div>
    </ConfigSection>
  );

  const renderGitHubSection = () => (
    <ConfigSection
      icon={<ConfigIcons.GitHub />}
      title="GitHub Integration"
      description="Connect your GitHub account to enable repository sync"
      status={{
        state: isCheckingPAT ? 'checking' : (githubPATConfigured ? 'configured' : 'not-configured'),
      }}
      hint={<>Required scopes: <code className={ConfigStyles.code}>repo</code></>}
    >
      <div>
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
          Personal Access Token
        </label>
        {githubPATConfigured ? (
          <div className="flex items-center gap-3">
            <input
              type="password"
              value="••••••••••••••••••••"
              disabled
              className={`flex-1 ${ConfigStyles.inputDisabled}`}
            />
            <button
              onClick={handleDeleteGitHubPAT}
              disabled={isSavingPAT}
              className={ConfigStyles.buttonDanger}
            >
              Delete
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
                {isSavingPAT ? 'Saving...' : 'Save PAT'}
              </button>
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=ANT%20CLI%20Access"
                target="_blank"
                rel="noopener noreferrer"
                className={ConfigStyles.buttonSecondary}
              >
                Generate Token →
              </a>
            </div>
          </div>
        )}
      </div>
    </ConfigSection>
  );

  const renderFigmaSection = () => (
    <ConfigSection
      icon={<ConfigIcons.Figma />}
      title="Figma Integration"
      description="Connect your Figma account to import designs"
      status={{
        state: isCheckingFigma ? 'checking' : (figmaConfigured ? 'configured' : 'not-configured'),
        label: figmaConfigured ? '✓ Connected' : 'Not connected',
      }}
      hint="OAuth 2.0 authentication • Managed securely by Figma"
    >
      {figmaConfigured ? (
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
            Connected Account
          </label>
          <div className="flex items-center gap-3">
            <div className={`flex-1 ${ConfigStyles.inputDisabled}`}>
              {figmaUserEmail || figmaUserId || 'Connected'}
              {figmaConnectedAt && (
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                  (Connected: {new Date(figmaConnectedAt).toLocaleDateString()})
                </span>
              )}
            </div>
            <button
              onClick={handleDisconnectFigma}
              disabled={isDisconnectingFigma}
              className={ConfigStyles.buttonDanger}
            >
              {isDisconnectingFigma ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            onClick={handleConnectFigma}
            className={ConfigStyles.buttonPurple}
          >
            Connect Figma Account
          </button>
        </div>
      )}
    </ConfigSection>
  );

  return (
    <div className="h-full overflow-hidden flex flex-col bg-white dark:bg-gray-800">
      <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
            <span>👤</span>
            <span>Account Configuration</span>
          </h3>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-8">
          {/* Local Backend Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 first:border-t-0 first:pt-0">
            {renderLocalBackendSection()}
          </div>
          
          {/* GitHub Integration Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            {renderGitHubSection()}
          </div>
          
          {/* Figma Integration Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            {renderFigmaSection()}
          </div>
        </div>
      </div>
    </div>
  );
}
