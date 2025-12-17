import { useState, useEffect } from 'react';
import { 
  ProjectConfig, 
  checkGitHubPATStatus, 
  saveGitHubPAT, 
  deleteGitHubPAT,
  checkFigmaConfigStatus,
  startFigmaOAuth,
  disconnectFigma
} from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';

interface ConfigEditorProps {
  config: ProjectConfig;
  onSave: (config: ProjectConfig) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}

interface ConfigField {
  key: keyof ProjectConfig;
  label: string;
  type: 'text' | 'boolean' | 'select';
  required: boolean;
  options?: string[];
  description?: string;
}

// LLM Model options by provider (optimized for coding)
const LLM_MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude 4.5 Sonnet (Latest, best for coding)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude 4.5 Haiku (Fast & efficient)' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o (Optimized)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
    { value: 'o1-preview', label: 'o1 Preview (Advanced reasoning)' },
    { value: 'o1-mini', label: 'o1 Mini (Efficient reasoning)' },
  ],
};

const CONFIG_SCHEMA: ConfigField[] = [
  {
    key: 'repositoryName',
    label: 'Repository Name',
    type: 'text',
    required: true,
    description: 'Name of the codebase/repository'
  },
  {
    key: 'repoType',
    label: 'Repository Type',
    type: 'select',
    required: false,
    options: ['local', 'cloud', 'github'],
    description: 'Type of repository (local, cloud, or GitHub)'
  },
  {
    key: 'localPath',
    label: 'Local Path',
    type: 'text',
    required: false,
    description: 'Path to local repository. Supports: absolute (/Users/...), home (~/ ), or relative from ant-cli (../../../my-repo)'
  },
  {
    key: 'githubRepo',
    label: 'GitHub Repository',
    type: 'text',
    required: false,
    description: 'GitHub repository URL (for github repo type)'
  },
  {
    key: 'branchBase',
    label: 'Base Branch',
    type: 'text',
    required: true,
    description: 'Base branch name (e.g., main, master)'
  },
  {
    key: 'autoLearn',
    label: 'Auto Learn',
    type: 'boolean',
    required: true,
    description: 'Enable automatic learning from code changes'
  },
  {
    key: 'strictValidation',
    label: 'Strict Validation',
    type: 'boolean',
    required: false,
    description: 'Enable strict validation mode'
  },
  {
    key: 'llmProvider',
    label: 'LLM Provider',
    type: 'select',
    required: false,
    options: ['anthropic', 'openai'],
    description: 'LLM provider to use'
  },
  {
    key: 'llmModel',
    label: 'LLM Model',
    type: 'select',
    required: false,
    options: [], // Dynamic options based on provider
    description: 'Specific LLM model for code generation'
  }
];

export function ConfigEditor({ config, onSave, onClose }: ConfigEditorProps) {
  const backendMode = useStore((state) => state.backendMode);
  const [editedConfig, setEditedConfig] = useState<ProjectConfig>(config);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const { showSuccess, showError, AlertModal } = useAlertModal();
  
  // GitHub PAT state (separate from config)
  const [githubPAT, setGithubPAT] = useState('');
  const [githubPATConfigured, setGithubPATConfigured] = useState(false);
  const [isCheckingPAT, setIsCheckingPAT] = useState(true);
  const [isSavingPAT, setIsSavingPAT] = useState(false);
  
  // Figma OAuth state (separate from config)
  const [figmaConfigured, setFigmaConfigured] = useState(false);
  const [figmaUserEmail, setFigmaUserEmail] = useState<string | undefined>();
  const [figmaUserId, setFigmaUserId] = useState<string | undefined>();
  const [figmaConnectedAt, setFigmaConnectedAt] = useState<string | undefined>();
  const [isCheckingFigma, setIsCheckingFigma] = useState(true);
  const [isDisconnectingFigma, setIsDisconnectingFigma] = useState(false);

  // ✅ Cloud 모드일 때 repoType을 'cloud'로 강제 설정
  useEffect(() => {
    if (backendMode === 'cloud' && config.repoType !== 'cloud') {
      const cloudConfig = {
        ...config,
        repoType: 'cloud' as const,
        localPath: undefined  // localPath 제거
      };
      setEditedConfig(cloudConfig);
    } else {
      setEditedConfig(config);
    }
    setHasChanges(false);
  }, [config, backendMode]);

  // Check for changes whenever editedConfig updates
  useEffect(() => {
    const configChanged = JSON.stringify(editedConfig) !== JSON.stringify(config);
    setHasChanges(configChanged);
  }, [editedConfig, config]);

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
  
  // Load Figma config status on mount (페이지 새로고침 시)
  useEffect(() => {
    async function loadFigmaConfigStatus() {
      console.log('[ConfigEditor] Loading initial Figma config status...');
      setIsCheckingFigma(true);
      try {
        const status = await checkFigmaConfigStatus();
        console.log('[ConfigEditor] Initial Figma status:', status);
        
        setFigmaConfigured(status.configured);
        setFigmaUserEmail(status.email);
        setFigmaUserId(status.userId);
        setFigmaConnectedAt(status.updatedAt);
        
        if (status.configured) {
          console.log('[ConfigEditor] Figma is already connected:', status.email);
        } else {
          console.log('[ConfigEditor] Figma is not connected');
        }
      } catch (error) {
        console.error('[ConfigEditor] Failed to check Figma config status:', error);
      } finally {
        setIsCheckingFigma(false);
      }
    }
    loadFigmaConfigStatus();
  }, []);
  
  // Listen for OAuth completion via postMessage (NO POLLING!)
  useEffect(() => {
    const reloadFigmaStatus = async () => {
      try {
        console.log('[ConfigEditor] Reloading Figma status...');
        const status = await checkFigmaConfigStatus();
        console.log('[ConfigEditor] Figma status:', status);
        
        setFigmaConfigured(status.configured);
        setFigmaUserEmail(status.email);
        setFigmaUserId(status.userId);
        setFigmaConnectedAt(status.updatedAt);
        
        if (status.configured) {
          showSuccess(`Figma connected as ${status.email}!`);
        }
      } catch (error) {
        console.error('[ConfigEditor] Failed to reload Figma status:', error);
      }
    };
    
    // Handle postMessage from OAuth popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'figma-oauth-success') {
        console.log('[ConfigEditor] ✅ Received OAuth success message:', event.data);
        // Wait a bit for backend to save, then reload once
        setTimeout(() => reloadFigmaStatus(), 500);
      }
    };
    
    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const handleChange = (key: keyof ProjectConfig, value: any) => {
    setEditedConfig(prev => {
      const newConfig = {
        ...prev,
        [key]: value
      };
      
      // ✅ Provider 변경 시 model 초기화
      if (key === 'llmProvider' && value !== prev.llmProvider) {
        newConfig.llmModel = undefined;
      }
      
      return newConfig;
    });
    
    // Clear error for this field
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    CONFIG_SCHEMA.forEach(field => {
      if (field.required && !editedConfig[field.key]) {
        newErrors[field.key] = `${field.label} is required`;
      }
    });
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      return;
    }
    
    setIsSaving(true);
    try {
      const result = await onSave(editedConfig);
      if (result.success) {
        showSuccess('Configuration saved successfully!');
      } else {
        showError(result.error || 'Failed to save configuration. Please try again.');
      }
    } catch (error) {
      showError('Failed to save configuration. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // GitHub PAT handlers
  const handleGitHubPATSave = async () => {
    if (!githubPAT || !githubPAT.trim()) {
      showError('Please enter a valid PAT');
      return;
    }
    
    setIsSavingPAT(true);
    try {
      const result = await saveGitHubPAT(githubPAT.trim());
      if (result.success) {
        showSuccess(`GitHub PAT saved successfully!${result.username ? ` (${result.username})` : ''}`);
        setGithubPATConfigured(true);
        setGithubPAT(''); // Clear input after save
      } else {
        showError(result.error || 'Failed to save PAT');
      }
    } catch (error) {
      showError('Failed to save PAT. Please try again.');
    } finally {
      setIsSavingPAT(false);
    }
  };

  const handleGitHubPATDelete = async () => {
    if (!confirm('Are you sure you want to delete your GitHub PAT?')) {
      return;
    }
    
    setIsSavingPAT(true);
    try {
      const result = await deleteGitHubPAT();
      if (result.success) {
        showSuccess('GitHub PAT deleted successfully');
        setGithubPATConfigured(false);
        setGithubPAT('');
      } else {
        showError(result.error || 'Failed to delete PAT');
      }
    } catch (error) {
      showError('Failed to delete PAT. Please try again.');
    } finally {
      setIsSavingPAT(false);
    }
  };
  
  // Figma OAuth handlers
  const handleFigmaConnect = () => {
    console.log('[ConfigEditor] Starting Figma OAuth...');
    startFigmaOAuth();
    // Note: OAuth window will open automatically
  };
  
  const handleFigmaDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Figma account?')) {
      return;
    }
    
    setIsDisconnectingFigma(true);
    try {
      const result = await disconnectFigma();
      if (result.success) {
        showSuccess('Figma disconnected successfully');
        setFigmaConfigured(false);
        setFigmaUserEmail(undefined);
        setFigmaUserId(undefined);
        setFigmaConnectedAt(undefined);
      } else {
        showError(result.error || 'Failed to disconnect Figma');
      }
    } catch (error) {
      showError('Failed to disconnect Figma. Please try again.');
    } finally {
      setIsDisconnectingFigma(false);
    }
  };

  const renderField = (field: ConfigField) => {
    const value = editedConfig[field.key];
    const hasError = !!errors[field.key];
    
    // ✅ Cloud 모드에서 localPath 필드 숨김
    if (backendMode === 'cloud' && field.key === 'localPath') {
      return null;
    }
    
    // ✅ Cloud 모드에서 repoType 비활성화 (cloud로 고정)
    const isRepoTypeDisabled = backendMode === 'cloud' && field.key === 'repoType';

    return (
      <div key={field.key} className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {field.label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {!field.required && (
            <span className="text-xs text-gray-400 dark:text-gray-500">Optional</span>
          )}
        </div>
        
        {field.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {field.description}
            {isRepoTypeDisabled && ' (Fixed in Cloud Mode)'}
            {field.key === 'llmModel' && !editedConfig.llmProvider && ' (Select provider first)'}
          </p>
        )}
        
        {field.type === 'text' && (
          <input
            type="text"
            value={value as string || ''}
            onChange={(e) => handleChange(field.key, e.target.value)}
            className={`w-full px-3 py-2 border rounded-md text-sm 
              bg-white dark:bg-gray-800 
              text-gray-900 dark:text-white
              ${
                hasError 
                  ? 'border-red-500 dark:border-red-400' 
                  : 'border-gray-300 dark:border-gray-600'
              } 
              focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
              placeholder:text-gray-400 dark:placeholder:text-gray-500`}
            placeholder={
              field.key === 'localPath' 
                ? '~/dev/my-repo or ../my-repo or /absolute/path' 
                : field.label
            }
          />
        )}
        
        {field.type === 'select' && (
          <select
            value={value as string || ''}
            onChange={(e) => handleChange(field.key, e.target.value || undefined)}
            disabled={isRepoTypeDisabled || (field.key === 'llmModel' && !editedConfig.llmProvider)}
            className={`w-full px-3 py-2 border rounded-md text-sm 
              bg-white dark:bg-gray-800 
              text-gray-900 dark:text-white
              ${
                hasError 
                  ? 'border-red-500 dark:border-red-400' 
                  : 'border-gray-300 dark:border-gray-600'
              } 
              ${isRepoTypeDisabled || (field.key === 'llmModel' && !editedConfig.llmProvider) ? 'opacity-50 cursor-not-allowed' : ''}
              focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400`}
          >
            {!isRepoTypeDisabled && <option value="">-- Select --</option>}
            {/* ✅ Dynamic model options based on provider */}
            {field.key === 'llmModel' && editedConfig.llmProvider ? (
              LLM_MODELS[editedConfig.llmProvider]?.map(model => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))
            ) : (
              field.options?.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))
            )}
          </select>
        )}
        
        {field.type === 'boolean' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value as boolean || false}
              onChange={(e) => handleChange(field.key, e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-700"
            />
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Enabled
            </span>
          </label>
        )}
        
        {hasError && (
          <p className="text-xs text-red-500">{errors[field.key]}</p>
        )}
      </div>
    );
  };

  const renderGitHubSection = () => {
    return (
      <div className="space-y-4 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">GitHub Integration</h4>
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
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            🔐 User-level setting • Shared across all projects
          </p>
        </div>
        
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              Personal Access Token
            </label>
            {githubPATConfigured ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value="ghp_************************************"
                  disabled
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm"
                />
                <button
                  onClick={handleGitHubPATDelete}
                  disabled={isSavingPAT}
                  className="px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded-md hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                >
                  {isSavingPAT ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            ) : (
              <>
                <input
                  type="password"
                  value={githubPAT}
                  onChange={(e) => setGithubPAT(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  disabled={isSavingPAT}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                />
                <button
                  onClick={handleGitHubPATSave}
                  disabled={!githubPAT.trim() || isSavingPAT}
                  className="mt-2 w-full px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-md hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                >
                  {isSavingPAT ? 'Saving...' : 'Save PAT'}
                </button>
              </>
            )}
          </div>
          
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p>• Create a PAT at: <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">github.com/settings/tokens</a></p>
            <p>• Required scopes: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">repo</code></p>
            <p>• PAT is stored encrypted in <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">.ant/credentials.json</code></p>
          </div>
        </div>
      </div>
    );
  };
  
  const renderFigmaSection = () => {
    return (
      <div className="space-y-4 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Figma Integration</h4>
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
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            🔐 User-level setting • OAuth authentication to access your Figma files
          </p>
        </div>
        
        <div className="space-y-3">
          {figmaConfigured ? (
            <>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
                  Connected Account
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={figmaUserEmail || 'Connected'}
                    disabled
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm"
                  />
                  <button
                    onClick={handleFigmaDisconnect}
                    disabled={isDisconnectingFigma}
                    className="px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded-md hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    {isDisconnectingFigma ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </div>
              </div>
              
              {/* Connection Details */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3 space-y-2">
                {figmaUserId && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400">User ID:</span>
                    <span className="text-gray-900 dark:text-gray-100 font-mono">{figmaUserId}</span>
                  </div>
                )}
                {figmaConnectedAt && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400">Connected:</span>
                    <span className="text-gray-900 dark:text-gray-100">
                      {new Date(figmaConnectedAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <button
                onClick={handleFigmaConnect}
                className="w-full px-4 py-3 bg-blue-600 dark:bg-blue-700 text-white rounded-md hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm font-medium"
              >
                Connect with Figma
              </button>
            </>
          )}
          
          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p>• OAuth 2.0 authentication with your Figma account</p>
            <p>• Access only to files you have permission to view</p>
            <p>• Credentials stored encrypted in <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">.ant/credentials.json</code></p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full overflow-hidden flex flex-col bg-white dark:bg-gray-800">
      <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
            <span>⚙️</span>
            <span>Configuration</span>
          </h3>
          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className={`transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xl ${
                hasChanges && !isSaving
                  ? 'text-green-600 hover:text-green-700'
                  : 'text-gray-400'
              }`}
              title={
                isSaving
                  ? 'Saving...'
                  : !hasChanges
                  ? 'No changes to save'
                  : 'Save Changes'
              }
            >
              ✓
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors text-xl"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {CONFIG_SCHEMA.map(field => renderField(field))}
          
          {/* GitHub Integration Section */}
          {renderGitHubSection()}
          
          {/* Figma MCP Integration Section */}
          {renderFigmaSection()}
        </div>
      </div>
      
      {/* Alert Modal */}
      <AlertModal />
    </div>
  );
}
