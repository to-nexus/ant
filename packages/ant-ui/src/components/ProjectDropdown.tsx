import { ChevronDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { useState, useEffect, useRef } from 'react';
import { createProject } from '@/lib/api';

interface ProjectDropdownProps {
  projects: string[];
  selected: string | undefined;
  onSelect: (projectId: string) => void;
  onProjectCreated?: () => void;
}

export function ProjectDropdown({ projects, selected, onSelect, onProjectCreated }: ProjectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    
    try {
      setLoading(true);
      await createProject(newProjectName.trim());
      setNewProjectName('');
      setIsCreating(false);
      setIsOpen(false);
      onProjectCreated?.();
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('Failed to create project. Please check the name and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (projects.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">📁 Workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 text-center text-gray-500">
            No projects found
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">📁 Workspace</CardTitle>
          <Button 
            size="sm" 
            onClick={() => setIsCreating(!isCreating)}
            disabled={loading}
          >
            {isCreating ? 'Cancel' : '+ New'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative" ref={dropdownRef}>
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={() => setIsOpen(!isOpen)}
          >
            <span className="truncate">
              {selected || 'Select a project...'}
            </span>
            <ChevronDown 
              className={`h-4 w-4 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} 
            />
          </Button>
          
          {isOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10">
              {projects.map((projectId) => (
                <button
                  key={projectId}
                  className={`
                    w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors
                    ${selected === projectId ? 'bg-primary-50 text-primary-600 font-medium' : 'text-gray-700'}
                    first:rounded-t-md last:rounded-b-md
                  `}
                  onClick={() => {
                    onSelect(projectId);
                    setIsOpen(false);
                  }}
                >
                  {projectId}
                </button>
              ))}
            </div>
          )}
        </div>

        {isCreating && (
          <div className="mt-4 p-3 border rounded-lg bg-muted/50">
            <input
              type="text"
              placeholder="Project name (e.g., my-awesome-app)"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateProject();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              className="w-full px-3 py-2 border rounded mb-2"
              autoFocus
            />
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || loading}
              >
                Create
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => {
                  setIsCreating(false);
                  setNewProjectName('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}