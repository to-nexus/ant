import { useState, useEffect } from 'react';
import { Folder, ExternalLink, ChevronDown } from 'lucide-react';
import { useStore } from '@/domain/store';
import { 
  createProject, 
  deleteProject, 
  fetchProjectConfig, 
  createProjectConfig, 
  ProjectConfig,
  openLocalIDE,
  checkIDEInstalled
} from '@/infrastructure/http/api';
import { getProjectPath } from '@/shared/utils/workspace-path';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { Button } from '@/presentation/components/common/button';

export function ProjectSection() {
  const { 
    projects, 
    selectedProject, 
    setSelectedProject, 
    fetchProjects, 
    setShowConfigEditor, 
    setEditorMode, 
    setIdeWorkspacePath, 
    backendMode,
    userEmail,
    userOrganization
  } = useStore();
  const [configExists, setConfigExists] = useState<boolean | null>(null);
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [selectedIDE, setSelectedIDE] = useState<'cursor' | 'vscode'>('cursor');
  const [showIDEMenu, setShowIDEMenu] = useState(false);
  const [ideStatus, setIdeStatus] = useState<{ cursor: boolean; vscode: boolean }>({ cursor: false, vscode: false });
  const policy = useUIActionPolicy();
  
  // Check IDE installation status (Local mode only)
  useEffect(() => {
    if (backendMode === 'local') {
      Promise.all([
        checkIDEInstalled('cursor'),
        checkIDEInstalled('vscode')
      ]).then(([cursorResult, vscodeResult]) => {
        setIdeStatus({
          cursor: cursorResult.installed,
          vscode: vscodeResult.installed
        });
        // Select first available IDE
        if (cursorResult.installed) {
          setSelectedIDE('cursor');
        } else if (vscodeResult.installed) {
          setSelectedIDE('vscode');
        }
      });
    }
  }, [backendMode]);

  // Check if config exists when project is selected
  useEffect(() => {
    async function checkConfig() {
      if (!selectedProject) {
        setConfigExists(null);
        setConfig(null);
        return;
      }

      try {
        const projectConfig = await fetchProjectConfig(selectedProject);
        console.log('[ProjectSection] Config check result:', { selectedProject, exists: projectConfig !== null, config: projectConfig });
        setConfigExists(projectConfig !== null);
        setConfig(projectConfig);
      } catch (error) {
        console.error('[ProjectSection] Failed to check config:', error);
        // On error (network issue, etc.), assume config doesn't exist
        // This will show the yellow badge, allowing user to create config
        setConfigExists(false);
        setConfig(null);
      }
    }

    checkConfig();
  }, [selectedProject]);

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
        alert('Failed to create configuration. Please try again.');
        return;
      }
    }

    setShowConfigEditor(true);
  };

  // Open Local IDE (Cursor/VS Code) - Local Backend only
  const handleOpenLocalIDE = async () => {
    if (!config?.localPath) {
      alert('Local path is not configured for this workspace.');
      return;
    }

    if (!ideStatus.cursor && !ideStatus.vscode) {
      alert('No IDE found. Please install Cursor or VS Code.');
      return;
    }

    try {
      const result = await openLocalIDE(selectedIDE, config.localPath);
      console.log('[ProjectSection] Opened local IDE:', result);
    } catch (error: any) {
      alert(`Failed to open ${selectedIDE}: ${error.message}`);
    }
  };

  // Open Web IDE (iframe) - Cloud Backend or Local UI
  const handleOpenWebIDE = async () => {
    // ✅ Cloud Mode: Use project path from server workspace
    // ✅ Local Mode: Use localPath from config
    let workspacePath: string;
    
    if (config?.repoType === 'cloud') {
      // Cloud Mode: Project path is managed by server
      // Use centralized path utility
      if (!selectedProject) {
        alert('Project not selected.');
        return;
      }
      
      // ✅ Use centralized path utility
      const projectPath = getProjectPath(selectedProject);
      
      // Build Docker path
      // Assuming ant is at ~/dev/ant and Docker mounts $HOME as /workspace
      workspacePath = `/workspace/dev/ant/${projectPath}`;
      
      console.log('[ProjectSection] Cloud Mode - Using server workspace path:', {
        selectedProject,
        projectPath,
        workspacePath
      });
    } else {
      // Local Mode: Use localPath from config
      if (!config?.localPath) {
        alert('Local path is not configured for this workspace.');
        return;
      }

      // Check if IDE is accessible (localhost only)
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!isLocalhost) {
        const confirmed = window.confirm(
          'Web IDE 기능은 localhost 접속 시에만 사용 가능합니다.\n\n' +
          '현재 원격 UI에서 로컬 백엔드에 접속 중이므로 Web IDE가 정상 작동하지 않을 수 있습니다.\n\n' +
          '권장사항: 로컬에서 ant-ui를 실행하거나 (pnpm dev:ui) 실제 IDE를 사용하세요.\n\n' +
          '그래도 계속하시겠습니까?'
        );
        if (!confirmed) return;
      }

      // Convert ~/path to /workspace/path (Docker mount: $HOME:/workspace)
      workspacePath = config.localPath.startsWith('~/')
        ? config.localPath.replace('~', '/workspace')
        : config.localPath.startsWith('~')
        ? config.localPath.replace('~', '/workspace')
        : `/workspace${config.localPath}`;
      
      console.log('[ProjectSection] Local Mode - Converting path:', {
        localPath: config.localPath,
        workspacePath,
        isLocalhost
      });
    }
    
    // Set IDE workspace path
    setIdeWorkspacePath(workspacePath);
    
    // Switch to Editor mode
    setEditorMode('editor');
  };

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
      
      {/* Open IDE Section */}
      {selectedProject && (
        <div className="mt-2">
          {backendMode === 'local' ? (
            // Local Backend: Show IDE selector (Cursor/VS Code)
            <div className="relative">
              <div className="flex gap-2">
                {/* IDE Selector Button */}
                <Button
                  onClick={() => setShowIDEMenu(!showIDEMenu)}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2 px-3"
                  disabled={!configExists || !config?.localPath || (!ideStatus.cursor && !ideStatus.vscode)}
                >
                  <span className="text-xs">
                    {selectedIDE === 'cursor' ? '🔷 Cursor' : '💙 VS Code'}
                  </span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
                
                {/* Open Button */}
                <Button
                  onClick={handleOpenLocalIDE}
                  variant="outline"
                  size="sm"
                  className="flex-1 flex items-center justify-center gap-2"
                  disabled={!configExists || !config?.localPath || (!ideStatus.cursor && !ideStatus.vscode)}
                  title={
                    !configExists 
                      ? 'Configuration required' 
                      : !config?.localPath
                      ? 'Local path not configured'
                      : (!ideStatus.cursor && !ideStatus.vscode)
                      ? 'No IDE found'
                      : `Open in ${selectedIDE === 'cursor' ? 'Cursor' : 'VS Code'}`
                  }
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in IDE
                </Button>
              </div>
              
              {/* IDE Selection Dropdown */}
              {showIDEMenu && (
                <div className="absolute top-full left-0 mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999]">
                  <button
                    onClick={() => { setSelectedIDE('cursor'); setShowIDEMenu(false); }}
                    disabled={!ideStatus.cursor}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${
                      !ideStatus.cursor ? 'opacity-50 cursor-not-allowed' : ''
                    } ${selectedIDE === 'cursor' ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                  >
                    <span>🔷</span>
                    <span>Cursor</span>
                    {!ideStatus.cursor && <span className="ml-auto text-xs text-gray-400">(Not installed)</span>}
                  </button>
                  <button
                    onClick={() => { setSelectedIDE('vscode'); setShowIDEMenu(false); }}
                    disabled={!ideStatus.vscode}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${
                      !ideStatus.vscode ? 'opacity-50 cursor-not-allowed' : ''
                    } ${selectedIDE === 'vscode' ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                  >
                    <span>💙</span>
                    <span>VS Code</span>
                    {!ideStatus.vscode && <span className="ml-auto text-xs text-gray-400">(Not installed)</span>}
                  </button>
                </div>
              )}
            </div>
          ) : (
            // Cloud Backend: Show Web IDE button
            <Button
              onClick={handleOpenWebIDE}
              variant="outline"
              size="sm"
              className="w-full flex items-center justify-center gap-2"
              disabled={!configExists}
              title={
                !configExists 
                  ? 'Configuration required' 
                  : 'Open workspace in Web IDE'
              }
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in IDE
            </Button>
          )}
          
          {/* IDE Button Warning Messages */}
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
          
          {backendMode === 'local' && configExists && config?.localPath && !ideStatus.cursor && !ideStatus.vscode && (
            <div className="mt-2 p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
              <div className="flex items-start gap-1.5">
                <span className="text-orange-600 dark:text-orange-400 text-xs flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-orange-700 dark:text-orange-300">
                    No IDE found. Please install <a href="https://cursor.sh" target="_blank" rel="noopener noreferrer" className="underline">Cursor</a> or <a href="https://code.visualstudio.com" target="_blank" rel="noopener noreferrer" className="underline">VS Code</a>.
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
