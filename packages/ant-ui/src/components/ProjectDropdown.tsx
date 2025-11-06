import { useState, useEffect } from 'react';
import { Folder } from 'lucide-react';
import { useStore } from '../lib/store';
import { createProject, deleteProject, fetchProjectConfig, createProjectConfig } from '../lib/api';
import { ItemDropdown } from './ItemDropdown';

export function ProjectDropdown() {
  const { projects, selectedProject, setSelectedProject, fetchProjects, setShowConfigEditor } = useStore();
  const [configExists, setConfigExists] = useState<boolean | null>(null);

  // Check if config exists when project is selected
  useEffect(() => {
    async function checkConfig() {
      if (!selectedProject) {
        setConfigExists(null);
        return;
      }

      try {
        const config = await fetchProjectConfig(selectedProject);
        console.log('[ProjectDropdown] Config check result:', { selectedProject, exists: config !== null, config });
        setConfigExists(config !== null);
      } catch (error) {
        console.error('[ProjectDropdown] Failed to check config:', error);
        // On error (network issue, etc.), assume config doesn't exist
        // This will show the yellow badge, allowing user to create config
        setConfigExists(false);
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
      />
      
      {/* Configuration warning - inside workspace panel */}
      {selectedProject && configExists === false && (
        <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-md">
          <div className="flex items-start gap-2">
            <span className="text-orange-600 text-sm flex-shrink-0">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-orange-900 mb-1">
                Configuration Missing
              </p>
              <p className="text-xs text-orange-700 mb-2">
                This workspace doesn't have a config.json file.
              </p>
              <button
                onClick={handleConfigClick}
                className="text-xs px-2 py-1 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
              >
                Create Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
