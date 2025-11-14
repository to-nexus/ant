import { useState, useEffect } from 'react';
import { Folder, ExternalLink } from 'lucide-react';
import { useStore } from '@/domain/store';
import { createProject, deleteProject, fetchProjectConfig, createProjectConfig, ProjectConfig } from '@/infrastructure/http/api';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { Button } from '@/presentation/components/common/button';

export function ProjectSection() {
  const { projects, selectedProject, setSelectedProject, fetchProjects, setShowConfigEditor, setEditorMode, setIdeWorkspacePath } = useStore();
  const [configExists, setConfigExists] = useState<boolean | null>(null);
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const policy = useUIActionPolicy();

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

  const handleOpenIDE = async () => {
    if (!config?.localPath) {
      alert('Local path is not configured for this workspace.');
      return;
    }

    // Convert ~/path to /workspace/path (Docker mount: $HOME:/workspace)
    const containerPath = config.localPath.startsWith('~/')
      ? config.localPath.replace('~', '/workspace')
      : config.localPath.startsWith('~')
      ? config.localPath.replace('~', '/workspace')
      : `/workspace${config.localPath}`;
    
    console.log('[ProjectSection] Opening IDE with path:', {
      localPath: config.localPath,
      containerPath
    });
    
    // Set IDE workspace path
    setIdeWorkspacePath(containerPath);
    
    // Switch to Editor mode
    // Note: IDE theme should be set manually by user in IDE interface
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
      
      {/* Open IDE Button */}
      {selectedProject && (
        <div className="mt-2">
          <Button
            onClick={handleOpenIDE}
            variant="outline"
            size="sm"
            className="w-full flex items-center justify-center gap-2"
            disabled={!configExists || !config?.localPath}
            title={
              !configExists 
                ? 'Configuration required' 
                : !config?.localPath 
                ? 'Local path not configured' 
                : 'Open workspace in IDE'
            }
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in IDE
          </Button>
          
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
          
          {configExists && !config?.localPath && (
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
    </div>
  );
}
