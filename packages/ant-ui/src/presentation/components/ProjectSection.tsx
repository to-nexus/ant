import { useState, useEffect, useRef } from 'react';
import { Folder, Github, ChevronDown, Download, Plus, Upload, Download as DownloadIcon, RefreshCw } from 'lucide-react';
import { useStore } from '@/domain/store';
import { 
  createProject, 
  deleteProject, 
  fetchProjectConfig, 
  createProjectConfig, 
  ProjectConfig,
  cloneGitHubRepo,
  initializeGitHubRepo,
  pushToGitHub,
  pullFromGitHub,
  fetchFromGitHub,
  getGitStatus
} from '@/infrastructure/http/api';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';
import { GitStatusButtons } from './GitStatusButtons';
import { Button } from '@/presentation/components/common/button';

export function ProjectSection() {
  const { 
    projects, 
    selectedProject, 
    setSelectedProject, 
    fetchProjects, 
    showConfigEditor,
    setShowConfigEditor,
    currentGitBranch,  // ✅ Current Git branch from store
    setManualGitAction  // ✅ Manual Git action setter
  } = useStore();
  const [configExists, setConfigExists] = useState<boolean | null>(null);
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [showGitMenu, setShowGitMenu] = useState(false);
  const [isGitProcessing, setIsGitProcessing] = useState(false);
  const [gitStatus, setGitStatus] = useState<{
    hasGit: boolean;
    hasCodebase: boolean;
    hasFeatures: boolean;
    currentBranch?: string;
  }>({ hasGit: false, hasCodebase: false, hasFeatures: false });
  const gitMenuRef = useRef<HTMLDivElement>(null);
  const policy = useUIActionPolicy();
  const { showError, showSuccess, AlertModal } = useAlertModal();
  
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
  
  // Fetch Git status when project/feature changes
  useEffect(() => {
    const fetchGitStatus = async () => {
      if (!selectedProject) {
        setGitStatus({ hasGit: false, hasCodebase: false, hasFeatures: false });
        return;
      }
      
      try {
        const status = await getGitStatus(selectedProject);
        setGitStatus(status);
      } catch (error) {
        console.error('Failed to fetch Git status:', error);
        setGitStatus({ hasGit: false, hasCodebase: false, hasFeatures: false });
      }
    };
    
    fetchGitStatus();
  }, [selectedProject]);

  // Check if config exists when project is selected or config editor closes
  useEffect(() => {
    async function checkConfig() {
      if (!selectedProject) {
        setConfigExists(null);
        setConfig(null);
        return;
      }

      try {
        const projectConfig = await fetchProjectConfig(selectedProject);
        const configChanged = JSON.stringify(config) !== JSON.stringify(projectConfig);
        
        if (configChanged && !showConfigEditor) {
          console.log('[ProjectSection] 🎉 Config updated! Refreshing Git status...', projectConfig);
        }
        
        setConfigExists(projectConfig !== null);
        setConfig(projectConfig);
      } catch (error) {
        console.error('[ProjectSection] Failed to check config:', error);
        setConfigExists(false);
        setConfig(null);
      }
    }

    checkConfig();
  }, [selectedProject, showConfigEditor]);

  const handleCreateProject = async (projectName: string) => {
    await createProject(projectName);
  };

  const handleDeleteProject = async (projectName: string) => {
    await deleteProject(projectName);
  };

  const handleConfigClick = async () => {
    if (!selectedProject) return;

    // If config doesn't exist, create it first
    if (configExists === false) {
      try {
        await createProjectConfig(selectedProject);
        setConfigExists(true);
        // Wait a moment for the backend to write the file
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Failed to create config:', error);
        showError('Failed to create configuration. Please try again.');
        return;
      }
    }

    setShowConfigEditor(true);
  };

  // Git handlers
  const handleGitAction = async (
    action: () => Promise<any>, 
    actionType: 'fetch' | 'push' | 'pull' | 'clone' | 'init',
    shouldRefreshGitStatus = true
  ) => {
    if (!selectedProject) return;
    
    setShowGitMenu(false);
    setIsGitProcessing(true);
    
    // ✅ For fetch/push/pull, use GitStatusButtons to show status
    if (actionType === 'fetch' || actionType === 'push' || actionType === 'pull') {
      setManualGitAction(actionType);
    }
    
    try {
      const result = await action();
      if (result.success) {
        // ✅ For fetch/push/pull, status shown via GitStatusButtons (no popup)
        // For clone/init, still show success popup (one-time operations)
        if (actionType === 'clone' || actionType === 'init') {
          showSuccess(`${actionType === 'clone' ? 'Repository cloned' : 'Repository initialized'} successfully`);
        }
        
        // Refresh Git status after successful operation
        if (shouldRefreshGitStatus) {
          const status = await getGitStatus(selectedProject);
          setGitStatus(status);
        }
      } else {
        // ✅ Errors still shown via popup (important to see)
        showError(result.error || `Failed to ${actionType}`);
      }
    } catch (error: any) {
      showError(error.message || `Failed to ${actionType}`);
    } finally {
      setIsGitProcessing(false);
      
      // ✅ Clear manual action status after a short delay
      if (actionType === 'fetch' || actionType === 'push' || actionType === 'pull') {
        setTimeout(() => {
          setManualGitAction(null);
        }, 500);
      }
    }
  };

  const handleClone = () => handleGitAction(
    () => cloneGitHubRepo(selectedProject!),
    'clone',
    true  // Refresh Git status after clone
  );

  const handleInitialize = () => handleGitAction(
    () => initializeGitHubRepo(selectedProject!),
    'init',
    true  // Refresh Git status after init
  );

  const handlePush = () => handleGitAction(
    () => pushToGitHub(selectedProject!),
    'push',
    false // Don't refresh Git status (hasGit won't change)
  );

  const handlePull = () => handleGitAction(
    () => pullFromGitHub(selectedProject!),
    'pull',
    false // Don't refresh Git status (hasGit won't change)
  );

  const handleFetch = () => handleGitAction(
    () => fetchFromGitHub(selectedProject!),
    'fetch',
    false // Don't refresh Git status (hasGit won't change)
  );

  const projectItems = projects.map((p: string) => ({ name: p }));

  return (
    <div>
      <ItemDropdown
        title="Workspace"
        icon={Folder}
        items={projectItems}
        selectedItem={selectedProject}
        onSelect={setSelectedProject}
        onCreate={handleCreateProject}
        onDelete={handleDeleteProject}
        onItemCreated={fetchProjects}
        placeholder="Select a workspace..."
        inputPlaceholder="Workspace name..."
        onSettingsClick={handleConfigClick}
        disabled={!policy.canChangeProject}
        disabledReason={policy.disabledReason || undefined}
      />
      
      {/* Git Status Section */}
      {selectedProject && (
        <div className="mt-2 space-y-1">
          <div className="flex gap-2 items-center">
            {/* Git Status Buttons (Commit/Push/Pull/Sync) - Takes most space */}
            <div className="flex-1 min-w-0">
              <GitStatusButtons />
            </div>
            
            {/* Git Management Button - Compact */}
            <div className="relative" ref={gitMenuRef}>
              <Button
                onClick={() => setShowGitMenu(!showGitMenu)}
                variant="outline"
                size="sm"
                className="px-2.5 py-1.5"
                disabled={!config?.githubRepo || isGitProcessing}
                title={!config?.githubRepo ? 'Configure GitHub repo first' : 'Git management'}
              >
                <Github className="w-4 h-4" />
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
              
              {/* Git Menu Dropdown */}
              {showGitMenu && (
                <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999]">
                  {!gitStatus.hasGit && !gitStatus.hasFeatures ? (
                    // Case 1: No Git, No Features → Show Clone/Initialize
                    <>
                      <button
                        onClick={handleClone}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Download className="w-4 h-4" />
                        <div>
                          <div className="font-medium">Clone</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Pull existing repo</div>
                        </div>
                      </button>
                      <button
                        onClick={handleInitialize}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Plus className="w-4 h-4" />
                        <div>
                          <div className="font-medium">Initialize</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Create new repo & push</div>
                        </div>
                      </button>
                    </>
                  ) : !gitStatus.hasGit && gitStatus.hasFeatures ? (
                    // Case 2: No Git, Has Features → Show warning
                    <div className="px-3 py-4 text-center">
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Features exist
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        Delete features first to clone/initialize
                      </div>
                    </div>
                  ) : (
                    // Case 3: Has Git → Show Push/Pull/Fetch
                    <>
                      <button
                        onClick={handlePush}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Upload className="w-4 h-4" />
                        <div>
                          <div className="font-medium">Push</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Upload changes</div>
                        </div>
                      </button>
                      <button
                        onClick={handlePull}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <DownloadIcon className="w-4 h-4" />
                        <div>
                          <div className="font-medium">Pull</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Download changes</div>
                        </div>
                      </button>
                      <button
                        onClick={handleFetch}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <div>
                          <div className="font-medium">Fetch</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Update remote refs</div>
                        </div>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Current Branch Display */}
          {(currentGitBranch || gitStatus.currentBranch) && (
            <div className="px-2 text-[11px] text-gray-500 dark:text-gray-400">
              Current branch: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{currentGitBranch || gitStatus.currentBranch}</span>
            </div>
          )}
          
          {/* Warning Messages */}
          {!configExists && (
            <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
              <div className="flex items-start gap-1.5">
                <span className="text-orange-600 dark:text-orange-400 text-xs flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    Configuration required. Click the settings icon above to create one.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* ✅ Only show localPath warning for local/github repo types, not cloud */}
          {configExists && !config?.localPath && config?.repoType !== 'cloud' && (
            <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
              <div className="flex items-start gap-1.5">
                <span className="text-orange-600 dark:text-orange-400 text-xs flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    Local path not configured. Click the settings icon to set it.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Alert Modal */}
      <AlertModal />
    </div>
  );
}
