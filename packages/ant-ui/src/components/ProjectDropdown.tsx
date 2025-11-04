import { Folder } from 'lucide-react';
import { useStore } from '../lib/store';
import { createProject, deleteProject } from '../lib/api';
import { ItemDropdown } from './ItemDropdown';

export function ProjectDropdown() {
  const { projects, selectedProject, setSelectedProject, fetchProjects } = useStore();

  const handleCreateProject = async (projectName: string) => {
    await createProject(projectName);
  };

  const handleDeleteProject = async (projectName: string) => {
    await deleteProject(projectName);
  };

  const projectItems = projects.map((p: string) => ({ name: p }));

  return (
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
    />
  );
}
