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

interface AccountConfigEditorProps {
  onClose: () => void;
}

export function AccountConfigEditor({ onClose }: AccountConfigEditorProps) {
  const { showSuccess, showError, showConfirm } = useAlertModalContext();
  
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

  const renderGitHubSection = () => {
    return (
      <div className="flex gap-6 items-start">
        {/* Left: GitHub Icon */}
        <div className="flex-shrink-0 flex items-center justify-center w-24">
          <svg className="w-20 h-20" viewBox="0 0 98 96" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" className="fill-[#24292f] dark:fill-white"/>
          </svg>
        </div>
        
        {/* Right: GitHub Configuration UI */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">GitHub Integration</h4>
            </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
          {isCheckingPAT ? (
              <span className="text-xs text-gray-500">Checking...</span>
            ) : (
              <span className={`text-xs px-2 py-0.5 rounded ${
                githubPATConfigured 
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' 
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}>
                {githubPATConfigured ? '✓ Configured' : 'Not configured'}
              </span>
            )}
          </p>
        </div>
        
        <div className="space-y-3">
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
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-sm"
                />
                <button
                  onClick={handleDeleteGitHubPAT}
                  disabled={isSavingPAT}
                  className="w-24 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            ) : (
              <>
                <input
                  type="password"
                  value={githubPAT}
                  onChange={(e) => setGithubPAT(e.target.value)}
                  placeholder="ghp_••••••••••••••••••••"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-sm mb-2"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveGitHubPAT}
                    disabled={isSavingPAT || !githubPAT.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingPAT ? 'Saving...' : 'Save PAT'}
                  </button>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=ANT%20CLI%20Access"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
                  >
                    Generate Token →
                  </a>
                </div>
              </>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Required scopes: <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">repo</code>
          </p>
        </div>
      </div>
    );
  };

  const renderFigmaSection = () => {
    return (
      <div className="flex gap-6 items-start">
        {/* Left: Figma Icon */}
        <div className="flex-shrink-0 flex items-center justify-center w-24">
          <svg className="w-20 h-20" viewBox="0 0 38 57" fill="none">
            <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
            <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
            <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
            <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
            <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
          </svg>
        </div>
        
        {/* Right: Figma Configuration UI */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Figma Integration</h4>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
          {isCheckingFigma ? (
              <span className="text-xs text-gray-500">Checking...</span>
            ) : (
              <span className={`text-xs px-2 py-0.5 rounded ${
                figmaConfigured 
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' 
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}>
                {figmaConfigured ? '✓ Connected' : 'Not connected'}
              </span>
            )}
          </p>
        </div>
        
        <div className="space-y-3">
          {figmaConfigured ? (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
                Connected Account
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 text-sm">
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
                  className="w-24 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors disabled:opacity-50"
                >
                  {isDisconnectingFigma ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                onClick={handleConnectFigma}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md transition-colors"
              >
                Connect Figma Account
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Opens OAuth popup to authorize ANT to access your Figma files
              </p>
            </div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            OAuth 2.0 authentication • Managed securely by Figma
          </p>
        </div>
      </div>
    );
  };

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
          {/* GitHub Integration Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 first:border-t-0 first:pt-0">
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
