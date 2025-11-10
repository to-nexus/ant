import { fetchProjects } from '@/infrastructure/http/api';

export interface Project {
  id: string;
  name: string;
}

/**
 * Lists all projects in the workspace directory.
 * Fetches projects from the ant-cli server API.
 */
export async function listProjects(): Promise<string[]> {
  try {
    return await fetchProjects();
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return [];
  }
}

/**
 * Checks if a project exists in the workspace.
 * Browser-compatible stub - always returns false.
 */
export async function projectExists(_projectId: string): Promise<boolean> {
  console.warn('projectExists: File system access not available in browser.');
  return false;
}

/**
 * Gets the full path to a project directory.
 * Browser-compatible stub - returns placeholder path.
 */
export function getProjectPath(projectId: string): string {
  return `workspace/${projectId}`;
}