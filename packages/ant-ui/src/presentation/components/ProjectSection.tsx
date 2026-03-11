import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  publishToGitHub,
  pushToGitHub,
  pullFromGitHub
} from '@/infrastructure/http/api';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { GitStatusButtons } from './GitStatusButtons';
import { Button } from '@/presentation/components/common/button';
import { Tooltip } from '@/presentation/components/common/Tooltip';

export function ProjectSection() {
  const { t } = useTranslation('explorer');
  const { 
    projects, 
    selectedProject, 
    selectedFeature,
    setSelectedProject, 
    fetchProjects, 
    openMainPanelTab,
    gitStatus,  // ✅ Use unified Git status from store
    fetchGitStatus,  // ✅ Fetch Git status action
    setGitStatusPhase,  // ✅ Git status phase setter
    gitStatusRefreshTrigger,  // ✅ Git status refresh trigger
    backendMode
  } = useStore();
  const [configExists, setConfigExists] = useState<boolean | null>(null);
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [showGitMenu, setShowGitMenu] = useState(false);
  const [isGitProcessing, setIsGitProcessing] = useState(false);
  const gitMenuRef = useRef<HTMLDivElement>(null);
  const policy = useUIActionPolicy();
  const { showError, showSuccess } = useAlertModalContext();
  
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
  
  // ✅ Fetch Git status when project or feature changes
  useEffect(() => {
    if (selectedProject) {
      fetchGitStatus(selectedProject, selectedFeature || undefined);
    }
  }, [selectedProject, selectedFeature]);

  // ✅ Refresh Git status when trigger changes
  useEffect(() => {
    if (gitStatusRefreshTrigger > 0 && selectedProject) {
      fetchGitStatus(selectedProject, selectedFeature || undefined);
    }
  }, [gitStatusRefreshTrigger, selectedProject, selectedFeature]);

  // Check if config exists when project is selected or config editor closes or git status refresh
  useEffect(() => {
    async function checkConfig() {
      if (!selectedProject) {
        setConfigExists(null);
        setConfig(null);
        return;
      }

      try {
        const projectConfig = await fetchProjectConfig(selectedProject);
        setConfigExists(projectConfig !== null);
        setConfig(projectConfig);
      } catch (error) {
        console.error('[ProjectSection] Failed to check config:', error);
        setConfigExists(false);
        setConfig(null);
      }
    }

    checkConfig();
  }, [selectedProject, gitStatusRefreshTrigger]); // ✅ Also refresh config when gitStatusRefreshTrigger changes

  const handleCreateProject = async (projectName: string) => {
    await createProject(projectName);
    // ✅ Auto-switch to the newly created project
    setSelectedProject(projectName);
  };

  const handleDeleteProject = async (projectName: string) => {
    await deleteProject(projectName);
    
    console.log(`[ProjectSection] ✅ Project deleted: ${projectName}`);
  };

  const handleConfigClick = async () => {
    if (!selectedProject) return;

    // If config doesn't exist, create it first
    if (configExists === false) {
      try {
        await createProjectConfig(selectedProject, backendMode);
        setConfigExists(true);
        // Wait a moment for the backend to write the file
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Failed to create config:', error);
        showError(t('workspace.createFailed'));
        return;
      }
    }

    openMainPanelTab('projectConfig');
  };

  // Git handlers
  const handleGitAction = async (
    action: () => Promise<any>, 
    actionType: 'fetch' | 'push' | 'pull' | 'clone' | 'init' | 'publish',
    shouldRefreshGitStatus = true
  ) => {
    if (!selectedProject) return;
    
    setShowGitMenu(false);
    setIsGitProcessing(true);
    
    // ✅ Set Git operation phase
    const phaseMap = {
      'fetch': 'fetching',
      'push': 'pushing',
      'pull': 'pulling',
      'clone': 'cloning',
      'init': 'initializing',
      'publish': 'publishing'
    } as const;
    
    setGitStatusPhase(phaseMap[actionType]);
    
    try {
      const result = await action();
      if (result.success) {
        // ✅ For clone/init/publish, show success popup (one-time operations)
        if (actionType === 'clone' || actionType === 'init' || actionType === 'publish') {
          const successMessages = {
            'clone': t('git.repoCloned'),
            'init': t('git.repoInitialized'),
            'publish': t('git.repoPublished')
          } as const;
          showSuccess(successMessages[actionType]);
        }
        
        // Refresh Git status after successful operation
        if (shouldRefreshGitStatus && selectedProject) {
          await fetchGitStatus(selectedProject, selectedFeature || undefined);
          useStore.getState().refreshGitStatus();
        }
      } else {
        // ✅ Errors still shown via popup (important to see)
        showError(result.error || t('git.actionFailed', { action: actionType }));
      }
    } catch (error: any) {
      showError(error.message || t('git.actionFailed', { action: actionType }));
    } finally {
      setIsGitProcessing(false);
      setGitStatusPhase(null);
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

  const handlePublish = () => handleGitAction(
    () => publishToGitHub(selectedProject!, selectedFeature || undefined),
    'publish',
    true  // Refresh Git status after publish
  );

  const handlePush = () => handleGitAction(
    () => pushToGitHub(selectedProject!, selectedFeature || undefined),
    'push',
    false // Don't refresh Git status (hasGit won't change)
  );

  const handlePull = () => handleGitAction(
    () => pullFromGitHub(selectedProject!, selectedFeature || undefined),
    'pull',
    false // Don't refresh Git status (hasGit won't change)
  );

  const handleFetch = async () => {
    if (!selectedProject) return;
    
    setShowGitMenu(false);
    
    // ✅ Set bypass flag and trigger both useGitChanges and useFeatureBranchManager
    useStore.setState((state) => ({ 
      bypassFetchTimer: true, // ← useFeatureBranchManager will fetch from GitHub
      gitStatusRefreshTrigger: state.gitStatusRefreshTrigger + 1 // ← useGitChanges will update status
    }));
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
        onDelete={handleDeleteProject}
        onItemCreated={fetchProjects}
        placeholder={t('workspace.placeholder')}
        inputPlaceholder={t('workspace.inputPlaceholder')}
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
              {!config?.githubRepo ? (
                // ✅ Disabled state: Show tooltip on click
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
                    className="px-2.5 py-1.5 opacity-50 cursor-pointer"
                  >
                    <Github className="w-4 h-4" />
                    <ChevronDown className="w-3 h-3 ml-1" />
                  </Button>
                </Tooltip>
              ) : (
                // ✅ Enabled state: Normal button with menu
                <Button
                  onClick={() => setShowGitMenu(!showGitMenu)}
                  variant="outline"
                  size="sm"
                  className="px-2.5 py-1.5"
                  disabled={isGitProcessing}
                  title={t('config:git.management')}
                >
                  <Github className="w-4 h-4" />
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              )}
              
              {/* Git Menu Dropdown */}
              {showGitMenu && (
                <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999]">
                  {!gitStatus?.hasGit && !gitStatus?.hasFeatures ? (
                    // Case 1: No Git, No Features → Show Clone/Initialize
                    <>
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
                    </>
                  ) : !gitStatus?.hasGit && gitStatus?.hasFeatures ? (
                    // Case 2: No Git, Has Features → Show Publish + Clone options
                    <>
                      <button
                        onClick={handlePublish}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Upload className="w-4 h-4" />
                        <div>
                          <div className="font-medium">{t('config:git.publish')}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.publishDesc')}</div>
                        </div>
                      </button>
                      <button
                        onClick={handleClone}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Download className="w-4 h-4" />
                        <div>
                          <div className="font-medium">{t('config:git.clone')}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.cloneDesc')}</div>
                        </div>
                      </button>
                    </>
                  ) : (
                    // Case 3: Has Git → Show Push/Pull/Fetch
                    <>
                      <button
                        onClick={handlePush}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Upload className="w-4 h-4" />
                        <div>
                          <div className="font-medium">{t('config:git.push')}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.pushDesc')}</div>
                        </div>
                      </button>
                      <button
                        onClick={handlePull}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <DownloadIcon className="w-4 h-4" />
                        <div>
                          <div className="font-medium">{t('config:git.pull')}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.pullDesc')}</div>
                        </div>
                      </button>
                      <button
                        onClick={handleFetch}
                        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
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
              )}
            </div>
          </div>
          
          {/* Current Branch Display */}
          {gitStatus?.currentBranch && (
            <div className="px-2 text-[11px] text-gray-500 dark:text-gray-400">
              {t('config:git.currentBranch')} <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{gitStatus.currentBranch}</span>
            </div>
          )}
          
          {/* Warning Messages */}
          {!configExists && (
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
          
          {/* Only show localPath warning in local backend mode, for local/github repo types */}
          {backendMode !== 'cloud' && configExists && !config?.localPath && config?.repoType !== 'cloud' && (
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
      
      {/* Alert Modal */}
    </div>
  );
}
